import path from 'node:path'
import type ts from 'typescript'
import type {Entity, Extraction, Relationship} from '../types.js'
import {extraction} from '../shared.js'
import {code, evidence, id, native, slash, sort, type Project} from './model.js'
import {renderer} from './contracts.js'
import {describeExport} from './declaration.js'
import {apiEntries, type Entry} from './entries.js'
import {MemberNodes} from './members.js'
import {resolve} from './symbols.js'

function entrySource(project: Project, entry: Entry): Project['sources'][number] {
  return project.sources.find(item => native(item.source.fileName) === entry.file)!
}

/** Every symbol an entry point exports, resolved through aliases: these are spelled by name in signatures. */
function exportedSymbols(project: Project, entries: Entry[]): Set<ts.Symbol> {
  const exported = new Set<ts.Symbol>()
  for (const entry of entries) {
    const {source, checker} = entrySource(project, entry)
    const module = checker.getSymbolAtLocation(source)
    if (!module)
      throw new Error(
        `Public API entrypoint ${code(slash(path.relative(project.root, entry.file)))} is not an external module; add exports`,
      )
    for (const symbol of checker.getExportsOfModule(module)) {
      const resolved = resolve(checker, symbol)
      if (resolved) exported.add(resolved)
    }
  }
  return exported
}

export function publicApi(project: Project): Extraction {
  const entries = apiEntries(project)
  const nodes = new Map<string, Entity>()
  const edges: Relationship[] = []
  const surfaces = new Map<string, string>()
  const exported = exportedSymbols(project, entries)
  for (const entry of entries) {
    const {source, checker} = entrySource(project, entry)
    const render = renderer(checker, exported)
    const members = new MemberNodes(project, checker, render, nodes, edges)
    const module = checker.getSymbolAtLocation(source)!
    for (const alias of checker.getExportsOfModule(module)) {
      const symbol = resolve(checker, alias)
      if (!symbol || !symbol.declarations?.length)
        throw new Error(`Cannot resolve public export ${code(`${entry.pkg.name}:${alias.name}`)}; fix module diagnostics`)
      const declaration = symbol.valueDeclaration ?? symbol.declarations[0]!
      const exportId = id('ts-api', entry.pkg.name, entry.subpath, alias.name)
      const described = describeExport(checker, render, symbol, alias.name, declaration)
      const current: Entity = {
        id: exportId,
        kind: described.isType ? 'type' : 'export',
        label: alias.name,
        data: {signature: described.signature, package: entry.pkg.name, subpath: entry.subpath, contract: described.contract},
        evidence: evidence(project, declaration),
        confidence: 'authoritative',
      }
      const previous = nodes.get(exportId)
      if (previous && surfaces.get(exportId) !== described.surface)
        throw new Error(
          `Conflicting public exports for ${code(`${entry.pkg.name}:${entry.subpath}:${alias.name}`)}; give entrypoints distinct subpath keys`,
        )
      if (previous) continue
      surfaces.set(exportId, described.surface)
      nodes.set(exportId, current)
      if (described.structured) members.add(exportId, symbol, declaration, described.declared)
    }
  }
  return extraction('api/v0', sort([...nodes.values()]), sort(edges), {
    ecosystem: 'typescript',
    analysis: 'TypeScript checker public exports; implementation bodies and private members excluded',
    limitations: [
      'Conditional exports are combined; conflicting surfaces require explicit subpath entrypoints.',
      'Declaration merging and structural types use checker-visible public shape.',
    ],
  })
}
