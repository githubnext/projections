/*
 * Comparator tests (`*.comparator.test.yaml`) as the backend lists and runs them (`GET /api/comparator-tests`, `POST
 * /api/comparator-tests/run`; see the runner documentation's "Comparator tests"), mapped to what a test view shows:
 * files with their cases at their locations, and each case's outcome with located messages. Nothing here imports
 * VS Code, so it is unit tested on its own (its modules import each other with `.ts` specifiers, which Node loads from
 * source); `testing.ts` applies it to a TestController.
 */

/** A 1-based position in a repository-relative file. */
export interface TestLocation {
  path: string
  line: number
  column: number
}

/** A problem with a test file (it doesn't parse, or a case is invalid), where it is. */
export interface TestDiagnostic {
  message: string
  pointer?: string
  location?: TestLocation
}

export interface ListedCase {
  id: string
  name: string
  location?: TestLocation
}

/** One test file, as `GET /api/comparator-tests` lists it. */
export interface ListedFile {
  path: string
  /** The comparator file the tests are beside. */
  comparator: string
  projections: string[]
  cases: ListedCase[]
  diagnostics: TestDiagnostic[]
}

export interface CaseFailure {
  expectation?: string
  message: string
  location?: TestLocation
  expected?: unknown
  actual?: unknown
  diff?: string
}

export interface CaseResult {
  id: string
  name: string
  status: 'pass' | 'fail' | 'skip'
  location?: TestLocation
  durationMs?: number
  message?: string
  failures: CaseFailure[]
}

/** One test file's run for one projection using its comparator (`projection: null` when none does). */
export interface FileResult {
  path: string
  comparator?: string
  projection: string | null
  cases: CaseResult[]
  written: string[]
  diagnostics: TestDiagnostic[]
}

export const listPath = '/api/comparator-tests'
export const runPath = '/api/comparator-tests/run'

export const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
export const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
/** `{key: value}`, or nothing when the value is absent. */
export function given<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({[key]: value} as Partial<Record<K, V>>)
}
export const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

/** A repository-relative path: `/`-separated, no root, `.` or `..` segment or backslash. */
export function repositoryPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !/^[a-zA-Z]:/u.test(value) &&
    !value.split('/').some(part => part === '' || part === '.' || part === '..') &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/u.test(value)
  )
}

export function location(value: unknown): TestLocation | undefined {
  const item = record(value)
  if (!item || !repositoryPath(item.path)) return undefined
  const line = Number.isSafeInteger(item.line) && (item.line as number) >= 1 ? (item.line as number) : 1
  const column = Number.isSafeInteger(item.column) && (item.column as number) >= 1 ? (item.column as number) : 1
  return {path: item.path, line, column}
}

export function diagnostics(value: unknown): TestDiagnostic[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => {
    const item = record(entry)
    const message = text(item?.message)
    if (!item || !message) return []
    const where = location(item.location)
    const pointer = text(item.pointer)
    return [{message, ...(pointer !== undefined ? {pointer} : {}), ...(where ? {location: where} : {})}]
  })
}
