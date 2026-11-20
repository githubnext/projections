// What the CI plan (ci-plan.ts) reads from the repository rather than keeping its own lists: the workspace and crate
// graph, the browser suites and what their scripts build, the renderers the harness tests, the crates coverage and
// mutation testing examine, and the generator registry.
import {existsSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {generators, type Generator} from './generated.ts'
import {findUnit, loadUnits, type Unit} from './packages.ts'
import {readJson, readText} from './repo.ts'

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
  }
}
