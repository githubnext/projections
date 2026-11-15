/** The comparator input envelope: checked structurally and encoded as UTF-8 JSON. */

import {PROTOCOL_VERSION, checkFields, errors, isObject, limits} from './abi.js'

const inputFields = ['protocolVersion', 'before', 'after', 'baseline', 'options'] as const

/** Checks the comparator input envelope and encodes it as UTF-8 JSON. */
export function encodeInput(input: unknown, maxInputBytes: number = limits.inputBytes): Uint8Array<ArrayBuffer> {
  if (!isObject(input)) return errors.invalidInput('input must be a JSON object')
  const unknown = checkFields(input, inputFields, 'input')
  if (unknown) errors.invalidInput(unknown)
  if (input.protocolVersion !== PROTOCOL_VERSION) errors.invalidInput(`input must have protocolVersion ${PROTOCOL_VERSION}`)
  for (const field of ['before', 'after', 'baseline', 'options']) {
    if (!isObject(input[field])) errors.invalidInput(`input field \`${field}\` must be an object`)
  }
  let text: string
  try {
    text = JSON.stringify(input)
  } catch (error) {
    return errors.invalidInput(`input is not serializable as JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const bytes = new TextEncoder().encode(text)
  if (bytes.length > maxInputBytes) errors.inputTooLarge(bytes.length, maxInputBytes)
  return bytes
}
