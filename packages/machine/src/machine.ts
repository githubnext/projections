// A machine's definition and its pure transition: which states there are, which events each state handles and how,
// and what each state keeps running. Nothing here runs anything; `createActor` does.

/** A machine's state: one member of a discriminated union keyed by `kind`, each carrying only the data it owns. */
export interface MachineState {
  readonly kind: string
}

/** An event a machine is sent: one member of a discriminated union keyed by `type`. */
export interface MachineEvent {
  readonly type: string
}

/**
 * An effect a transition asks for, as data: the actor runs it with its runner. An effect with a `key` supersedes a
 * running effect with the same key, whose events are then dropped.
 */
export interface MachineEffect {
  readonly type: string
  readonly key?: string
}

/**
 * A task a state keeps running while it lasts (a poll, an observer, a timer), as data. Its `key` is its identity: the
 * actor starts it when a state first lists the key and stops it when a state no longer does, dropping its events.
 */
export interface MachineActivity {
  readonly type: string
  readonly key: string
}

/** Marks an event a state doesn't handle: the state stays as it is. Listing it says the event was considered. */
export const ignore: unique symbol = Symbol('projections.machine.ignore')

/** The type of `ignore`. */
export type Ignore = typeof ignore

declare const stepped: unique symbol

/** A transition's result with effects, made by `emit`. */
export interface Step<S, F> {
  /** Brands a step, so a state is never mistaken for one. */
  readonly [stepped]: true
  /** The state the transition goes to. */
  readonly state: S
  /** The effects it asks for, in order. */
  readonly effects: readonly F[]
}

const steps = new WeakSet()

/**
 * A transition to `state` that also asks for `effects`, run in order once the state is current: after the activities it
 * no longer lists end, and before those it newly lists start.
 */
export function emit<S, F>(state: S, ...effects: F[]): Step<S, F> {
  const step = {state, effects} as unknown as Step<S, F>
  steps.add(step)
  return step
}

/** The activity of a timer: `event` is sent `ms` milliseconds after a state first lists `key`, unless one stops listing it. */
export interface After<E> {
  readonly type: 'machine.after'
  readonly key: string
  readonly ms: number
  readonly event: E
}

/** A timer activity: `event` is sent once `ms` milliseconds have passed in the states that list it under `key`. */
export function after<E extends MachineEvent>(key: string, ms: number, event: E): After<E> {
  return {type: 'machine.after', key, ms, event}
}

/** How a state handles an event: the next state (`S`), the next state with effects (`emit`), or `ignore`. */
export type Handler<S, Current, E, F> = ((state: Current, event: E) => S | Step<S, F>) | Ignore

/**
 * One state's node: a handler for every event type, so an event a state doesn't consider is a compile error, and the
 * activities it keeps running.
 */
export interface StateNode<S extends MachineState, Current extends S, E extends MachineEvent, F, A> {
  /** Every event type, with its handler or `ignore`. */
  readonly on: {readonly [T in E['type']]: Handler<S, Current, Extract<E, {type: T}>, F>}
  /** The activities this state keeps running (default none). */
  readonly activities?: (state: Current) => readonly (A | After<E>)[]
}

/** A machine's definition: a node for every state kind, so a missing state is a compile error. */
export interface MachineDefinition<S extends MachineState, E extends MachineEvent, F, A> {
  /** The nodes, by state kind. */
  readonly states: {readonly [K in S['kind']]: StateNode<S, Extract<S, {kind: K}>, E, F, A>}
}

/** What a transition did: the next state, the effects it asks for, and whether a handler (not `ignore`) took the event. */
export interface Transition<S, F> {
  /** The next state; the same object when the event was ignored. */
  readonly state: S
  /** The effects to run, in order. */
  readonly effects: readonly F[]
  /** Whether a handler took the event. */
  readonly handled: boolean
}

/** A defined machine: its definition and the pure functions an actor and the test kit run. */
export interface Machine<S extends MachineState, E extends MachineEvent, F extends MachineEffect, A extends MachineActivity> {
  /** The definition it was made from. */
  readonly definition: MachineDefinition<S, E, F, A>
  /** The pure transition: what `event` does in `state`. Throws for a state kind or event type the definition lacks. */
  transition: (state: S, event: E) => Transition<S, F>
  /** The activities `state` keeps running. */
  activities: (state: S) => readonly (A | After<E>)[]
}

interface Node {
  on: Record<string, ((state: MachineState, event: MachineEvent) => unknown) | Ignore>
  activities?: (state: MachineState) => unknown
}

/**
 * Defines a machine over the states `S`, events `E`, effects `F` and activities `A`:
 * `defineMachine<State, Event, Effect, Activity>()({states: {...}})`. The two calls let TypeScript check the definition
 * against the given types: every state kind needs a node and every node a handler (or `ignore`) for every event type.
 */
export function defineMachine<
  S extends MachineState,
  E extends MachineEvent,
  F extends MachineEffect = never,
  A extends MachineActivity = never,
>(): (definition: MachineDefinition<S, E, F, A>) => Machine<S, E, F, A> {
  return definition => {
    const node = (state: S): Node => {
      const found = (definition.states as unknown as Record<string, Node | undefined>)[state.kind]
      if (!found) throw new TypeError(`The machine has no state "${state.kind}"`)
      return found
    }
    return {
      definition,
      transition(state, event) {
        const handler = node(state).on[event.type]
        if (handler === undefined) throw new TypeError(`State "${state.kind}" lists no handler for "${event.type}"`)
        if (handler === ignore) return {state, effects: [], handled: false}
        const result = handler(state, event) as S | Step<S, F>
        const next = steps.has(result) ? (result as Step<S, F>) : {state: result as S, effects: []}
        node(next.state)
        return {state: next.state, effects: next.effects, handled: true}
      },
      activities: state => (node(state).activities?.(state) ?? []) as readonly (A | After<E>)[],
    }
  }
}
