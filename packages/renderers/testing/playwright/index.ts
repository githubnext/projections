/*
 * Playwright helpers for renderer bundles: start the fixtures workbench
 * (`projections serve --stdio --fixtures` behind a loopback page), load a
 * bundle and its scenarios in the real host frame, run the built-in checks and
 * drive the renderer through the protocol.
 */
import {readFileSync, statSync} from 'node:fs'
import {basename, dirname, join, resolve} from 'node:path'
import {expect, test as base} from '@playwright/test'
import type {FrameLocator, Locator, Page} from '@playwright/test'
import type {DefaultComparatorOptions, Comparison, Extraction} from '@githubnext/projections-schemas'
import type {FilterPayload, RendererOptions} from '@githubnext/projections-renderer-sdk/protocol'
import type {FixturesInspector, InspectorOptions} from './server.js'
import {startInspector} from './server.js'
import {bounded, StageRecord} from './bounded.js'
import {framesSinceNavigation, stageNeedsFreshPage} from './frames.js'
import type {
  CheckId,
  CheckResult,
  ProbeCall,
  StageApi,
  StageEnvironment,
  StageLoad,
  StageSeek,
  StageState,
  StageSubject,
} from '../src/types.js'

export type * from '../src/types.js'

declare global {
  interface Window {
    projectionsStage: StageApi
  }
}

export {connectInspector, startInspector} from './server.js'
export {stageRequestTimeoutMs} from './bounded.js'
export type {FixturesInspector, InspectorOptions} from './server.js'

/**
 * Scenario keys (`<source>/<id>`) in a scenarios file, for generating one test
 * per scenario. `<source>` is the directory name for `scenarios.json`,
 * otherwise the file name without `.json` (and `.scenarios`).
 */
export function scenarioKeys(path: string): string[] {
  const file = statSync(path).isDirectory() ? join(path, 'scenarios.json') : path
  const document = JSON.parse(readFileSync(file, 'utf8')) as {scenarios?: {id: string}[]}
  const name = basename(file)
  const source = name === 'scenarios.json' ? basename(dirname(resolve(file))) : name.replace(/\.json$/, '').replace(/\.scenarios$/, '')
  return (document.scenarios ?? []).map(scenario => `${source}/${scenario.id}`)
}

async function stagePage(page: Page, inspector: FixturesInspector): Promise<void> {
  if (!page.url().startsWith(inspector.page({view: 'stage'}).split('#')[0]!)) {
    framesSinceNavigation(page)
    await page.goto(inspector.page({view: 'stage'}))
  } else if (stageNeedsFreshPage(page)) {
    // A fresh document releases the frames WebKit kept (see `framesPerStagePage`).
    await page.reload()
  }
  await page.waitForFunction(
    () => document.documentElement.dataset.projectionsStage === 'ready' || document.documentElement.dataset.projectionsStage === 'failed',
  )
  const failure = await page.evaluate(() => (document.documentElement.dataset.projectionsStage === 'failed' ? document.body.innerText : ''))
  if (failure) throw new Error(`The Inspector stage failed to start: ${failure}`)
  // The real pointer would hover whatever the renderer draws under it: headless browsers may leave it at the page's
  // origin, over the stage frame, which paints a hover ring the checks would read as emphasis. Hover is the host's.
  await page.mouse.move(-1, -1)
}

/**
 * What `openStage` presents, besides a scenario: `StageLoad` without its subject, plus one `extraction`, or `before`
 * and `after` with their `comparison` (computed in the page with the default comparator and `comparatorOptions` when
 * omitted).
 */
export type OpenRequest = Omit<StageLoad, 'subject'> &
  (
    | {extraction: Extraction}
    | {before: Extraction; after: Extraction; comparison?: Comparison; comparatorOptions?: DefaultComparatorOptions}
  )

/**
 * A renderer presented on the stage page (`openStage`): its frame, for locators and screenshots, and the host's side
 * of the protocol, for driving it as a host would. Every method runs in the page and resolves once the stage has
 * applied it.
 */
