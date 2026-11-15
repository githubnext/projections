// Decoding what the engine and comparators return: responses and comparator output from their JSON bytes.
import type {EngineResponse} from '@githubnext/projections-schemas'
import {EngineError, EngineTransportError} from './transport.js'

/** Decodes a comparator module's output: a comparison or an explicit error. */
export function decodeComparatorOutput(bytes: Uint8Array): unknown {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes))
  } catch (cause) {
    throw new EngineTransportError('Comparator returned invalid UTF-8/JSON', {cause})
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EngineTransportError('Comparator returned an invalid output envelope')
  }
  if ('error' in value) {
    if (typeof value.error !== 'string' || Object.keys(value).length !== 1) {
      throw new EngineTransportError('Comparator returned an invalid error envelope')
    }
    throw new EngineError([{severity: 'error', code: 'comparator-error', path: '', message: value.error}])
  }
  return value
}

/** An error diagnostic: `{severity: 'error', code, path, message}`. */
function isDiagnostic(d: unknown): boolean {
  return (
    d !== null &&
    typeof d === 'object' &&
    'severity' in d &&
    d.severity === 'error' &&
    'code' in d &&
    typeof d.code === 'string' &&
    'path' in d &&
    typeof d.path === 'string' &&
    'message' in d &&
    typeof d.message === 'string'
  )
}

export function decodeResponse(bytes: Uint8Array): EngineResponse {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes))
  } catch (cause) {
    throw new EngineTransportError('Engine returned invalid UTF-8/JSON', {cause})
  }
  if (value === null || typeof value !== 'object' || !('ok' in value)) {
    throw new EngineTransportError('Engine returned an invalid response envelope')
  }
  if (value.ok === true && 'result' in value) return value as EngineResponse
  if (
    value.ok === false &&
    'diagnostics' in value &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.length > 0 &&
    value.diagnostics.every(isDiagnostic)
  ) {
    return value as EngineResponse
  }
  throw new EngineTransportError('Engine returned an invalid response envelope')
}
