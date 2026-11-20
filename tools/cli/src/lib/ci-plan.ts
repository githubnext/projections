// What CI runs for a change (CONTRIBUTING.md#what-ci-runs): the changed files' workspaces and crates and everything
// depending on them (affected.ts's graph), mapped to the jobs that test them. Pull requests run what their change
// reaches; pushes to main, the nightly run, a manual run and the `ci:full` label run everything, as does a change to
// CI itself, a toolchain, a lockfile or root manifest, or the repository's tooling.
import {kindsOf} from './affected.ts'
import {browserJobs, HARNESS, type BrowserJob} from './ci-browser.ts'
import type {RepoFacts} from './ci-facts.ts'
import {sortChanges} from './ci-files.ts'
import {dependantsOf} from './packages.ts'
import {matches} from './repo.ts'

/** Workspaces whose code runs only in a browser: a change to these alone needs no macOS or Windows run. */
const browserOnly = ['packages/renderers/**', 'packages/host/**', 'tools/storybook', 'examples/renderers/**']
/** The suites whose tests run against the native CLI's backend (`projections serve`), which runs no extractor. */
export const nativeBackend = [HARNESS, 'packages/host/inspector', 'examples/renderers/minimal']
const CLI = 'packages/cli'
const SDK = 'packages/sdk'
const ENGINE = ['packages/engine', 'packages/engine/verified']

export type CiPlan = {
  /** Why everything runs; empty when the plan follows the change. */
  full: string[]
  files: number
  /** Changed workspaces and crates, and those depending on them. */
  changed: string[]
  dependants: string[]
  /** Changed files outside every workspace and crate that run everything. */
  unattributed: string[]
  generators: string[]
  flags: {
    docsOnly: boolean
    rust: boolean
    engine: boolean
    /** The renderers the harness is limited to; empty when it runs all or none. */
    renderers: string[]
    host: boolean
    inspector: boolean
    storybook: boolean
    cli: boolean
    action: boolean
    windows: boolean
    release: boolean
    workflows: boolean
  }
  jobs: {
    docs: boolean
    product: string[]
    verus: boolean
    windows: boolean
    windowsNode: boolean
    package: boolean
    release: boolean
    coverage: boolean
    mutants: boolean
    actionsLock: boolean
  }
  browser: BrowserJob[]
  browserMacos: BrowserJob[]
}

/** Each browser suite reached by `changed`: through its own graph, a workspace its script builds, or the CLI backend. */
function affectedSuites(facts: RepoFacts, changed: readonly string[]): Set<string> {
  const reached = new Set([...changed, ...dependantsOf(facts.units, changed)])
  const backend = changed.filter(path => !path.startsWith('packages/extractors/'))
  const backendReached = backend.includes(CLI) || dependantsOf(facts.units, backend).includes(CLI)
  return new Set(
    facts.browserSuites
      .filter(
        suite =>
          reached.has(suite.path) || suite.uses.some(path => reached.has(path)) || (nativeBackend.includes(suite.path) && backendReached),
      )
      .map(suite => suite.path),
  )
}

/** The renderers to limit the harness to: when the harness runs only because of changes to renderers it tests. */
function harnessRenderers(facts: RepoFacts, changed: readonly string[], suites: ReadonlySet<string>): string[] {
  if (!suites.has(HARNESS)) return []
  const renderers = changed
    .flatMap(path => /^packages\/renderers\/([^/]+)$/.exec(path)?.[1] ?? [])
    .filter(name => facts.harnessRenderers.includes(name))
  const others = changed.filter(path => !renderers.some(name => path === `packages/renderers/${name}`))
  if (!renderers.length || renderers.length === facts.harnessRenderers.length || affectedSuites(facts, others).has(HARNESS)) return []
  return renderers
}

export function ciPlan(facts: RepoFacts, paths: readonly string[], reasons: readonly string[] = []): CiPlan {
  const generators = new Set<string>()
  const sorted = sortChanges(facts, paths, generators)
  const full = [...reasons, ...sorted.everything.map(path => `changed ${path}`)]
  const all = full.length > 0
  const built = [...sorted.units].sort()
  const changed = [...new Set([...built, ...sorted.tested])].sort()
  const dependants = dependantsOf(facts.units, built).filter(path => !changed.includes(path))
  const reached = new Set([...changed, ...dependants])
  const crates = new Set(facts.units.filter(unit => unit.kinds.includes('crate')).map(unit => unit.path))
  const rust = all || kindsOf(paths).includes('rust') || changed.some(path => crates.has(path))
  const engine = all || changed.some(path => ENGINE.includes(path))
  const action = all || sorted.action.length > 0
  const platform = all || rust || action || changed.some(path => !matches(path, browserOnly))
  const release = all || sorted.release.length > 0 || generators.has('release-workflow')
  const docsOnly = !all && !changed.length && !generators.size && !sorted.checks.length && !sorted.release.length && !sorted.action.length
  const suites = all ? new Set(facts.browserSuites.map(suite => suite.path)) : affectedSuites(facts, built)
  const renderers = all ? [] : harnessRenderers(facts, built, suites)
  const browser = browserJobs(
    facts.browserSuites.map(suite => suite.path),
    suites,
    renderers.length ? {kept: renderers, others: facts.harnessRenderers.filter(name => !renderers.includes(name))} : undefined,
  )
  return {
    full,
    files: paths.length,
    changed,
    dependants,
    unattributed: sorted.everything,
    generators: [...generators].sort(),
    flags: {
      docsOnly,
      rust,
      engine,
      renderers,
      host: suites.has('packages/host/core'),
      inspector: suites.has('packages/host/inspector'),
      storybook: suites.has('tools/storybook'),
      cli: all || reached.has(CLI),
      action,
      windows: platform,
      release,
      workflows: paths.some(path => matches(path, ['.github/workflows/**', '.github/actions/**'])),
    },
    jobs: {
      docs: docsOnly,
      product: docsOnly ? [] : ['ubuntu-latest', ...(platform ? ['macos-latest'] : [])],
      verus: engine,
      windows: rust,
      windowsNode: platform,
      package: all || rust || reached.has(SDK) || changed.includes(CLI),
      release,
      coverage: all || facts.coverage.some(path => reached.has(path)),
      mutants: all || paths.some(path => matches(path, facts.mutants.examine) && !matches(path, facts.mutants.exclude)),
      actionsLock: all,
    },
    browser: browser.linux,
    browserMacos: browser.macos,
  }
}
