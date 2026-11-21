// An actor runs a machine: it holds the current state, takes events one at a time, runs the effects transitions ask
// for and keeps each state's activities running. Every effect and activity runs in a generation that ends when it is
// superseded, its state stops listing it or the actor stops: its signal aborts, its cleanup runs and the events it
// sends afterwards are dropped, so a stale result never reaches the machine. Framework-agnostic; `useMachine` adapts it
// to React.
import type {After, Machine, MachineActivity, MachineEffect, MachineEvent, MachineState} from './machine.js'

/** What an effect or activity runner is given: how to send events, and a signal aborted when its generation ends. */
export interface ActorContext<E> {
  /** Sends an event to the actor; dropped once this generation has ended. */
  send(event: E): void
  /** Aborted when this generation ends: superseded, no longer listed by the state, or the actor stopped. */
  readonly signal: AbortSignal
}

/**
 * A runner per effect type. A returned promise's rejection is reported while its generation lasts; an effect's events
 * are dropped once a later effect with its `key` runs or the actor stops.
 */
export type EffectRunners<E, F extends MachineEffect> = {
  readonly [T in F['type']]: (effect: Extract<F, {type: T}>, context: ActorContext<E>) => unknown
}

/**
 * A runner per activity type. It returns nothing, a cleanup function run when the activity stops, or a promise whose
 * rejection is reported while the activity lasts. Timers made with `after` need no runner.
 */
export type ActivityRunners<E, A extends MachineActivity> = {
  readonly [T in A['type']]: (activity: Extract<A, {type: T}>, context: ActorContext<E>) => unknown
}

/** How to run a machine: its starting state and a runner for each effect and activity type it uses. */
export type ActorOptions<S, E, F extends MachineEffect, A extends MachineActivity> = {
  /** The state the actor starts in. */
  readonly state: S
  /** Where errors thrown or rejected by runners go (default `reportError`, else `console.error`). */
  readonly onError?: (error: unknown) => void
} & ([F] extends [never] ? {readonly effects?: never} : {readonly effects: EffectRunners<E, F>}) &
  ([A] extends [never] ? {readonly activities?: never} : {readonly activities: ActivityRunners<E, A>})

/** A running machine. */
export interface Actor<S, E> {
  /** The current state. */
  getState(): S
  /**
   * Sends an event. Events are taken one at a time, in order: one sent while another is being handled (by an effect, a
   * listener or an activity) waits for it. Before `start` and after `stop` events wait for the next `start`.
   */
  send(event: E): void
  /** Calls `listener` with the state after each batch of events that changed it; returns the unsubscribe function. */
  subscribe(listener: (state: S) => void): () => void
  /** Starts the current state's activities and takes waiting events. Starting a running actor does nothing. */
  start(): void
  /** Ends every effect and activity generation. The state is kept, and `start` resumes from it. */
  stop(): void
  /** Whether the actor is started. */
  readonly running: boolean
}

type Runner = (task: never, context: ActorContext<never>) => unknown

interface Generation<E> {
  readonly context: ActorContext<E>
  /** Whether it hasn't ended: its events are taken only while it lasts, also those already waiting. */
  readonly live: boolean
  /** Takes what a runner returned: a cleanup to run at the end, or a promise whose rejection to report. */
  settle(result: unknown): void
  end(): void
}

const timer: Runner = ((activity: After<MachineEvent>, context: ActorContext<MachineEvent>) => {
  const id = setTimeout(() => context.send(activity.event), activity.ms)
  return () => clearTimeout(id)
}) as Runner

/** Reports an error with `reportError`, else `console.error`: where an actor's errors go by default. */
export function defaultReport(error: unknown) {
  const report = (globalThis as {reportError?: (error: unknown) => void}).reportError
  if (typeof report === 'function') report(error)
  else console.error(error)
}

