// The sections of a comparator module the ABI checks read: types, imports, functions, memories and exports.
import {errors} from '../abi.js'
import {Reader, type Limits, type ValueType} from './reader.js'

export interface FunctionType {
  params: ValueType[]
  results: ValueType[]
}
export type ExportKind = 'function' | 'table' | 'memory' | 'global' | 'tag'

const exportKinds: ExportKind[] = ['function', 'table', 'memory', 'global', 'tag']

/** What the checks need from a module's type, import, function, memory and export sections. */
export interface Sections {
  types: (FunctionType | undefined)[]
  imports: string[]
  importedFunctions: number
  importedMemories: number
  functions: number[]
  memories: Limits[]
  exports: Map<string, {kind: ExportKind; index: number}>
}

/** Reads the sections the checks need, skipping the rest. */
export function readSections(bytes: Uint8Array): Sections {
  const reader = new Reader(bytes)
  for (const expected of [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]) {
    if (reader.byte() !== expected) errors.invalidModule('not a core WebAssembly module')
  }
  const sections: Sections = {
    types: [],
    imports: [],
    importedFunctions: 0,
    importedMemories: 0,
    functions: [],
    memories: [],
    exports: new Map(),
  }
  while (reader.offset < bytes.length) {
    const id = reader.byte()
    const size = reader.unsigned()
    const end = reader.offset + size
    if (end > bytes.length) errors.invalidModule('section extends past the end of the module')
    const section = new Reader(bytes, end)
    section.offset = reader.offset
    reader.offset = end
    if (id === 1) readTypes(section, sections)
    else if (id === 2) readImports(section, sections)
    else if (id === 3) {
      for (let count = section.unsigned(); count > 0; count--) sections.functions.push(section.unsigned())
    } else if (id === 5) {
      for (let count = section.unsigned(); count > 0; count--) sections.memories.push(section.limits())
    } else if (id === 7) readExports(section, sections)
  }
  return sections
}

function readTypes(section: Reader, sections: Sections): void {
  for (let count = section.unsigned(); count > 0; count--) {
    const form = section.byte()
    if (form !== 0x60) errors.invalidModule('unsupported type definition')
    const params = Array.from({length: section.unsigned()}, () => section.valueType())
    const results = Array.from({length: section.unsigned()}, () => section.valueType())
    sections.types.push({params, results})
  }
}

function readImports(section: Reader, sections: Sections): void {
  for (let count = section.unsigned(); count > 0; count--) {
    sections.imports.push(`${section.name()}.${section.name()}`)
    const kind = section.byte()
    if (kind === 0x00) {
      section.unsigned()
      sections.importedFunctions++
    } else if (kind === 0x01) {
      section.valueType()
      section.limits()
    } else if (kind === 0x02) {
      section.limits()
      sections.importedMemories++
    } else if (kind === 0x03) {
      section.valueType()
      section.byte()
    } else if (kind === 0x04) {
      section.byte()
      section.unsigned()
    } else {
      errors.invalidModule(`unsupported import kind 0x${kind.toString(16)}`)
    }
  }
}

function readExports(section: Reader, sections: Sections): void {
  for (let count = section.unsigned(); count > 0; count--) {
    const name = section.name()
    const kind = exportKinds[section.byte()] ?? errors.invalidModule('unsupported export kind')
    sections.exports.set(name, {kind, index: section.unsigned()})
  }
}
