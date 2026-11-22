// Reading a WebAssembly module's binary encoding: LEB128 integers, names, value types and limits.
import {errors} from '../abi.js'

export type ValueType = string
export interface Limits {
  flags: number
  minimum: number
  maximum?: number
}

const valueTypes: Record<number, string> = {
  0x7f: 'i32',
  0x7e: 'i64',
  0x7d: 'f32',
  0x7c: 'f64',
  0x7b: 'v128',
  0x70: 'funcref',
  0x6f: 'externref',
}

export class Reader {
  offset = 0
  readonly bytes: Uint8Array
  readonly end: number

  constructor(bytes: Uint8Array, end = bytes.length) {
    this.bytes = bytes
    this.end = end
  }
  byte(): number {
    if (this.offset >= this.end) errors.invalidModule('unexpected end of section')
    return this.bytes[this.offset++]!
  }
  unsigned(): number {
    let result = 0
    let scale = 1
    for (let index = 0; index < 10; index++) {
      const byte = this.byte()
      result += (byte & 0x7f) * scale
      if ((byte & 0x80) === 0) return result
      scale *= 128
    }
    return errors.invalidModule('malformed LEB128 integer')
  }
  signed(): void {
    for (let index = 0; index < 10; index++) if ((this.byte() & 0x80) === 0) return
    errors.invalidModule('malformed LEB128 integer')
  }
  name(): string {
    const length = this.unsigned()
    if (this.offset + length > this.end) errors.invalidModule('name extends past its section')
    const text = new TextDecoder('utf-8', {fatal: true}).decode(this.bytes.subarray(this.offset, this.offset + length))
    this.offset += length
    return text
  }
  valueType(): ValueType {
    const code = this.byte()
    if (code === 0x63 || code === 0x64) {
      this.signed()
      return 'ref'
    }
    return valueTypes[code] ?? errors.invalidModule(`unsupported value type 0x${code.toString(16)}`)
  }
  limits(): Limits {
    const flags = this.byte()
    const minimum = this.unsigned()
    const maximum = flags & 1 ? this.unsigned() : undefined
    if (flags & 0x08) this.unsigned()
    return maximum === undefined ? {flags, minimum} : {flags, minimum, maximum}
  }
}
