// Self topology, part of extract.mjs: its units, from the workspace manifests, components and helpers.
import {execFileSync} from 'node:child_process'
import path from 'node:path'
import {byText, posix, sortedUnique} from './files.mjs'

// A root is a project-relative directory; `''` (written `.`) is the project itself.
export const prefixOf = rootPath => (rootPath ? `${rootPath}/` : '')
export const join = (rootPath, relative) => (relative === '' ? rootPath : `${prefixOf(rootPath)}${relative}`)

/** The units of every root, their manifest dependencies, and the helpers that place a unit's path below its root. */
export function discoverUnits({repo, roots, files, fileSet, read, excluded}) {
  const units = new Map()
  const unitByPackage = new Map() // npm package or crate name -> unit id
  const unitByCrateIdent = new Map() // crate_name with underscores -> unit id
  const manifestDependencies = []

  // A directory path matches at the start or after any `/`: `cli/templates/` excludes `packages/cli/templates/x`.
  /**
   * The directory a root keeps its workspaces' groups in: the deepest one holding every glob pattern's directory
   * (`packages/` for `packages/renderers/*` and `packages/extractors/*`, nothing for `renderers/*` and `extractors/*`).
   * Names, areas and path IDs start below it.
   */
  function containerFor(globs) {
    const parents = sortedUnique(globs.map(pattern => path.posix.dirname(pattern.split('*')[0].replace(/\/$/u, ''))))
    const segments = parents.map(parent => (parent === '.' ? [] : parent.split('/')))
    if (!segments.length) return ''
    const common = segments.reduce((shared, next) =>
      shared.slice(
        0,
        [...shared, null].findIndex((segment, index) => segment !== next[index]),
      ),
    )
    return common.length ? `${common.join('/')}/` : ''
  }
  const containerOf = unit => roots.find(root => root.path === unit.root)?.container ?? ''
  const belowContainer = (unit, relative) =>
    containerOf(unit) && relative.startsWith(containerOf(unit)) ? relative.slice(containerOf(unit).length) : relative

  const isExcluded = relative =>
    excluded.some(prefix => {
      const directory = prefix.replace(/\/$/u, '')
      return `/${relative}/`.includes(`/${directory}/`)
    })
  // A root is a repository-relative directory; `''` (written `.`) is the repository itself.
  const relativeDirectory = unit => unit.directory.slice(prefixOf(unit.root).length)

  function addUnit(unit) {
    units.set(unit.id, {...unit, capabilityFiles: {}, evidence: []})
    return unit.id
  }

  for (const root of roots) {
    const rootPath = root.path
    const area = root.area ?? (rootPath || '.')
    const prefix = prefixOf(rootPath)
    const scan = root.capabilities !== false

    // Cargo crates.
    if (fileSet.has(`${prefix}Cargo.toml`)) {
      let metadata
      try {
        metadata = JSON.parse(
          execFileSync('cargo', ['metadata', '--no-deps', '--offline', '--format-version', '1'], {
            cwd: path.join(repo, rootPath),
            maxBuffer: 64 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
          }).toString('utf8'),
        )
      } catch (error) {
        process.stderr.write(`cargo metadata failed in ${rootPath || '.'}: ${error.stderr ?? error.message}\n`)
        process.exit(1)
      }
      const workspaceRoot = posix(metadata.workspace_root)
      for (const pkg of [...metadata.packages].sort((a, b) => byText(a.name, b.name))) {
        const directory = posix(path.relative(workspaceRoot, path.dirname(pkg.manifest_path)))
        if (isExcluded(directory)) continue
        const targets = sortedUnique(
          pkg.targets.flatMap(target => target.kind).filter(kind => !['test', 'example', 'bench', 'custom-build'].includes(kind)),
        )
        const manifest = `${join(rootPath, directory)}/Cargo.toml`
        const id = addUnit({
          id: `crate:${pkg.name}`,
          kind: 'rust-crate',
          label: directory || rootPath || '.',
          root: rootPath,
          directory: join(rootPath, directory),
          language: 'rust',
          scan,
          manifest,
          data: {area, package: pkg.name, path: join(rootPath, directory), targets},
          meta: {description: pkg.description ?? undefined},
        })
        unitByPackage.set(pkg.name, id)
        unitByCrateIdent.set(pkg.name.replace(/-/gu, '_'), id)
        for (const dependency of pkg.dependencies) {
          if (!dependency.path) continue
          manifestDependencies.push({
            from: id,
            name: dependency.name,
            kind: dependency.kind === 'dev' ? 'dev-depends-on' : 'depends-on',
            via: `Cargo ${dependency.kind ?? 'normal'} dependency${dependency.target ? ` (${dependency.target})` : ''}`,
            source: manifest,
          })
        }
      }
    }

    // npm workspace packages (or, without workspaces, the packages one level down).
    const rootManifest = `${prefix}package.json`
    const workspacePatterns = fileSet.has(rootManifest) ? (JSON.parse(read(rootManifest)).workspaces ?? []) : null
    // The workspaces' glob patterns, npm's and Cargo's, which say where the root keeps its groups of units.
    const cargoMembers = /^\s*members\s*=\s*\[([^\]]*)\]/mu.exec(read(`${prefix}Cargo.toml`))?.[1] ?? ''
    root.globs = [...(workspacePatterns ?? []), ...[...cargoMembers.matchAll(/["']([^"']+)["']/gu)].map(([, member]) => member)].filter(
      pattern => pattern.includes('*') && !isExcluded(pattern.split('*')[0].replace(/\/$/u, '')),
    )
    root.container = containerFor(root.globs)
    // IDs of units without a package name are their paths below the container, so moving the workspaces keeps them.
    const stable = directory => join(rootPath, directory.startsWith(root.container) ? directory.slice(root.container.length) : directory)
    const manifests = files.filter(file => {
      if (!file.startsWith(prefix) || !file.endsWith('/package.json')) return false
      const directory = file.slice(prefix.length, -'/package.json'.length)
      if (isExcluded(directory) || /(?:^|\/)(?:node_modules|fixtures|test|tests)(?:\/|$)/u.test(directory)) return false
      if (workspacePatterns === null) return directory.split('/').length === 1
      return workspacePatterns.some(pattern =>
        new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '[^/]+')}$`).test(directory),
      )
    })
    for (const manifest of manifests) {
      const directory = manifest.slice(prefix.length, -'/package.json'.length)
      const pkg = JSON.parse(read(manifest))
      if (!pkg.name) continue
      const id = addUnit({
        id: `npm:${pkg.name}`,
        kind: 'npm-package',
        label: root === roots[0] ? directory : join(rootPath, directory),
        root: rootPath,
        directory: join(rootPath, directory),
        language: 'javascript',
        scan,
        manifest,
        data: {area, package: pkg.name, path: join(rootPath, directory), private: pkg.private === true},
        meta: {
          description: typeof pkg.description === 'string' ? pkg.description : undefined,
          vscode: Boolean(pkg.engines?.vscode),
          react: Boolean(pkg.dependencies?.react || pkg.peerDependencies?.react),
        },
      })
      unitByPackage.set(pkg.name, id)
      for (const [section, kind, via] of [
        ['dependencies', 'depends-on', 'npm dependency'],
        ['peerDependencies', 'depends-on', 'npm peer dependency'],
        ['optionalDependencies', 'depends-on', 'npm optional dependency'],
        ['devDependencies', 'dev-depends-on', 'npm dev dependency'],
      ]) {
        for (const name of Object.keys(pkg[section] ?? {}).sort(byText)) {
          manifestDependencies.push({from: id, name, kind, via, source: manifest})
        }
      }
    }

    // Components without a manifest, named by the `components` input's directory patterns; a matching directory with a
    // manifest is already a unit.
    const componentPatterns = (root.components ?? (root === roots[0] ? ['integrations/*'] : [])).map(
      pattern => new RegExp(`(^|/)${pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '[^/]+')}$`),
    )
    const componentDirectories = sortedUnique(
      files
        .filter(file => file.startsWith(prefix))
        .flatMap(file => {
          const segments = file.slice(prefix.length).split('/').slice(0, -1)
          return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
        })
        .filter(directory => componentPatterns.some(pattern => pattern.test(directory)))
        .filter(directory => !fileSet.has(`${prefix}${directory}/package.json`) && !fileSet.has(`${prefix}${directory}/Cargo.toml`)),
    )
    for (const directory of componentDirectories) {
      addUnit({
        id: `component:${stable(directory)}`,
        kind: 'component',
        label: directory,
        root: rootPath,
        directory: join(rootPath, directory),
        language: 'javascript',
        scan,
        data: {area, path: join(rootPath, directory)},
      })
    }

    // Out-of-process helpers: a `helper` directory inside a unit, written in another language.
    const helperLanguages = {'.go': 'go', '.py': 'python', '.java': 'java', '.cs': 'csharp'}
    const helperDirectories = new Map()
    for (const file of files) {
      const match = file.startsWith(prefix) && /^(.*\/helper)\/.+(\.[a-z]+)$/u.exec(file)
      if (!match || !helperLanguages[match[2]] || isExcluded(match[1].slice(prefix.length))) continue
      const counts = helperDirectories.get(match[1]) ?? {}
      counts[helperLanguages[match[2]]] = (counts[helperLanguages[match[2]]] ?? 0) + 1
      helperDirectories.set(match[1], counts)
    }
    for (const [directory, counts] of [...helperDirectories].sort(([a], [b]) => byText(a, b))) {
      const language = Object.entries(counts).sort(([a, x], [b, y]) => y - x || byText(a, b))[0][0]
      addUnit({
        id: `helper:${stable(directory.slice(prefix.length))}`,
        kind: 'helper',
        label: directory.slice(prefix.length),
        root: rootPath,
        directory,
        language,
        scan,
        data: {area, path: directory, language},
      })
    }
  }
  return {units, unitByPackage, unitByCrateIdent, manifestDependencies, addUnit, containerOf, belowContainer, relativeDirectory}
}
