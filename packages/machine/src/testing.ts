// The test kit: `explore` walks every state a machine reaches from its starting states by the given events (and the
// events of its timers), breadth first, and checks invariants on every state and every step. A violation is reported
// with the shortest path to it. With `complete`, every handler the definition lists must be taken.
import {
  ignore,
  type After,
  type Machine,
  type MachineActivity,
  type MachineEffect,
  type MachineEvent,
  type MachineState,
} from './machine.js'

/** One step of a path: the event sent, the state it led to, and what the transition asked for. */
export interface ExploreStep<S, E, F> {
  /** The state the event was sent in. */
  readonly from: S
  /** The event. */
  readonly event: E
  /** The state it led to (`from` when ignored). */
  readonly to: S
  /** The effects the transition asked for. */
  readonly effects: readonly F[]
  /** Whether a handler (not `ignore`) took the event. */
  readonly handled: boolean
}

/** How a state was reached: from a starting state, by these steps. */
export interface ExplorePath<S, E, F> {
  /** The starting state. */
  readonly start: S
  /** The steps, first to last. */
  readonly steps: readonly ExploreStep<S, E, F>[]
  /** The state reached. */
  readonly state: S
}

/** What `explore` walks and checks. */
export interface ExploreOptions<S, E, F> {
  /** The starting state or states. */
  readonly from: S | readonly S[]
  /** The events to try in every state, or a function of the state giving them. */
  readonly events: readonly E[] | ((state: S) => readonly E[])
  /** Also send the event of each `after` timer the state lists (default `true`). */
  readonly timers?: boolean
  /** A state's identity: states with the same key are explored once (default a stable JSON of the state; Maps and Sets included). */
  readonly key?: (state: S) => string
  /** The longest path to follow (default 12). */
  readonly depth?: number
  /** The most distinct states to visit (default 20,000); `truncated` says whether it stopped there. */
  readonly limit?: number
  /** Named checks of every state reached, given the shortest path to it. */
  readonly invariants?: Readonly<Record<string, (state: S, path: ExplorePath<S, E, F>) => boolean>>
  /** Named checks of every step taken, given the path to the state it was taken in. */
  readonly transitions?: Readonly<Record<string, (step: ExploreStep<S, E, F>, path: ExplorePath<S, E, F>) => boolean>>
  /**
   * Require every handler the definition lists (not `ignore`) to be taken, so an unreachable transition fails the test;
   * `except` lists `kind.type` pairs that may stay untaken.
   */
  readonly complete?: boolean | {readonly except?: readonly string[]}
}

/** What `explore` found. */
export interface Exploration<S> {
  /** The distinct states reached, by key. */
  readonly states: ReadonlyMap<string, S>
  /** The handlers taken, as `kind.type`. */
  readonly taken: ReadonlySet<string>
  /** The handlers the definition lists that were never taken, as `kind.type`. */
  readonly untaken: readonly string[]
  /** Whether `limit` stopped the walk before it reached every state within `depth`. */
  readonly truncated: boolean
}

/** An invariant that failed, or handlers left untaken under `complete`. */
export class ExplorationError extends Error {
  /** The failing check's name, or `complete`. */
  readonly check: string
  /** The shortest path to the failure; absent for `complete`. */
  readonly path: ExplorePath<unknown, unknown, unknown> | undefined

  /** Made by `explore`. */
  constructor(check: string, message: string, path?: ExplorePath<unknown, unknown, unknown>) {
    super(message)
    this.name = 'ExplorationError'
    this.check = check
    this.path = path
  }
}

const sortedEntries = (entries: [unknown, unknown][]) =>
  entries.map(([key, value]) => [stableKey(key), value] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

/** A stable JSON of `value`: object keys sorted, Maps and Sets as sorted entries, functions as their names. */
export function stableKey(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Map) return {'@map': sortedEntries([...item])}
    if (item instanceof Set) return {'@set': [...item].map(stableKey).sort()}
    if (typeof item === 'function') return `@function ${item.name}`
    if (item && typeof item === 'object' && !Array.isArray(item))
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    return item
  })
}

function describe(path: ExplorePath<MachineState, MachineEvent, unknown>): string {
  return [path.start.kind, ...path.steps.map(step => `--${step.event.type}--> ${step.to.kind}`)].join(' ')
}

/** Walks the states `machine` reaches and checks `options`' invariants; throws an `ExplorationError` on a violation. */
export function explore<S extends MachineState, E extends MachineEvent, F extends MachineEffect, A extends MachineActivity>(
  machine: Machine<S, E, F, A>,
  options: ExploreOptions<NoInfer<S>, NoInfer<E>, NoInfer<F>>,
): Exploration<S> {
  const {depth = 12, limit = 20_000, timers = true, invariants = {}, transitions = {}} = options
  const key = options.key ?? stableKey
  const starts = (Array.isArray(options.from) ? options.from : [options.from]) as readonly S[]
  const eventsIn = (state: S): readonly E[] => {
    const given = typeof options.events === 'function' ? options.events(state) : options.events
    if (!timers) return given
    const fired = machine.activities(state).flatMap(activity => (activity.type === 'machine.after' ? [(activity as After<E>).event] : []))
    return [...given, ...fired]
  }
  const fail = (check: string, what: string, path: ExplorePath<S, E, F>): never => {
    throw new ExplorationError(check, `${check} fails ${what}: ${describe(path)}`, path as ExplorePath<unknown, unknown, unknown>)
  }

  const states = new Map<string, S>()
  const taken = new Set<string>()
  let frontier: ExplorePath<S, E, F>[] = []
  let truncated = false
  const visit = (path: ExplorePath<S, E, F>) => {
    const id = key(path.state)
    if (states.has(id)) return
    if (states.size >= limit) {
      truncated = true
      return
    }
    states.set(id, path.state)
    for (const [name, check] of Object.entries(invariants)) if (!check(path.state, path)) fail(name, `in "${path.state.kind}"`, path)
    frontier.push(path)
  }
  for (const start of starts) visit({start, steps: [], state: start})
  for (let level = 0; level < depth && frontier.length; level++) {
    const current = frontier
    frontier = []
    for (const path of current)
      for (const event of eventsIn(path.state)) {
        const {state: to, effects, handled} = machine.transition(path.state, event)
        const step: ExploreStep<S, E, F> = {from: path.state, event, to, effects, handled}
        if (handled) taken.add(`${path.state.kind}.${event.type}`)
        for (const [name, check] of Object.entries(transitions))
          if (!check(step, path))
            fail(name, `on "${event.type}" in "${path.state.kind}"`, {...path, steps: [...path.steps, step], state: to})
        visit({start: path.start, steps: [...path.steps, step], state: to})
      }
  }

  const listed = Object.entries(machine.definition.states as Record<string, {on: Record<string, unknown>}>).flatMap(([kind, node]) =>
    Object.entries(node.on).flatMap(([type, handler]) => (handler === ignore ? [] : [`${kind}.${type}`])),
  )
  const except = new Set(typeof options.complete === 'object' ? (options.complete.except ?? []) : [])
  const untaken = listed.filter(handler => !taken.has(handler) && !except.has(handler))
  if (options.complete && untaken.length)
    throw new ExplorationError('complete', `Handlers never taken within depth ${depth}: ${untaken.join(', ')}`)
  return {states, taken, untaken, truncated}
}
