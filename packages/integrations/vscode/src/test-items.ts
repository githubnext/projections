/*
 * The Testing view's tree, without VS Code: one item per projection, whose children are its checks (`projections
 * check`'s steps: definition valid, extraction, determinism, scope, the renderer's) and its comparator tests, one per
 * case at its line in the `*.comparator.test.yaml` (so the editor's gutter runs it); test files no projection uses
 * are items of their own. And a check run's steps as outcomes. Nothing here imports VS Code, so it is unit tested on
 * its own; `testing.ts` applies it to the TestController.
 */
import type {ListedFile} from './comparator-tests/wire.js'

/** A step of `projections check`, as the `check` tool reports it. */
export interface CheckStep {
  id: string
  title: string
  status: string
  message?: string
}

/** What a step's ID is called in the Testing view (several renderer steps are one item). */
const checkNames: Record<string, string> = {
  definition: 'Definition valid',
  extract: 'Extraction',
  determinism: 'Determinism',
  scope: 'Scope',
  compare: 'Comparison with HEAD',
  parity: 'Parity with CI',
  'comparator-tests': 'Comparator tests',
  renderer: 'Renderer checks',
}

/** The steps a check reports that one item stands for: the renderer's bundle, diff mode, drawing and image. */
const checkGroups: Record<string, string> = {renderer: 'renderer', diff: 'renderer', render: 'renderer', png: 'renderer'}

/** The checks every projection lists before it has run: definition valid, extraction, determinism, scope, renderer. */
export const defaultChecks = ['definition', 'extract', 'determinism', 'scope', 'renderer']

/** The item a check step reports on: its group's ID. */
export function checkItem(step: string): string {
  return checkGroups[step] ?? step
}

export interface TestNode {
  /** Unique among its siblings: `projection:<id>`, `check:<step>`, `case:<path>#<case>`, `file:<path>`. */
  id: string
  label: string
  kind: 'projection' | 'check' | 'case' | 'file'
  projection?: string
  check?: string
  /** A test file's (or a case's file's) repository-relative path. */
  path?: string
  case?: string
  /** A case's 1-based line and column in its file. */
  line?: number
  column?: number
  description?: string
  /** A test file's listing problems, as one text. */
  error?: string
  children: TestNode[]
}

/** A case's item ID, unique under its projection (two test files may name cases alike). */
export const caseId = (path: string, id: string) => `case:${path}#${id}`

/**
 * The tree: each projection with its checks (the defaults, then any other step its last run reported, in order) and
 * the cases of the test files beside its comparator; then each test file no projection uses, with its cases.
 */
export function testTree(input: {
  projections: readonly {id: string; title: string}[]
  files: readonly ListedFile[]
  /** Each projection's last run's step IDs, in order. */
  reported?: ReadonlyMap<string, readonly string[]>
}): TestNode[] {
  const cases = (file: ListedFile, projection?: string): TestNode[] =>
    file.cases.map(listed => ({
      id: caseId(file.path, listed.id),
      label: listed.name,
      kind: 'case',
      ...(projection ? {projection} : {}),
      path: file.path,
      case: listed.id,
      ...(listed.location ? {line: listed.location.line, column: listed.location.column} : {}),
      children: [],
    }))
  const projections = input.projections.map((projection): TestNode => {
    const own = input.files.filter(file => file.projections.includes(projection.id))
    const tested = own.some(file => file.cases.length)
    const ids: string[] = [...defaultChecks]
    for (const step of input.reported?.get(projection.id) ?? []) {
      const id = checkItem(step)
      // Its cases stand for the comparator tests' step.
      if (id === 'comparator-tests' && tested) continue
      if (!ids.includes(id)) ids.push(id)
    }
    return {
      id: `projection:${projection.id}`,
      label: projection.title,
      kind: 'projection',
      projection: projection.id,
      description: projection.id,
      children: [
        ...ids.map((id): TestNode => ({
          id: `check:${id}`,
          label: checkNames[id] ?? id,
          kind: 'check',
          projection: projection.id,
          check: id,
          children: [],
        })),
        ...own.flatMap(file => cases(file, projection.id)),
      ],
    }
  })
  const unused = input.files
    .filter(file => !file.projections.some(id => input.projections.some(projection => projection.id === id)))
    .map((file): TestNode => ({
      id: `file:${file.path}`,
      label: file.path,
      kind: 'file',
      path: file.path,
      description: 'used by no projection',
      children: cases(file),
    }))
  return [...projections, ...unused]
}

/** A check item's outcome: passed (with a warning, if any), failed, or skipped, with the steps' messages. */
export interface CheckOutcome {
  state: 'passed' | 'failed' | 'skipped'
  messages: string[]
  warning: boolean
}

/**
 * A check run's steps as each item's outcome: an item fails if any of its steps failed, else passes if any passed or
 * warned (a warning passes, with its message), else is skipped. Items the run didn't report are skipped. Comparator
 * tests' step is left to its cases when the projection has some.
 */
export function checkOutcomes(steps: readonly CheckStep[], items: readonly string[]): Map<string, CheckOutcome> {
  const rank = {fail: 3, warn: 2, pass: 1, skip: 0} as const
  const found = new Map<string, {status: keyof typeof rank; messages: string[]}>()
  for (const step of steps) {
    const id = checkItem(step.id)
    const status = (step.status in rank ? step.status : 'skip') as keyof typeof rank
    const entry = found.get(id) ?? {status, messages: []}
    if (rank[status] > rank[entry.status]) entry.status = status
    if (step.message) {
      entry.messages.push(steps.filter(item => checkItem(item.id) === id).length > 1 ? `${step.title}: ${step.message}` : step.message)
    }
    found.set(id, entry)
  }
  const outcomes = new Map<string, CheckOutcome>()
  for (const id of items) {
    const entry = found.get(id)
    outcomes.set(id, {
      state: !entry || entry.status === 'skip' ? 'skipped' : entry.status === 'fail' ? 'failed' : 'passed',
      messages: entry?.messages ?? ['Not checked'],
      warning: entry?.status === 'warn',
    })
  }
  return outcomes
}