export interface StageHandle {
  page: Page
  /** The sandboxed renderer document. */
  frame: FrameLocator
  /** The `<iframe>` element in the host page, for size and screenshot checks. */
  iframe: Locator
  subject: StageSubject
  /** Sends a progress and resolves after the renderer acknowledges painting exactly that progress. */
  seek(progress: number, options?: StageSeek): Promise<StageState>
  /** Seeks to every value in order and runs `check` at each painted frame. Direction follows the travel unless given. */
  scrub(progresses: readonly number[], check: (progress: number) => Promise<void>, options?: StageSeek): Promise<void>
  /** Host-side selection, as a host's own table or details panel would send it. */
  select(id: string | null): Promise<void>
  setOptions(options: RendererOptions): Promise<void>
  /** Activates one of the renderer's declared action controls, as a host's button would. */
  action(id: string): Promise<void>
  /** Host-side hover, as another pane or the host's table would send it. */
  hover(id: string | null): Promise<void>
  /** The host's scope, summary filter and find (a `filter` message). */
  filter(payload: FilterPayload): Promise<void>
  setEnvironment(environment: StageEnvironment): Promise<void>
  /** Resizes the frame (`null`: the page width) and resolves once the renderer has painted again. */
  setWidth(width: number | null): Promise<void>
  /** Runs a check-probe measurement inside the renderer document. */
  measure<T = unknown>(call: ProbeCall, args?: unknown): Promise<T>
  state(): Promise<StageState>
}

/** A request of the stage page, bounded (see `bounded`) and named `what` in a failure. */
const ask = <T>(record: StageRecord, what: string, run: () => Promise<T>): Promise<T> => bounded(record, what, run())

function handle(page: Page, subject: StageSubject, record: StageRecord): StageHandle {
  const call = <T>(what: string, run: () => Promise<T>) => ask(record, what, run)
  const seek = (progress: number, options: StageSeek = {}) =>
    call(`seek(${progress})`, () =>
      page.evaluate(([progress, options]) => window.projectionsStage.seek(progress, options), [progress, options] as const),
    )
  return {
    page,
    frame: page.frameLocator('#stage-frame iframe'),
    iframe: page.locator('#stage-frame iframe'),
    subject,
    seek,
    async scrub(progresses, check, options = {}) {
      let previous: number | undefined
      for (const progress of progresses) {
        // Direction follows the travel unless given, as a host's playback would report it.
        const direction = options.direction ?? (previous !== undefined && progress < previous ? -1 : 1)
        previous = progress
        await seek(progress, {...options, direction})
        await check(progress)
      }
    },
    select: id => call('select', () => page.evaluate(id => window.projectionsStage.select(id), id)),
    setOptions: options => call('setOptions', () => page.evaluate(options => window.projectionsStage.setOptions(options), options)),
    action: id => call(`action(${id})`, () => page.evaluate(id => window.projectionsStage.action(id), id)),
    hover: id => call('hover', () => page.evaluate(id => window.projectionsStage.hover(id), id)),
    filter: payload => call('filter', () => page.evaluate(payload => window.projectionsStage.filter(payload), payload)),
    setEnvironment: environment =>
      call('setEnvironment', () => page.evaluate(environment => window.projectionsStage.setEnvironment(environment), environment)),
    setWidth: width => call(`setWidth(${width})`, () => page.evaluate(width => window.projectionsStage.setWidth(width), width)),
    measure: <T>(probe: ProbeCall, args?: unknown) =>
      call(
        `measure(${probe})`,
        () => page.evaluate(([probe, args]) => window.projectionsStage.measure(probe, args), [probe, args] as const) as Promise<T>,
      ),
    state: () => call('state', () => page.evaluate(() => window.projectionsStage.state())),
  }
}

/**
 * Opens the Inspector's stage page and presents a scenario (`{scenario: key}`),
 * or an extraction or comparison you supply (compared with the default
 * comparator in the page unless `comparison` is given). Resolves after the
 * renderer is ready and has painted the initial progress.
 */
