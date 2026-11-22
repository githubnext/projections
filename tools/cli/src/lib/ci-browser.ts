// The browser jobs of a CI plan (ci-plan.ts): the affected suites in the shards .github/ci-rules.json gives them, and,
// for a change to some renderers alone, the renderer harness without the other renderers' tests.

export interface BrowserJob {
  /** The job's name in the checks list, after `browser`. */
  name: string
  /** A workspace directory, or `rest`: every other affected browser suite in one job. */
  suite: string
  project: string
  shard: string
  /** A Playwright --grep-invert: the other renderers' tests, left out. */
  grepInvert: string
  /** With `rest`, the suites it leaves out (comma-separated). */
  except: string
}

/** Shards per Playwright project (`''` for a suite run without one), by suite. */
export type Layout = Record<string, Record<string, number>>

/**
 * Matches renderers' own specs (by their path) and the harness tests whose title starts with one of their names or
 * scenario keys (`graph: …`, `graph/service-platform: …`), which exercise only that renderer. Inverted, it leaves those
 * out and keeps every other test, including those that span renderers (`graph diffs at 1440px` also draws
 * dependency-injection's scenarios).
 */
export function rendererGrep(renderers: readonly string[]): string {
  const names = renderers.join('|')
  return `(^|[\\s/])(${names})/browser/|\\.spec\\.ts (${names})[/:]`
}

interface Narrow {
  suite: string
  kept: string[]
  others: readonly string[]
}

function shards(suite: string, projects: Record<string, number>, filter: Narrow | undefined): BrowserJob[] {
  return Object.entries(projects).flatMap(([project, count]) => {
    const total = filter ? Math.min(count, filter.kept.length) : count
    return Array.from({length: total}, (_, index) => {
      const shard = total > 1 ? `${index + 1}/${total}` : ''
      const label = [suite, project, shard].filter(Boolean).join(', ')
      return {
        name: filter ? `${label} (${filter.kept.join(', ')})` : label,
        suite,
        project,
        shard,
        grepInvert: filter ? rendererGrep(filter.others) : '',
        except: '',
      }
    })
  })
}

/**
 * The jobs for the affected suites. `narrow`, when set, leaves the other renderers' tests out of its suite: one job per
 * project for one kept renderer, as many shards as kept renderers (up to the full layout's) for more.
 */
export function browserJobs(
  all: readonly string[],
  affected: ReadonlySet<string>,
  layouts: {linux: Layout; macos: Layout},
  narrow: Narrow | undefined,
): {linux: BrowserJob[]; macos: BrowserJob[]} {
  const jobs = (layout: Layout) =>
    Object.entries(layout)
      .filter(([suite]) => affected.has(suite))
      .flatMap(([suite, projects]) => shards(suite, projects, suite === narrow?.suite ? narrow : undefined))
  const rest = all.filter(suite => !(suite in layouts.linux))
  const restAffected = rest.filter(suite => affected.has(suite))
  const except = [...Object.keys(layouts.linux), ...rest.filter(suite => !affected.has(suite))]
  const restJob: BrowserJob = {name: 'rest', suite: 'rest', project: '', shard: '', grepInvert: '', except: except.join(',')}
  return {linux: [...jobs(layouts.linux), ...(restAffected.length ? [restJob] : [])], macos: jobs(layouts.macos)}
}
