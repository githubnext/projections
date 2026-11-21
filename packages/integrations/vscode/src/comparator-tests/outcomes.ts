import type {CaseResult, FileResult, TestDiagnostic, TestLocation} from './wire.ts'

/** A message for the test view: text, where it is, and what was expected and found when the failure says. */
export interface OutcomeMessage {
  message: string
  location?: TestLocation
  expected?: string
  actual?: string
}

/** A case's outcome over every projection that ran it: it fails if any run failed, passes if any passed. */
export interface CaseOutcome {
  status: 'passed' | 'failed' | 'skipped'
  durationMs?: number
  messages: OutcomeMessage[]
}

/** A file's outcome: its cases, problems with the file itself, and the snapshots written. */
export interface FileOutcome {
  cases: Map<string, CaseOutcome>
  errors: OutcomeMessage[]
  written: string[]
}

/** A value shown as expected or actual: strings as they are, anything else as indented JSON. */
export function shown(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? String(value))
}

/** The test view's messages for a failed run of a case: one per failure, at its location, else the case's message. */
export function failureMessages(result: CaseResult, prefix = ''): OutcomeMessage[] {
  const located = result.failures.map(failure => ({
    message: `${prefix}${failure.message}${failure.diff ? `\n\n${failure.diff}` : ''}`,
    ...((failure.location ?? result.location) ? {location: failure.location ?? result.location} : {}),
    ...('expected' in failure ? {expected: shown(failure.expected)} : {}),
    ...('actual' in failure ? {actual: shown(failure.actual)} : {}),
  }))
  if (located.length) return located
  return [{message: `${prefix}${result.message ?? 'The case failed'}`, ...(result.location ? {location: result.location} : {})}]
}

/** Diagnostics as messages, each at its location. */
export function diagnosticMessages(items: readonly TestDiagnostic[], prefix = ''): OutcomeMessage[] {
  return items.map(item => ({message: `${prefix}${item.message}`, ...(item.location ? {location: item.location} : {})}))
}

/** A file's listing diagnostics as one text, for the test item's error: each message with its line. */
export function diagnosticsText(items: readonly TestDiagnostic[]): string | undefined {
  if (!items.length) return undefined
  return items.map(item => (item.location ? `${item.message} (line ${item.location.line})` : item.message)).join('\n')
}

/** Each file's outcome, merging the runs of the projections that use its comparator. */
export function outcomes(results: readonly FileResult[]): Map<string, FileOutcome> {
  const runs = new Map<string, number>()
  for (const result of results) runs.set(result.path, (runs.get(result.path) ?? 0) + 1)
  const files = new Map<string, FileOutcome>()
  for (const result of results) {
    const file = files.get(result.path) ?? {cases: new Map<string, CaseOutcome>(), errors: [], written: []}
    files.set(result.path, file)
    // With several projections, each message says which run it is from.
    const prefix = (runs.get(result.path) ?? 0) > 1 && result.projection ? `[${result.projection}] ` : ''
    file.errors.push(...diagnosticMessages(result.diagnostics, prefix))
    file.written.push(...result.written.filter(path => !file.written.includes(path)))
    for (const item of result.cases) {
      const previous = file.cases.get(item.id)
      const status = item.status === 'fail' ? 'failed' : item.status === 'pass' ? 'passed' : 'skipped'
      const messages =
        item.status === 'fail'
          ? failureMessages(item, prefix)
          : item.status === 'skip' && item.message
            ? [{message: `${prefix}${item.message}`}]
            : []
      if (!previous) {
        file.cases.set(item.id, {status, ...(item.durationMs !== undefined ? {durationMs: item.durationMs} : {}), messages})
        continue
      }
      const rank = {failed: 2, passed: 1, skipped: 0} as const
      if (rank[status] > rank[previous.status]) previous.status = status
      if (item.durationMs !== undefined) previous.durationMs = (previous.durationMs ?? 0) + item.durationMs
      previous.messages.push(...messages)
    }
  }
  return files
}

/** What a run covers: every test file, or files, each whole or some of its cases. */
export type Selection = 'all' | readonly {path: string; cases?: readonly string[]}[]

/** The `POST /api/comparator-tests/run` bodies for a selection: one per file (whole, or its chosen cases), or one for all. */
export function runBodies(selection: Selection, update: boolean): Record<string, unknown>[] {
  const flag = update ? {update: true} : {}
  if (selection === 'all') return [{...flag}]
  const files = new Map<string, Set<string> | 'whole'>()
  for (const {path, cases} of selection) {
    const previous = files.get(path)
    if (previous === 'whole') continue
    if (!cases) {
      files.set(path, 'whole')
      continue
    }
    const set = previous ?? new Set<string>()
    for (const id of cases) set.add(id)
    files.set(path, set)
  }
  return [...files].map(([path, cases]) => ({path, ...(cases === 'whole' ? {} : {cases: [...cases]}), ...flag}))
}
