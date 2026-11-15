import type {ComputedComparison, RendererEntry, RulesRuntime} from '@githubnext/projections-host'
import {runChecks} from '@githubnext/projections-renderer-testing'
import type {CheckDriver, CheckId, CheckResult, StageApi, StageLoad, StageSubject} from '@githubnext/projections-renderer-testing'
import type {ProjectionEngine} from '@githubnext/projections-schemas'
import type {RendererProjection} from '@githubnext/projections-renderer-sdk/protocol'
import type {InspectorApi} from '../client/api.js'
import type {FixtureCatalog, FixtureScenario} from '../types.js'
import {compareScenario, findScenario, fixtureEntries, scenarioRenderer} from './model.js'
import type {Stage} from './stage.js'

export interface FixturesContext {
  api: InspectorApi
  engine: ProjectionEngine
  rules?: RulesRuntime
  /** Built-in renderer bundles of the Inspector. */
  builtins: readonly RendererEntry[]
}

/**
 * The fixtures catalog, kept current: it long-polls the server's file watcher
 * and reloads whenever a scenario file, fixture, comparator file or renderer
 * bundle changes.
 */
export class FixturesStore {
  private listeners = new Set<() => void>()
  private abort = new AbortController()
  private comparisons = new WeakMap<FixtureScenario, Promise<ComputedComparison>>()
  connected = true