export async function openStage(
  page: Page,
  inspector: FixturesInspector,
  request: OpenRequest | ({scenario: string} & Omit<Partial<StageLoad>, 'subject' | 'renderer'>),
): Promise<StageHandle> {
  await stagePage(page, inspector)
  const record = new StageRecord()
  if ('scenario' in request) {
    const {scenario, ...overrides} = request
    record.scenario = scenario
    await ask(record, 'loadScenario', () =>
      page.evaluate(([scenario, overrides]) => window.projectionsStage.loadScenario(scenario, overrides), [scenario, overrides] as const),
    )
    const subject = await ask(record, 'subject', () => page.evaluate(() => window.projectionsStage.subject()))
    return handle(page, subject, record)
  }
  const {extraction, before, after, comparison, comparatorOptions, ...rest} = request as OpenRequest &
    Partial<{
      extraction: Extraction
      before: Extraction
      after: Extraction
      comparison: Comparison
      comparatorOptions: DefaultComparatorOptions
    }>
  let subject: StageSubject
  if (extraction) subject = {mode: 'extraction', extraction}
  else if (before && after) {
    // Passed as text: extractions are JSON, and Playwright's serializable types are too deep for them.
    const computed =
      comparison ??
      (await page.evaluate(
        json => {
          const {before, after, options} = JSON.parse(json) as {before: Extraction; after: Extraction; options?: DefaultComparatorOptions}
          return window.projectionsStage.compare(before, after, options)
        },
        JSON.stringify({before, after, options: comparatorOptions}),
      ))
    subject = {mode: 'comparison', before, after, comparison: computed}
  } else throw new Error('openStage needs a scenario, an extraction, or before and after extractions')
  await ask(record, 'load', () =>
    page.evaluate(json => window.projectionsStage.load(JSON.parse(json)), JSON.stringify({...rest, subject} satisfies StageLoad)),
  )
  return handle(page, subject, record)
}

/** Opens the fixtures workbench, optionally at one scenario. */
export async function openWorkbench(page: Page, inspector: FixturesInspector, {scenario}: {scenario?: string} = {}): Promise<void> {
  await page.goto(inspector.page(scenario ? {scenario} : {}))
  await expect(page.locator('[data-fixtures-workbench]')).toBeVisible()
}

/** Runs the built-in checks against a scenario in the real host frame and returns every result. */
export async function checkScenario(
  page: Page,
  inspector: FixturesInspector,
  scenario: string,
  options: {checks?: CheckId[]} = {},
): Promise<CheckResult[]> {
  await stagePage(page, inspector)
  return page.evaluate(([scenario, options]) => window.projectionsStage.runChecks(scenario, options), [scenario, options] as const)
}

/** The failures in check results, one line each, for assertion messages. */
export function checkFailures(results: readonly CheckResult[]): string[] {
  return results.filter(result => result.status === 'fail').flatMap(result => result.details.map(detail => `${result.title}: ${detail}`))
}

/** Runs the built-in checks against a scenario and fails the test with every failed invariant. */
export async function expectScenarioToPass(
  page: Page,
  inspector: FixturesInspector,
  scenario: string,
  options: {checks?: CheckId[]} = {},
): Promise<CheckResult[]> {
  const results = await checkScenario(page, inspector, scenario, options)
  expect(checkFailures(results), `${scenario}: built-in renderer checks`).toEqual([])
  return results
}

/** `count + 1` evenly spaced progress values from 0 to 1, optionally followed by the way back. */
export function samples(count = 20, {roundTrip = false}: {roundTrip?: boolean} = {}): number[] {
  const forward = Array.from({length: count + 1}, (_, index) => Math.round((index / count) * 1e6) / 1e6)
  return roundTrip ? [...forward, ...forward.slice(0, -1).reverse()] : forward
}

/**
 * A Playwright `test` with a worker-scoped `inspector` fixture started from the
 * `projections` option, for example
 * `test.use({projections: {fixtures: 'scenarios.json', renderers: 'dist'}})`.
 */
export const test = base.extend<Record<never, never>, {projections: InspectorOptions; inspector: FixturesInspector}>({
  projections: [
    {fixtures: 'scenarios.json', renderers: 'dist'},
    {option: true, scope: 'worker'},
  ],
  inspector: [
    async ({projections}, use) => {
      const inspector = await startInspector(projections)
      await use(inspector)
      await inspector.close()
    },
    {scope: 'worker'},
  ],
})
export {expect}
export {ringGeometry} from './rings/geometry.js'
export * from './rings.js'
export {opticalInsets} from './optical.js'
export type {OpticalInsets} from './optical.js'
export * from './corners.js'
