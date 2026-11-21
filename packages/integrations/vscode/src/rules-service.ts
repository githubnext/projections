// The rules language service for comparator files (*.comparator.yaml), without VS Code: a worker running rules-editor.wasm's
// `projections_rules_editor` (see rules-worker.ts), the semantic token legend and encoding, and the conversion between
// the interpreter's positions (1-based lines and code-point columns) and VS Code's (0-based lines, UTF-16 characters).
import {Worker} from 'node:worker_threads'
import type {WorkerRequest, WorkerResponse} from './rules-worker.js'

/** A rules file, or a rules test file. */
export type RulesKind = 'rules' | 'tests'

export interface EditorRequest {
  op: 'tokens' | 'diagnostics' | 'hover' | 'complete'
  source: string
  kind: RulesKind
  line?: number
  column?: number
}

/** Positions as the interpreter reports them: 1-based lines, 1-based columns in Unicode code points. */
export interface RulesToken {
  line: number
  column: number
  length: number
  type: string
  modifiers: string[]
}

export interface RulesDiagnostic {
  severity: 'error' | 'warning'
  code: string
  path: string
  message: string
  line: number
  column: number
  endLine: number
  endColumn: number
}

export interface RulesHover {
  markdown: string
  line: number
  column: number
  endLine: number
  endColumn: number
}

export interface RulesCompletion {
  label: string
  kind: string
  detail: string
  documentation: string
  /** A snippet to insert instead of the label. */
  insert?: string
}

export interface RulesCompletions {
  items: RulesCompletion[]
  range: {line: number; column: number; endColumn: number} | null
}

/** Which files the service is for: comparator files (`rules`, as the interpreter reads them) and their tests. */
export function rulesKind(path: string): RulesKind | undefined {
  if (/\.comparator\.test\.ya?ml$/.test(path)) return 'tests'
  if (/\.comparator\.ya?ml$/.test(path)) return 'rules'
  return undefined
}

/** The glob patterns of those files. */
export const rulesPatterns = ['**/*.comparator.yaml', '**/*.comparator.yml', '**/*.comparator.test.yaml', '**/*.comparator.test.yml']

/** The semantic token legend: LSP's standard types and modifiers, so every theme colours them. */
export const tokenTypes = [
  'namespace',
  'type',
  'parameter',
  'variable',
  'property',
  'function',
  'method',
  'macro',
  'keyword',
  'string',
  'number',
  'operator',
  'comment',
] as const
export const tokenModifiers = ['declaration', 'readonly', 'defaultLibrary'] as const

/** The 1-based code-point column of a 0-based UTF-16 character offset on a line. */
export function codePointColumn(text: string, character: number): number {
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- Spreading a string yields its code points, which this counts.
  return [...text.slice(0, character)].length + 1
}

/** The 0-based UTF-16 character offset of a 1-based code-point column on a line. */
export function utf16Character(text: string, column: number): number {
  let units = 0
  let count = 0
  for (const char of text) {
    if (count >= column - 1) break
    units += char.length
    count++
  }
  return units
}

/**
 * Semantic tokens as VS Code's relative encoding: per token, the line delta, the start delta (from the previous token
 * on the same line), its length, type and modifier bits, all in UTF-16. `line` reads a 0-based line's text.
 */
export function encodeTokens(tokens: readonly RulesToken[], line: (index: number) => string): number[] {
  const sorted = [...tokens].sort((a, b) => a.line - b.line || a.column - b.column)
  const data: number[] = []
  let previousLine = 0
  let previousStart = 0
  for (const token of sorted) {
    const type = (tokenTypes as readonly string[]).indexOf(token.type)
    if (type < 0) continue
    const index = token.line - 1
    const text = line(index)
    const start = utf16Character(text, token.column)
    const length = utf16Character(text, token.column + token.length) - start
    if (length <= 0) continue
    const modifiers = token.modifiers.reduce((bits, name) => {
      const bit = (tokenModifiers as readonly string[]).indexOf(name)
      return bit < 0 ? bits : bits | (1 << bit)
    }, 0)
    data.push(index - previousLine, index === previousLine ? start - previousStart : start, length, type, modifiers)
    previousLine = index
    previousStart = start
  }
  return data
}