  constructor(
    private readonly context: FixturesContext,
    public catalog: FixtureCatalog,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  snapshot = () => this.catalog

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  /** Watches for changes until `stop`. */
  async watch(): Promise<void> {
    const signal = this.abort.signal
    while (!signal.aborted) {
      try {
        const generation = await this.context.api.fixtureChanges(this.catalog.generation, signal)
        if (!this.connected) {
          this.connected = true
          this.emit()
        }
        if (generation === this.catalog.generation) continue
        const next = await this.context.api.fixtures(signal)
        if (next) {
          this.catalog = next
          this.emit()
        }
      } catch {
        if (signal.aborted) return
        if (this.connected) {
          this.connected = false
          this.emit()
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
  }

  stop(): void {
    this.abort.abort()
  }

  /** The scenario's comparison with its own comparator, computed once per loaded version of the scenario. */
  compare(scenario: FixtureScenario): Promise<ComputedComparison> {
    let computed = this.comparisons.get(scenario)
    if (!computed) {
      computed = compareScenario(scenario, this.context.engine, this.context.rules)
      this.comparisons.set(scenario, computed)
    }
    return computed
  }

  /** What a scenario presents, with its comparison computed. */
  async subject(scenario: FixtureScenario): Promise<StageSubject> {
    if (scenario.error) throw new Error(`${scenario.key}: ${scenario.error}`)
    if (scenario.subject.mode === 'extraction') return scenario.subject
    return {...scenario.subject, comparison: (await this.compare(scenario)).comparison}
  }

  bundle(scenario: FixtureScenario): RendererEntry {
    const resolution = scenarioRenderer(scenario, this.catalog, this.context.builtins)
    if (!resolution.renderer) throw new Error(resolution.notice ?? `No renderer bundle presents ${scenario.key}`)
    return resolution.renderer
  }

  scenario(name: string): FixtureScenario {
    const scenario = findScenario(this.catalog, name)
    if (!scenario)
      throw new Error(`No scenario ${name}; the Inspector loaded ${this.catalog.scenarios.map(item => item.key).join(', ') || 'none'}`)
    return scenario
  }
}

/** The renderer name a scenario names, for `init`. */
function rendererName(scenario: FixtureScenario, bundle: RendererEntry): string {
  return typeof scenario.renderer === 'string' ? scenario.renderer : bundle.name
}

/** The projection a scenario's `init` names, with its kind presentation (`presentation.kinds`). */
function scenarioProjection(scenario: FixtureScenario): {id: string; title: string; kinds?: NonNullable<RendererProjection['kinds']>} {
  const kinds = scenario.presentation?.kinds
  return {id: scenario.id, title: scenario.title, ...(kinds ? {kinds} : {})}
}

/** Runs the built-in checks against a scenario in a stage. */
export async function checkScenario(
  stage: Stage,
  store: FixturesStore,
  context: FixturesContext,
  scenario: FixtureScenario,
  options: {checks?: readonly CheckId[]; colorMode?: 'light' | 'dark'; onResult?: (result: CheckResult) => void} = {},
): Promise<CheckResult[]> {
  const subject = await store.subject(scenario)
  const bundle = store.bundle(scenario)
  const base: Omit<StageLoad, 'subject'> = {
    renderer: rendererName(scenario, bundle),
    projection: scenarioProjection(scenario),
    colorMode: options.colorMode ?? 'light',
    ...(scenario.presentation?.rendererOptions ? {options: scenario.presentation.rendererOptions} : {}),
  }
  const driver: CheckDriver = {
    load: (subject, {progress, width, height, highlighting, comparisonMode, colorMode, reuse}) =>
      stage.load(
        {
          ...base,
          subject,
          progress,
          ...(width ? {width} : {}),
          ...(height ? {height} : {}),
          ...(highlighting !== undefined ? {highlighting} : {}),
          ...(comparisonMode ? {comparisonMode} : {}),
          ...(colorMode ? {colorMode} : {}),
          ...(reuse ? {reuse} : {}),
        },
        bundle,
      ),
    seek: (progress, seek) => stage.seek(progress, seek),
    select: id => stage.select(id),
    hover: id => stage.hover(id),
    state: () => stage.state(),
    measure: (call, args) => stage.measure(call, args),
    compare: (before, after) => context.engine.compare(before, after),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  }
  try {
    return await runChecks(driver, subject, {
      ...(options.checks ? {checks: options.checks} : {}),
      ...(options.onResult ? {onResult: options.onResult} : {}),
      ...(scenario.presentation?.rendererOptions ? {rendererOptions: scenario.presentation.rendererOptions} : {}),
    })
  } finally {
    await stage.setWidth(null).catch(() => {})
  }
}

/** The `window.projectionsStage` API of the stage page, for tests. */
export function stageApi(stage: Stage, store: FixturesStore, context: FixturesContext): StageApi {
  const resolve = (renderer: string): RendererEntry => {
    const entries = [...fixtureEntries(store.catalog), ...context.builtins]
    const found = entries.find(item => item.name === renderer) ?? entries.find(item => item.handles.includes(renderer))
    if (!found) throw new Error(`No renderer bundle is named or handles ${renderer}; served: ${entries.map(item => item.name).join(', ')}`)
    return found
  }
  return {
    load: request => stage.load(request, resolve(request.renderer)),
    async loadScenario(name, overrides = {}) {
      const scenario = store.scenario(name)
      const bundle = store.bundle(scenario)
      return stage.load(
        {
          renderer: rendererName(scenario, bundle),
          projection: scenarioProjection(scenario),
          ...(scenario.presentation?.rendererOptions ? {options: scenario.presentation.rendererOptions} : {}),
          ...overrides,
          subject: await store.subject(scenario),
        },
        bundle,
      )
    },
    seek: (progress, options) => stage.seek(progress, options),
    select: id => stage.select(id),
    setOptions: options => stage.setOptions(options),
    action: id => stage.action(id),
    hover: id => stage.hover(id),
    setEnvironment: environment => stage.setEnvironment(environment),
    setWidth: width => stage.setWidth(width),
    measure: (call, args) => stage.measure(call, args),
    state: () => stage.state(),
    subject: () => stage.subject(),
    compare: (before, after, options) => context.engine.compare(before, after, options ?? {}),
    scenarios: () =>
      store.catalog.scenarios.map(item => ({key: item.key, id: item.id, title: item.title, ...(item.error ? {error: item.error} : {})})),
    runChecks: (name, options = {}) => checkScenario(stage, store, context, store.scenario(name), options),
  }
}