/** Creates an actor for `machine`, stopped: call `start` to run it. */
export function createActor<S extends MachineState, E extends MachineEvent, F extends MachineEffect, A extends MachineActivity>(
  machine: Machine<S, E, F, A>,
  options: NoInfer<ActorOptions<S, E, F, A>>,
): Actor<S, E> {
  let state = options.state
  let running = false
  let draining = false
  /** Events waiting to be taken, each with the generation that sent it (none for `send`'s callers). */
  const queue: {event: E; from: Generation<E> | undefined}[] = []
  const listeners = new Set<(state: S) => void>()
  const activities = new Map<string, Generation<E>>()
  const keyed = new Map<string, Generation<E>>()
  const report = options.onError ?? defaultReport
  const effectRunners = (options.effects ?? {}) as Record<string, Runner | undefined>
  const activityRunners = {...options.activities, 'machine.after': timer} as Record<string, Runner | undefined>

  const generation = (): Generation<E> => {
    const controller = new AbortController()
    let live = true
    const cleanups: (() => void)[] = []
    const safely = (callback: () => void) => {
      try {
        callback()
      } catch (error) {
        report(error)
      }
    }
    const into: Generation<E> = {
      context: {
        send: event => {
          if (live) enqueue(event, into)
        },
        signal: controller.signal,
      },
      get live() {
        return live
      },
      settle(result) {
        if (typeof result === 'function') {
          if (live) cleanups.push(result as () => void)
          else safely(result as () => void)
        } else if (result instanceof Promise) {
          result.then(undefined, error => {
            if (live) report(error)
          })
        }
      },
      end() {
        if (!live) return
        live = false
        controller.abort()
        for (const cleanup of cleanups.splice(0)) safely(cleanup)
      },
    }
    return into
  }
  let run = generation()
  run.end()

  const invoke = (runners: Record<string, Runner | undefined>, task: {type: string}, into: Generation<E>) => {
    const runner = runners[task.type]
    if (!runner) {
      report(new TypeError(`No runner for "${task.type}"`))
      return
    }
    try {
      into.settle(runner(task as never, into.context as ActorContext<never>))
    } catch (error) {
      report(error)
    }
  }

  const runEffect = (effect: F) => {
    let into = run
    if (effect.key !== undefined) {
      keyed.get(effect.key)?.end()
      into = generation()
      keyed.set(effect.key, into)
    }
    invoke(effectRunners, effect, into)
  }

  /** The activities the current state lists, by key; ends those it no longer lists. */
  const endUnlisted = () => {
    const wanted = new Map<string, A | After<E>>()
    for (const activity of machine.activities(state)) {
      if (wanted.has(activity.key)) throw new TypeError(`State "${state.kind}" lists two activities keyed "${activity.key}"`)
      wanted.set(activity.key, activity)
    }
    for (const [key, current] of activities) {
      if (!wanted.has(key)) {
        activities.delete(key)
        current.end()
      }
    }
    return wanted
  }
  /** Starts the listed activities that aren't running. */
  const startListed = (wanted: ReadonlyMap<string, A | After<E>>) => {
    for (const [key, activity] of wanted) {
      if (!activities.has(key)) {
        const into = generation()
        activities.set(key, into)
        invoke(activityRunners, activity, into)
      }
    }
  }

  // Takes waiting events in batches: every listener hears a batch before the events they send are taken.
  const drain = () => {
    if (!running || draining) return
    draining = true
    try {
      // Each loop also ends when an effect stops the actor, leaving what waits for `start`.
      while (queue.length) {
        if (!running) break
        const before = state
        while (queue.length) {
          if (!running) break
          const {event, from} = queue.shift()!
          // An event from a generation that ended while it waited is as stale as one sent after.
          if (from && !from.live) continue
          const {state: next, effects} = machine.transition(state, event)
          // The state's activities that end, end first; its new ones start once the transition's effects have run, so
          // they see what the effects did (a clock shifted, a request sent).
          let wanted: ReadonlyMap<string, A | After<E>> | undefined
          if (next !== state) {
            state = next
            wanted = endUnlisted()
          }
          for (const effect of effects) runEffect(effect)
          // An effect may have stopped the actor; `start` starts them then.
          if (wanted && running) startListed(wanted)
        }
        if (state !== before) for (const listener of [...listeners]) listener(state)
      }
    } finally {
      draining = false
    }
  }

  function enqueue(event: E, from: Generation<E> | undefined) {
    queue.push({event, from})
    drain()
  }
  const send = (event: E) => enqueue(event, undefined)

  return {
    getState: () => state,
    send,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start() {
      if (running) return
      running = true
      run = generation()
      draining = true
      try {
        startListed(endUnlisted())
      } finally {
        draining = false
      }
      drain()
    },
    stop() {
      if (!running) return
      running = false
      for (const into of [...activities.values(), ...keyed.values()]) into.end()
      activities.clear()
      keyed.clear()
      run.end()
    },
    get running() {
      return running
    },
  }
}
