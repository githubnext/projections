// Self topology, part of extract.mjs: relationships from manifests, and the WebAssembly modules builds write.
import path from 'node:path'
import {sortedUnique} from './files.mjs'

// String literals, with interpolations collapsed to `@`.
export function literals(lines) {
  const found = []
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`/g))
      found.push({value: (match[1] ?? match[2] ?? match[3]).replace(/\$\{[^}]*\}/g, '@'), line: index + 1})
  })
  return found
}

/** The relationships the manifests declare and the WebAssembly modules builds compile, with what later passes need. */
export function manifestRelationships(cx) {
  const {
    units,
    unitByPackage,
    unitByCrateIdent,
    manifestDependencies,
    addUnit,
    relativeDirectory,
    unitFiles,
    linesOf,
    read,
    devDependencies,
  } = cx
  const relationships = new Map()
  function relate(kind, from, to, via, evidence, confidence) {
    if (!from || !to || from === to) return
    const id = `${kind}:${from}->${to}`
    const existing = relationships.get(id)
    if (existing) {
      existing.via.add(via)
      if (evidence && existing.evidence.length < 20 && !existing.evidence.some(item => item.source === evidence.source))
        existing.evidence.push(evidence)
      return
    }
    relationships.set(id, {id, kind, from, to, via: new Set([via]), evidence: evidence ? [evidence] : [], confidence})
  }

  const lineOf = (file, needle) => {
    const index = read(file)
      .split('\n')
      .findIndex(line => line.includes(needle))
    return index < 0 ? undefined : {line: index + 1}
  }

  for (const dependency of manifestDependencies) {
    const to = unitByPackage.get(dependency.name)
    if (!to || (dependency.kind === 'dev-depends-on' && !devDependencies)) continue
    const location = lineOf(dependency.source, `"${dependency.name}"`) ?? lineOf(dependency.source, dependency.name)
    relate(dependency.kind, dependency.from, to, dependency.via, {kind: 'manifest', source: dependency.source, location}, 'authoritative')
  }

  // The unit owning a repository path: the deepest unit directory containing it (a helper over its parent crate).
  function unitAtPath(root, target) {
    // Built JavaScript (`dist/extractor.mjs`) belongs to the npm package where a crate shares its directory.
    const language = /\.(m|c)?[jt]sx?$/.test(target) || /(^|\/)dist(\/|$)/.test(target) ? 'javascript' : null
    const rank = unit => (unit.kind === 'helper' ? 2 : unit.language === language ? 1 : 0)
    let best = null
    for (const unit of units.values()) {
      if (unit.root !== root || unit.single || unit.kind === 'wasm-module') continue
      if (target !== unit.directory && !target.startsWith(`${unit.directory}/`)) continue
      if (
        !best ||
        unit.directory.length > best.directory.length ||
        (unit.directory.length === best.directory.length && rank(unit) > rank(best))
      )
        best = unit
    }
    return best
  }

  // Whether a root-relative literal (`@/comparators/default/dist/x`) names a path inside a unit other than these.
  const namesOtherUnit = (value, root, ...own) =>
    [...units.values()].some(
      unit =>
        unit.root === root &&
        !unit.single &&
        unit.directory !== root &&
        !own.includes(unit.id) &&
        `/${value}`.includes(`/${relativeDirectory(unit)}/`),
    )

  // Pass 1: WebAssembly modules. A build file that compiles a crate for wasm32 names the module it writes.
  const wasmModules = new Map() // module file name -> unit id
  for (const unit of [...units.values()]) {
    for (const entry of unitFiles.get(unit.id)) {
      if (entry.role !== 'build' || entry.language !== 'javascript' || !read(entry.file).includes('wasm32-unknown-unknown')) continue
      const values = literals(linesOf(entry))
      const compiled = sortedUnique(
        values.map(item => /wasm32-unknown-unknown\/release\/([a-z0-9_]+)\.wasm$/.exec(item.value)?.[1]).filter(Boolean),
      )
      for (const ident of compiled) {
        const crate = unitByCrateIdent.get(ident)
        if (!crate) continue
        const written = values.find(item => {
          if (!/\.wasm$/.test(item.value) || item.value.includes('wasm32-unknown-unknown')) return false
          if (/^\.\.?\//.test(item.value)) {
            const owner = unitAtPath(unit.root, path.posix.normalize(path.posix.join(path.posix.dirname(entry.file), item.value)))
            return !owner || owner.id === unit.id || owner.id === crate
          }
          return !namesOtherUnit(item.value.replace(/^@\//, ''), unit.root, unit.id, crate)
        })
        const name = path.posix.basename(written?.value ?? `${ident}.wasm`)
        const id = `wasm:${name}`
        if (!units.has(id)) {
          const crateUnit = units.get(crate)
          addUnit({
            id,
            kind: 'wasm-module',
            label: name,
            root: crateUnit.root,
            directory: `${crateUnit.directory}#${name}`,
            language: 'wasm',
            scan: false,
            data: {area: crateUnit.data.area, crate: crateUnit.data.package, module: name, target: 'wasm32-unknown-unknown'},
          })
          unitFiles.set(id, [])
          wasmModules.set(name, id)
        }
        const at = values.find(item => item.value.endsWith(`/${ident}.wasm`))
        relate(
          'compiles-to',
          crate,
          id,
          'cargo build --target wasm32-unknown-unknown',
          {kind: 'build', source: entry.file, location: {line: at?.line ?? 1}},
          'derived',
        )
        if (unit.id !== crate)
          relate(
            'bundles',
            unit.id,
            id,
            `writes ${name}`,
            {kind: 'build', source: entry.file, location: {line: written?.line ?? 1}},
            'derived',
          )
      }
    }
  }
  return {relationships, relate, unitAtPath, wasmModules}
}