/** A range from the interpreter's positions as VS Code's: 0-based lines and UTF-16 characters. */
export function utf16Range(
  {line, column, endLine, endColumn}: {line: number; column: number; endLine: number; endColumn: number},
  text: (index: number) => string,
): {startLine: number; startCharacter: number; endLine: number; endCharacter: number} {
  return {
    startLine: line - 1,
    startCharacter: utf16Character(text(line - 1), column),
    endLine: endLine - 1,
    endCharacter: utf16Character(text(endLine - 1), endColumn),
  }
}

/** Runs `run` for a key once no new call has come for `delayMs`. */
export class Debouncer {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly delayMs: number

  constructor(delayMs: number) {
    this.delayMs = delayMs
  }

  schedule(key: string, run: () => void): void {
    this.cancel(key)
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        run()
      }, this.delayMs),
    )
  }

  cancel(key: string): void {
    const timer = this.timers.get(key)
    if (timer) clearTimeout(timer)
    this.timers.delete(key)
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}

export interface RulesServiceOptions {
  /** The worker script (rules-worker.ts, built to dist/rules-worker.cjs). */
  worker: string | URL
  /** The language service module, `rules-editor.wasm`. */
  wasm: string
  /** How long one request may take before the worker is restarted. Default 5000. */
  deadlineMs?: number
}

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/**
 * The language service, in one worker thread started on the first request. A request that outlasts the deadline, or a
 * worker that fails, fails what is pending and restarts the worker on the next request.
 */
export class RulesService {
  private worker: Worker | undefined
  private readonly pending = new Map<number, Pending>()
  private next = 1
  private readonly options: RulesServiceOptions

  constructor(options: RulesServiceOptions) {
    this.options = options
  }

  request(request: EditorRequest): Promise<unknown> {
    const worker = this.start()
    const id = this.next++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`The rules language service took longer than ${this.options.deadlineMs ?? 5000} ms`))
      }, this.options.deadlineMs ?? 5000)
      this.pending.set(id, {resolve, reject, timer})
      worker.postMessage({id, request} satisfies WorkerRequest)
    }).then(value => {
      const error = (value as {error?: unknown} | null)?.error
      if (typeof error === 'string') throw new Error(error)
      return value
    })
  }

  tokens(source: string, kind: RulesKind): Promise<RulesToken[]> {
    return this.request({op: 'tokens', source, kind}).then(value => (value as {tokens: RulesToken[]}).tokens)
  }

  diagnostics(source: string, kind: RulesKind): Promise<RulesDiagnostic[]> {
    return this.request({op: 'diagnostics', source, kind}).then(value => (value as {diagnostics: RulesDiagnostic[]}).diagnostics)
  }

  hover(source: string, kind: RulesKind, line: number, column: number): Promise<RulesHover | null> {
    return this.request({op: 'hover', source, kind, line, column}).then(value => (value as {hover: RulesHover | null}).hover)
  }

  complete(source: string, kind: RulesKind, line: number, column: number): Promise<RulesCompletions> {
    return this.request({op: 'complete', source, kind, line, column}) as Promise<RulesCompletions>
  }

  dispose(): void {
    this.fail(new Error('The rules language service stopped'))
  }

  private start(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(this.options.worker, {workerData: {wasm: this.options.wasm}})
    worker.on('message', (response: WorkerResponse) => {
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id)
      clearTimeout(pending.timer)
      if (response.ok) pending.resolve(response.value)
      else pending.reject(new Error(response.message))
    })
    worker.on('error', error => this.fail(error))
    worker.on('exit', () => {
      if (this.worker === worker) this.fail(new Error('The rules language service exited'))
    })
    worker.unref()
    this.worker = worker
    return worker
  }

  /** Fails every pending request and stops the worker; the next request starts a new one. */
  private fail(error: Error): void {
    const worker = this.worker
    this.worker = undefined
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    void worker?.terminate()
  }
}
