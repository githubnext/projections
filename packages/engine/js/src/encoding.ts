// Encoding what the engine and comparators receive: requests and comparator input as strict JSON bytes.
import type {EngineRequest} from '@githubnext/projections-schemas'
import {EngineError, limits} from './transport.js'

function invalid(code: string, path: string, message: string): never {
  throw new EngineError([{severity: 'error', code, path, message}])
}

function unicode(value: string, path: string): void {
  if (!value.isWellFormed()) invalid('invalid-unicode', path, 'Unpaired UTF-16 surrogate')
}

// Prevent JSON.stringify from silently deleting/replacing host values or invoking
// user-defined serialization. Domain validation remains entirely in Rust.
function jsonValue(value: unknown, path: string, ancestors: Set<object>, depth: number): void {
  if (depth > 64) invalid('depth-limit', path, 'JSON transport nesting exceeds 64')
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'string') return unicode(value, path)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('nonfinite-number', path, 'Numbers must be finite')
    if (Number.isInteger(value) && !Number.isSafeInteger(value))
      invalid('unsafe-integer', path, 'Integer exceeds the JavaScript safe-integer range')
    return
  }
  if (typeof value !== 'object') invalid('invalid-json-value', path, 'Expected a JSON value')
  if (ancestors.has(value)) invalid('invalid-json-value', path, 'Cyclic host objects are not JSON')
  const array = Array.isArray(value)
  const prototype: unknown = Object.getPrototypeOf(value)
  if (!array && prototype !== Object.prototype && prototype !== null) {
    invalid('invalid-json-value', path, 'Only plain JSON objects are accepted')
  }
  if (Object.getOwnPropertySymbols(value).length) invalid('invalid-json-value', path, 'Symbol keys are not JSON')
  ancestors.add(value)
  if (array) {
    for (let index = 0; index < value.length; index++) {
      const property = Object.getOwnPropertyDescriptor(value, String(index))
      if (!property || !('value' in property)) invalid('invalid-json-value', `${path}/${index}`, 'Sparse arrays and accessors are not JSON')
      jsonValue(property.value, `${path}/${index}`, ancestors, depth + 1)
    }
    if (Object.keys(value).length !== value.length) invalid('invalid-json-value', path, 'Array properties are not JSON')
  } else {
    for (const [key, property] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      unicode(key, path)
      const childPath = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
      if (!property.enumerable || !('value' in property))
        invalid('invalid-json-value', childPath, 'Nonenumerable fields and accessors are not JSON')
      jsonValue(property.value, childPath, ancestors, depth + 1)
    }
  }
  ancestors.delete(value)
}

export function encode(request: EngineRequest): Uint8Array {
  jsonValue(request, '', new Set(), 0)
  const bytes = new TextEncoder().encode(JSON.stringify(request))
  if (bytes.length > limits.requestBytes) invalid('request-size-limit', '', 'Engine request exceeds 128 MiB')
  return bytes
}

/** Encodes comparator module input: `{"protocolVersion": 0, before, after, options}`. */
export function encodeComparatorInput(before: unknown, after: unknown, options: unknown): Uint8Array {
  const input = {protocolVersion: 0, before, after, options}
  jsonValue(input, '', new Set(), 0)
  const bytes = new TextEncoder().encode(JSON.stringify(input))
  if (bytes.length > limits.comparatorInputBytes) invalid('comparator-input-limit', '', 'Comparator input exceeds 64 MiB')
  return bytes
}
