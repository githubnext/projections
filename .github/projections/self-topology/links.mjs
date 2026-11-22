// Self topology, part of extract.mjs: what builds bundle, what loads WebAssembly, and the runtime boundaries in production source.
import path from 'node:path'
import {byText} from './files.mjs'
import {patterns} from './capabilities.mjs'
import {literals} from './relationships.mjs'

/** Relates units by what their build files bundle and their sources load, spawn and message. */
export function linkUnits({units, unitByPackage, unitByCrateIdent, unitFiles, linesOf, relate, unitAtPath, wasmModules}) {
  // Pass 2: what build files bundle, and which WebAssembly modules any file loads.
  const helperAssets = new Map() // installed helper asset (`helpers/go`) -> unit id
  const cliCrate = [...units.values()].find(
    unit => unit.kind === 'rust-crate' && unit.data.targets.includes('bin') && /(^|\/)cli$/.test(unit.directory),
  )
  const packageNames = [...unitByPackage.keys()].toSorted((a, b) => b.length - a.length || byText(a, b))
  const namedPackage = specifier => packageNames.find(name => specifier === name || specifier.startsWith(`${name}/`))

  for (const unit of [...units.values()]) {
    for (const entry of unitFiles.get(unit.id) ?? []) {
      if (entry.role === 'test') continue
      const values = literals(linesOf(entry))
      const evidence = line => ({kind: entry.role, source: entry.file, location: {line}})

      if (entry.role === 'build') {
        values.forEach((item, index) => {
          // A relative path into another unit: its built output is bundled or embedded here.
          if (/^\.\.?\//.test(item.value) && !/\.wasm$/.test(item.value)) {
            const bases = entry.language === 'rust' ? [unit.directory, path.posix.dirname(entry.file)] : [path.posix.dirname(entry.file)]
            for (const base of bases) {
              const owner = unitAtPath(unit.root, path.posix.normalize(path.posix.join(base, item.value.replace(/@.*$/, ''))))
              if (!owner || owner.id === unit.id) continue
              relate('bundles', unit.id, owner.id, `${item.value}`, evidence(item.line), 'derived')
              const previous = values[index - 1]
              if (previous && /^helpers\//.test(previous.value)) helperAssets.set(previous.value, owner.id)
              break
            }
          }
          // A workspace package a build names (vite, tsdown, collectRenderers): bundled.
          const named = namedPackage(item.value)
          if (named && units.get(unitByPackage.get(named)).kind === 'npm-package') {
            relate('bundles', unit.id, unitByPackage.get(named), `${item.value}`, evidence(item.line), 'derived')
          }
        })
      }

      for (const item of values) {
        const match = /(^|[/@])([a-z0-9-]+\.wasm)$/.exec(item.value)
        const module = match && wasmModules.get(match[2])
        if (!module || units.get(module).data.crate === unit.data.package) continue
        relate(entry.role === 'build' ? 'bundles' : 'loads', unit.id, module, `${item.value}`, evidence(item.line), 'derived')
      }
    }
  }

  // Pass 3: runtime boundaries in production source.
  for (const unit of [...units.values()]) {
    for (const entry of unitFiles.get(unit.id) ?? []) {
      if (entry.role !== 'source') continue
      const lines = linesOf(entry)
      const text = lines.join('\n')
      const values = literals(lines)
      const evidence = line => ({kind: 'source', source: entry.file, location: {line}})
      const firstLine = pattern => lines.findIndex(line => pattern.test(line)) + 1 || 1

      // Spawning the Projections CLI: a process call beside the CLI's own markers.
      const spawns =
        entry.language === 'shell'
          ? /^\s*exec\s/m.test(text)
          : entry.language === 'javascript' &&
            /\b(spawn|spawnSync|execFile|execFileSync|exec|execSync)\s*\(/.test(text) &&
            patterns.javascript.process.test(text)
      if (spawns && cliCrate && unit.id !== cliCrate.id) {
        const serve = values.some(item => item.value === 'serve') && values.some(item => item.value === '--stdio')
        const mcp = values.some(item => item.value === 'mcp')
        const named =
          /\bPROJECTIONS_CLI\b/.test(text) ||
          values.some(item => item.value === 'projections' || /(^|\/)cli\/dist\/projections$/.test(item.value))
        if (serve || mcp || named) {
          const protocol = serve ? 'serve --stdio (JSON-RPC over stdio)' : mcp ? 'mcp (MCP over stdio)' : 'command line'
          const marker = serve ? /--stdio/ : mcp ? /['"]mcp['"]/ : /PROJECTIONS_CLI|cli\/dist\/projections|['"]projections['"]/
          relate('spawns', unit.id, cliCrate.id, protocol, evidence(firstLine(marker)), 'inferred')
        }
      }

      if (entry.language === 'rust') {
        // A file of another unit compiled in (`include_str!`, `include_bytes!`) ships inside this one.
        lines.forEach((line, index) => {
          for (const [, macro, relative] of line.matchAll(/\b(include_str|include_bytes)!\s*\(\s*"([^"]+)"\s*\)/g)) {
            const owner = unitAtPath(unit.root, path.posix.normalize(path.posix.join(path.posix.dirname(entry.file), relative)))
            if (owner && owner.directory !== unit.directory) {
              relate('bundles', unit.id, owner.id, `${macro}!("${relative}")`, evidence(index + 1), 'derived')
            }
          }
        })
        // The CLI runs built-in extractors as its own hidden subcommand, from the catalog crate it links.
        if (values.some(item => item.value === '__extract')) {
          for (const [ident, target] of unitByCrateIdent) {
            if (target !== unit.id && new RegExp(`\\b${ident}::`).test(text)) {
              relate(
                'spawns',
                unit.id,
                target,
                'projections __extract (extraction JSON over stdio)',
                evidence(firstLine(/__extract/)),
                'inferred',
              )
            }
          }
        }
        // Extractors that run a helper by its installed asset name.
        if (/\b(helper|run_helper)\s*\(/.test(text)) {
          for (const item of values) {
            const asset = [...helperAssets.keys()].find(name => item.value === name || item.value.startsWith(`${name}/`))
            if (asset) relate('spawns', unit.id, helperAssets.get(asset), `${item.value} (helper process)`, evidence(item.line), 'inferred')
          }
        }
      }

      // postMessage peers: a file that messages, importing another workspace package that messages.
      if (entry.language === 'javascript' && patterns.javascript.messaging.test(text)) {
        for (const match of text.matchAll(/(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g)) {
          const named = namedPackage(match[1])
          const target = named && unitByPackage.get(named)
          if (!target || target === unit.id || !(units.get(target).capabilityFiles.messaging?.length > 0)) continue
          relate(
            'messages',
            unit.id,
            target,
            `postMessage, with ${match[1]}`,
            evidence(firstLine(patterns.javascript.messaging)),
            'inferred',
          )
        }
      }
    }
  }
}
