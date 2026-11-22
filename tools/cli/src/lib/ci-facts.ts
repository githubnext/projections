// What the CI plan (ci-plan.ts) reads from the repository rather than keeping its own lists: the workspace and crate
// graph, the browser suites and what their scripts build, the renderers the harness tests, the crates coverage and
// mutation testing examine, and the generator registry.
import {existsSync, readdirSync} from 'node:fs'
import {join, posix} from 'node:path'
import {withBuildDependencies} from './ci-builds.ts'
import {generators, type Generator} from './generated.ts'
import {findUnit, loadUnits, ownerOf, type Unit} from './packages.ts'
import {git, readJson, readText} from './repo.ts'

export interface BrowserSuite {
  /** The workspace with a `test:browser` script. */
  path: string
  /**
   * Workspaces its `test:browser` script builds first (`--workspace <name>`), such as the Storybook, and those under
   * its Playwright `testDir` when that is outside it (the renderer harness runs every renderer's specs).
   */
  uses: string[]
}

export interface RepoFacts {
  /** The workspaces and crates, with the build dependencies their manifests don't declare (ci-builds.ts). */
  units: Unit[]
  browserSuites: BrowserSuite[]
  /** packages/renderers/<name> directories with a scenarios.json: the renderers the harness runs. */
  harnessRenderers: string[]
  /** .cargo/mutants.toml's examine_globs and exclude_globs. */
  mutants: {examine: string[]; exclude: string[]}
  /** The crates `npm run test:rust:coverage` measures (its `-p` arguments). */
  coverage: string[]
  generators: Generator[]
  /**
   * Files and directories read by path that the manifests don't declare: what crates read at build or test time
   * besides their sources, and the extractions and comparators renderers' scenarios.json files name.
   */
  fileInputs: FileInput[]
}

export interface FileInput {
  /** The crate or workspace that reads it. */
  reader: string
  path: string
  /** Read only by its tests (`tests/`, `benches/`): the crate's own suites need running, its dependants don't change. */
  test: boolean
}

interface Manifest {
  scripts?: Record<string, string>
}

/** The workspaces a script names with `--workspace <name>`. */
function workspacesNamed(units: readonly Unit[], script: string): string[] {
  const names = [...script.matchAll(/--workspace[= ](\S+)/gu)].map(match => match[1]!)
  return names.flatMap(name => findUnit(units, name)?.path ?? [])
}

/** The strings of a TOML array (`key = [...]`), skipping comment lines. */
export function tomlStrings(text: string, key: string): string[] {
  const body = new RegExp(`^${key}\\s*=\\s*\\[([\\s\\S]*?)^\\]`, 'm').exec(text)?.[1] ?? ''
  const lines = body.split('\n').filter(line => !line.trim().startsWith('#'))
  return [...lines.join('\n').matchAll(/"([^"]*)"|'([^']*)'/gu)].map(match => (match[1] ?? match[2])!)
}

const includes = [
  // include_str!("../x.json") and include_bytes!, relative to the source file.
  {pattern: /include_(?:str|bytes)!\(\s*"([^"]+)"\s*\)/gu, fromCrate: false},
  // concat!(env!("CARGO_MANIFEST_DIR"), "/../x") and Path::new(env!("CARGO_MANIFEST_DIR")).join("../x"), relative to the crate.
  {pattern: /env!\("CARGO_MANIFEST_DIR"\)\s*,\s*"\/?([^"]+)"/gu, fromCrate: true},
  {pattern: /env!\("CARGO_MANIFEST_DIR"\)\)\.join\("([^"]+)"\)/gu, fromCrate: true},
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
        const path = posix.normalize(posix.join(fromCrate ? crate.path : posix.dirname(file), match[1]!)).replace(/\/$/u, '')
        if (path.startsWith('..') || path === '.' || crate.path === path || crate.path.startsWith(`${path}/`)) continue
        const test = /^(?:tests|benches)\//u.test(posix.relative(crate.path, file))
        const key = `${crate.path} ${path}`
        found.set(key, {reader: crate.path, path, test: test && (found.get(key)?.test ?? true)})
      }
    }
  }
  return [...found.values()].sort((a, b) => a.reader.localeCompare(b.reader) || a.path.localeCompare(b.path))
}

/** The files a renderer's scenarios.json names outside its package: extractions and comparators its stories show. */
export function scenarioInputs(root: string, renderers: readonly string[]): FileInput[] {
  return renderers.flatMap(name => {
    const reader = `packages/renderers/${name}`
    const text = readText(root, `${reader}/scenarios.json`) ?? ''
    const paths = [...text.matchAll(/"(\.\.\/[^"]+)"/gu)].map(match => posix.normalize(posix.join(reader, match[1]!)))
    return [...new Set(paths)].filter(path => !path.startsWith('..')).map(path => ({reader, path, test: false}))
  })
}

/** The workspaces under a suite's Playwright `testDir`, when that is outside the suite. */
function underTestDir(root: string, units: readonly Unit[], suite: string): string[] {
  const testDir = /testDir:\s*'([^']+)'/u.exec(readText(root, `${suite}/playwright.config.ts`) ?? '')?.[1]
  if (!testDir) return []
  const directory = posix.normalize(posix.join(suite, testDir))
  if (directory === suite || directory.startsWith(`${suite}/`)) return []
  return units.map(unit => unit.path).filter(path => path !== suite && path.startsWith(`${directory}/`))
}

/**
 * What reads `path`, and whether only in tests. Generated files are committed and checked, so a change that alters a
 * generator's output includes the output, which is what its readers read.
 */
export function readersOf(facts: Pick<RepoFacts, 'fileInputs'>, path: string): {build: string[]; test: string[]} {
  const reads = (input: string) => path === input || path.startsWith(`${input}/`)
  const readers = facts.fileInputs.filter(input => reads(input.path))
  const build = [...new Set(readers.filter(input => !input.test).map(input => input.reader))].sort()
  const test = [...new Set(readers.filter(input => input.test).map(input => input.reader))].filter(reader => !build.includes(reader)).sort()
  return {build, test}
}

export function repoFacts(root: string): RepoFacts {
  const units = withBuildDependencies(root, loadUnits(root))
  const script = (path: string, name: string) => readJson<Manifest>(root, `${path}/package.json`)?.scripts?.[name] ?? ''
  const renderers = join(root, 'packages/renderers')
  const harnessRenderers = readdirSync(renderers, {withFileTypes: true})
    .filter(entry => entry.isDirectory() && existsSync(join(renderers, entry.name, 'scenarios.json')))
    .map(entry => entry.name)
    .sort()
  const mutants = readText(root, '.cargo/mutants.toml') ?? ''
  const coverage = [...script('.', 'test:rust:coverage').matchAll(/-p (\S+)/gu)].flatMap(match => findUnit(units, match[1]!)?.path ?? [])
  return {
    units,
    browserSuites: units
      .filter(unit => unit.scripts.includes('test:browser'))
      .map(unit => ({
        path: unit.path,
        uses: [...workspacesNamed(units, script(unit.path, 'test:browser')), ...underTestDir(root, units, unit.path)],
      })),
    harnessRenderers,
    mutants: {examine: tomlStrings(mutants, 'examine_globs'), exclude: tomlStrings(mutants, 'exclude_globs')},
    coverage,
    generators,
    fileInputs: [...crateFileInputs(root, units), ...scenarioInputs(root, harnessRenderers)],
  }
}
