import {Value} from 'typebox/value'
import {runnerResponses, type RunnerResponse, type RunnerResponseName} from './api.js'

/** A runner response that doesn't match its schema: the request it answered, and where and why it doesn't. */
export class RunnerResponseError extends Error {
  override name = 'RunnerResponseError'
  constructor(
    /** The request, such as `GET /api/explore`. */
    readonly request: string,
    /** The JSON pointer of the value that doesn't match, `''` for the whole response. */
    readonly pointer: string,
    readonly reason: string,
  ) {
    super(`The local runner's response to ${request} is invalid at ${pointer || 'its root'}: ${reason}`)
  }
}

interface Failure {
  keyword: string
  instancePath: string
  params: {[key: string]: unknown}
  message: string
}

const depth = (failure: Failure) => (failure.instancePath ? failure.instancePath.split('/').length : 0)

function reason(failure: Failure): string {
  if (failure.keyword === 'enum')
    return `must be one of ${(failure.params.allowedValues as unknown[]).map(item => JSON.stringify(item)).join(', ')}`
  if (failure.keyword === 'const') return `must be ${JSON.stringify(failure.params.allowedValue)}`
  return failure.message
}

/** The most specific failure: the deepest value's, with a union's alternatives' types together ("string or null"). */
function explain(failures: Failure[]): {pointer: string; reason: string} {
  const deepest = failures.reduce((best, failure) => (depth(failure) > depth(best) ? failure : best))
  const here = failures.filter(failure => failure.instancePath === deepest.instancePath && failure.keyword !== 'anyOf')
  const types = here.filter(failure => failure.keyword === 'type').map(failure => String(failure.params.type))
  return {
    pointer: deepest.instancePath,
    reason: here.length && types.length === here.length ? `must be ${[...new Set(types)].join(' or ')}` : reason(here[0] ?? deepest),
  }
}

/**
 * The runner's response `value` as `name`'s type, once its schema accepts it; otherwise a `RunnerResponseError`.
 * Uses TypeBox's interpreting checker, which needs no `eval`, so it runs under the Inspector's content security policy.
 */
export function decodeRunnerResponse<N extends RunnerResponseName>(name: N, value: unknown): RunnerResponse<N> {
  const {request, schema} = runnerResponses[name]
  if (Value.Check(schema, value)) return value as RunnerResponse<N>
  const failures = [...Value.Errors(schema, value)] as Failure[]
  const {pointer, reason} = failures.length ? explain(failures) : {pointer: '', reason: 'does not match its schema'}
  throw new RunnerResponseError(request, pointer, reason)
}
