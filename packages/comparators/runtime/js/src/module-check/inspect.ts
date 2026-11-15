/**
 * The structural check of a comparator module's bytes against the ABI: zero
 * imports, and the exported memory and functions with their exact types.
 */

import {ALLOC_EXPORT, COMPARE_EXPORT, MEMORY_EXPORT, fail, type ModuleInfo} from '../abi.js'
import {readSections, type ExportKind, type Sections} from './sections.js'

/**
 * Checks the module structure against the ABI. Expects bytes that
 * `WebAssembly.compile` accepted. Rejects imports and missing or mistyped
 * exports, and returns the exported memory's declared limits.
 */
export function inspectModule(bytes: Uint8Array): ModuleInfo {
  const sections = readSections(bytes)
  if (sections.imports.length > 0) {
    const {imports} = sections
    const listed = imports.slice(0, 5).join(', ')
    fail(
      'forbidden-import',
      `comparator modules must have zero imports, but this module has ${imports.length}: ${listed}` + (imports.length > 5 ? ', …' : ''),
    )
  }
  return checkExports(sections)
}

/** Checks the exported memory and functions, returning the memory's declared limits. */
function checkExports({types, importedFunctions, importedMemories, functions, memories, exports}: Sections): ModuleInfo {
  const functionType = (index: number) => types[functions[index - importedFunctions] ?? -1]
  const describe = (exported: {kind: ExportKind; index: number}): string => {
    if (exported.kind === 'function') {
      const type = functionType(exported.index)
      return type ? `a function (${type.params.join(', ')}) -> (${type.results.join(', ')})` : 'a function'
    }
    if (exported.kind === 'memory') {
      return (memories[exported.index - importedMemories]?.flags ?? 0) & 0x04 ? 'a 64-bit linear memory' : 'a linear memory'
    }
    return `a ${exported.kind}`
  }

  const memory = exports.get(MEMORY_EXPORT) ?? fail('missing-export', `comparator module does not export \`${MEMORY_EXPORT}\``)
  const limitsOfMemory = memory.kind === 'memory' ? memories[memory.index - importedMemories] : undefined
  if (!limitsOfMemory || limitsOfMemory.flags & 0x04) {
    fail('invalid-export', `comparator export \`${MEMORY_EXPORT}\` must be a 32-bit linear memory, but is ${describe(memory)}`)
  }
  for (const [name, params, results] of [
    [ALLOC_EXPORT, ['i32'], ['i32']],
    [COMPARE_EXPORT, ['i32', 'i32'], ['i64']],
  ] as const) {
    const exported = exports.get(name) ?? fail('missing-export', `comparator module does not export \`${name}\``)
    const type = exported.kind === 'function' ? functionType(exported.index) : undefined
    if (!type || type.params.join() !== params.join() || type.results.join() !== results.join()) {
      fail(
        'invalid-export',
        `comparator export \`${name}\` must be a function (${params.join(', ')}) -> (${results.join(', ')}), but is ${describe(exported)}`,
      )
    }
  }
  const {minimum, maximum} = limitsOfMemory!
  return maximum === undefined ? {minimumPages: minimum} : {minimumPages: minimum, maximumPages: maximum}
}
