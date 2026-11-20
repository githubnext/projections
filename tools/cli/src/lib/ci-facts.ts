// What the CI plan (ci-plan.ts) reads from the repository rather than keeping its own lists: the workspace and crate
// graph, the browser suites and what their scripts build, the renderers the harness tests, the crates coverage and
// mutation testing examine, and the generator registry.
import {existsSync, readdirSync} from 'node:fs'
import {join, posix} from 'node:path'
import {generators, type Generator} from './generated.ts'
import {findUnit, loadUnits, ownerOf, type Unit} from './packages.ts'
import {git, matches, readJson, readText} from './repo.ts'

export type BrowserSuite = {
  /** The workspace with a `test:browser` script. */
  path: string
  /** Workspaces its `test:browser` script builds first (`--workspace <name>`), such as the Storybook. */
  uses: string[]
}

export type RepoFacts = {
  units: Unit[]
  browserSuites: BrowserSuite[]
  /** packages/renderers/<name> directories with a scenarios.json: the renderers the harness runs. */
  harnessRenderers: string[]
  /** .cargo/mutants.toml's examine_globs and exclude_globs. */
  mutants: {examine: string[]; exclude: string[]}
  /** The crates `npm run test:rust:coverage` measures (its `-p` arguments). */
  coverage: string[]
  generators: Generator[]
  /** Files and directories crates read at build or test time besides their sources: edges the manifests don't have. */
  fileInputs: FileInput[]
}

export type FileInput = {
  crate: string
  path: string
  /** Read only by its tests (`tests/`, `benches/`): the crate's own suites need running, its dependants don't change. */
  test: boolean
}

type Manifest = {scripts?: Record<string, string>}

/** The workspaces a script names with `--workspace <name>`. */
function workspacesNamed(units: readonly Unit[], script: string): string[] {
  const names = [...script.matchAll(/--workspace[= ](\S+)/g)].map(match => match[1] as string)
  return names.flatMap(name => findUnit(units, name)?.path ?? [])
}

/** The strings of a TOML array (`key = [...]`), skipping comment lines. */
export function tomlStrings(text: string, key: string): string[] {
  const body = new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)^\\]`, 'm').exec(text)?.[1] ?? ''
  const lines = body.split('\n').filter(line => !line.trim().startsWith('#'))
  return [...lines.join('\n').matchAll(/"([^"]*)"|'([^']*)'/g)].map(match => (match[1] ?? match[2]) as string)
}

const includes = [
  // include_str!("../x.json") and include_bytes!, relative to the source file.
  {pattern: /include_(?:str|bytes)!\(\s*"([^"]+)"\s*\)/g, fromCrate: false},
  // concat!(env!("CARGO_MANIFEST_DIR"), "/../x") and Path::new(env!("CARGO_MANIFEST_DIR")).join("../x"), relative to the crate.
  {pattern: /env!\("CARGO_MANIFEST_DIR"\)\s*,\s*"\/?([^"]+)"/g, fromCrate: true},
  {pattern: /env!\("CARGO_MANIFEST_DIR"\)\)\.join\("([^"]+)"\)/g, fromCrate: true},
]

/** What each crate's Rust sources read by path. The repository root and the crate's ancestors are left out: too broad. */
export function crateFileInputs(root: string, units: readonly Unit[]): FileInput[] {
  const found = new Map<string, FileInput>()
  for (const file of (git(root, ['ls-files', '*.rs']) ?? '').split('\n').filter(Boolean)) {
    const crate = ownerOf(units, file)
    if (!crate?.kinds.includes('crate')) continue
    const text = readText(root, file) ?? ''
    for (const {pattern, fromCrate} of includes) {
      for (const match of text.matchAll(pattern)) {
        const path = posix.normalize(posix.join(fromCrate ? crate.path : posix.dirname(file), match[1] as string)).replace(/\/$/, '')
        if (path.startsWith('..') || path === '.' || crate.path === path || crate.path.startsWith(`${path}/`)) continue
        const test = /^(tests|benches)\//.test(posix.relative(crate.path, file))
        const key = `${crate.path} ${path}`
        found.set(key, {crate: crate.path, path, test: test && (found.get(key)?.test ?? true)})
      }
    }
  }
  return [...found.values()].sort((a, b) => a.crate.localeCompare(b.crate) || a.path.localeCompare(b.path))
}

/** The crates that read `path`, directly or as the output of a generator it is an input of, and whether only in tests. */
export function crateConsumers(facts: Pick<RepoFacts, 'fileInputs' | 'generators'>, path: string): {build: string[]; test: string[]} {
  const outputs = facts.generators.filter(generator => matches(path, generator.inputs)).flatMap(generator => generator.outputs)
  const reads = (input: string) =>
    path === input ||
    path.startsWith(`${input}/`) ||
    matches(input, outputs) ||
    outputs.some(glob => glob.slice(0, glob.search(/[*?]|$/)).startsWith(`${input}/`))
  const readers = facts.fileInputs.filter(input => reads(input.path))
  const build = [...new Set(readers.filter(input => !input.test).map(input => input.crate))].sort()
  const test = [...new Set(readers.filter(input => input.test).map(input => input.crate))].filter(crate => !build.includes(crate)).sort()
  return {build, test}
}

export function repoFacts(root: string): RepoFacts {
  const units = loadUnits(root)
  const script = (path: string, name: string) => readJson<Manifest>(root, `${path}/package.json`)?.scripts?.[name] ?? ''
  const renderers = join(root, 'packages/renderers')
  const mutants = readText(root, '.cargo/mutants.toml') ?? ''
  const coverage = [...script('.', 'test:rust:coverage').matchAll(/-p (\S+)/g)].flatMap(
    match => findUnit(units, match[1] as string)?.path ?? [],
  )
  return {
    units,
    browserSuites: units
      .filter(unit => unit.scripts.includes('test:browser'))
      .map(unit => ({path: unit.path, uses: workspacesNamed(units, script(unit.path, 'test:browser'))})),
    harnessRenderers: readdirSync(renderers, {withFileTypes: true})
      .filter(entry => entry.isDirectory() && existsSync(join(renderers, entry.name, 'scenarios.json')))
      .map(entry => entry.name)
      .sort(),
    mutants: {examine: tomlStrings(mutants, 'examine_globs'), exclude: tomlStrings(mutants, 'exclude_globs')},
    coverage,
    generators,
    fileInputs: crateFileInputs(root, units),
  }
}
