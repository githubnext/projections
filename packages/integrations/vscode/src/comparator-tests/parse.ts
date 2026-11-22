import {
  diagnostics,
  given,
  location,
  record,
  repositoryPath,
  strings,
  text,
  type CaseFailure,
  type CaseResult,
  type FileResult,
  type ListedFile,
} from './wire.ts'

/** `GET /api/comparator-tests`' body: its files, dropping malformed entries. */
export function parseListing(body: unknown): ListedFile[] {
  const files = record(body)?.files
  if (!Array.isArray(files)) throw new Error('The backend listed comparator tests in an unexpected shape')
  return files.flatMap(entry => {
    const file = record(entry)
    if (!file || !repositoryPath(file.path)) return []
    const cases = (Array.isArray(file.cases) ? file.cases : []).flatMap(value => {
      const item = record(value)
      const id = text(item?.id)
      if (!item || !id) return []
      const where = location(item.location)
      return [{id, name: text(item.name) ?? id, ...(where ? {location: where} : {})}]
    })
    return [
      {
        path: file.path,
        comparator: text(file.comparator) ?? '',
        projections: strings(file.projections),
        cases,
        diagnostics: diagnostics(file.diagnostics),
      },
    ]
  })
}

function failures(value: unknown): CaseFailure[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => {
    const item = record(entry)
    const message = text(item?.message)
    if (!item || !message) return []
    const where = location(item.location)
    return [
      {
        message,
        ...given('expectation', text(item.expectation)),
        ...(where ? {location: where} : {}),
        ...('expected' in item ? {expected: item.expected} : {}),
        ...('actual' in item ? {actual: item.actual} : {}),
        ...given('diff', text(item.diff)),
      },
    ]
  })
}

/** `POST /api/comparator-tests/run`'s body: one result per file and projection. */
export function parseResults(body: unknown): FileResult[] {
  const results = record(body)?.results
  if (!Array.isArray(results)) throw new Error('The backend reported comparator test results in an unexpected shape')
  return results.flatMap(entry => {
    const result = record(entry)
    if (!result || !repositoryPath(result.path)) return []
    const cases = (Array.isArray(result.cases) ? result.cases : []).flatMap(value => {
      const item = record(value)
      const id = text(item?.id)
      const status = item?.status
      if (!item || !id || (status !== 'pass' && status !== 'fail' && status !== 'skip')) return []
      const where = location(item.location)
      return [
        {
          id,
          name: text(item.name) ?? id,
          status,
          ...(where ? {location: where} : {}),
          ...(typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) ? {durationMs: item.durationMs} : {}),
          ...given('message', text(item.message)),
          failures: failures(item.failures),
        } satisfies CaseResult,
      ]
    })
    return [
      {
        path: result.path,
        ...given('comparator', text(result.comparator)),
        projection: text(result.projection) ?? null,
        cases,
        written: strings(result.written),
        diagnostics: diagnostics(result.diagnostics),
      },
    ]
  })
}

/** Why a run request was refused: the diagnostics' messages, else the status. */
export function refusalMessage(status: number, body: unknown): string {
  const found = diagnostics(record(body)?.diagnostics).map(item => item.message)
  if (found.length) return found.join('\n')
  return typeof body === 'string' && body ? `${body.slice(0, 1024)} (${status})` : `The backend refused the run (${status})`
}
