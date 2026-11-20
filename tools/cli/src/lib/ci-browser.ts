// The browser jobs of a CI plan (ci-plan.ts): which suites run, in how many shards, and, for a change to renderers
// alone, the renderer harness without the other renderers' tests.

export type BrowserJob = {
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

export const HARNESS = 'packages/renderers/harness'

/**
 * The large suites, sharded across jobs; every other browser suite runs in `rest`. Linux WebKit is several times slower
 * than a workstation, and Playwright shards by test count, not time, so the renderer harness, the largest, shards each
 * project by its measured time (about 64, 72, 40 and 70 test-minutes on two workers), keeping each job near 20 minutes
 * of tests after about 14 of setup. The Inspector takes two (in `rest`, it took 26 of the job's 60 minutes).
 */
export const linuxLayout: Record<string, Record<string, number>> = {
  'packages/host/core': {'': 3},
  'tools/storybook': {'': 3},
  [HARNESS]: {'chromium-desktop': 3, 'webkit-desktop': 4, 'chromium-mobile': 2, 'webkit-mobile': 3},
  'packages/host/inspector': {'': 2},
}

/** WebKit on macOS, the platform Safari runs on: 10 to 30 minutes of tests after a 15-minute build. */
export const macosLayout: Record<string, Record<string, number>> = {[HARNESS]: {'webkit-desktop': 2}}

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

function shards(
  suite: string,
  projects: Record<string, number>,
  filter: {kept: string[]; others: readonly string[]} | undefined,
): BrowserJob[] {
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
 * The jobs for the affected suites. `filter`, when set, leaves the other renderers' tests out of the harness: one job
 * per project for one kept renderer, as many shards as kept renderers (up to the full layout's) for more.
 */
export function browserJobs(
  all: readonly string[],
  affected: ReadonlySet<string>,
  filter: {kept: string[]; others: readonly string[]} | undefined,
): {linux: BrowserJob[]; macos: BrowserJob[]} {
  const jobs = (layout: Record<string, Record<string, number>>) =>
    Object.entries(layout)
      .filter(([suite]) => affected.has(suite))
      .flatMap(([suite, projects]) => shards(suite, projects, suite === HARNESS ? filter : undefined))
  const rest = all.filter(suite => !(suite in linuxLayout))
  const restAffected = rest.filter(suite => affected.has(suite))
  const except = [...Object.keys(linuxLayout), ...rest.filter(suite => !affected.has(suite))]
  const restJob: BrowserJob = {name: 'rest', suite: 'rest', project: '', shard: '', grepInvert: '', except: except.join(',')}
  return {linux: [...jobs(linuxLayout), ...(restAffected.length ? [restJob] : [])], macos: jobs(macosLayout)}
}
