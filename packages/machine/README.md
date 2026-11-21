---
description: Explicit state machines for Projections' lifecycles, with a framework-agnostic actor and a test kit
icon: waypoints
---

# Machine

Explicit state machines for the lifecycles in Projections' hosts and
integrations: a toolbar planning its layout, a job being started, polled and
cancelled, a webview loading. No dependencies; React is an optional peer of
`./react`.

- `defineMachine<State, Event, Effect, Activity>()({states})`: the states are a
  union keyed by `kind`, the events a union keyed by `type`. Every state needs a
  node and every node a handler, or `ignore`, for every event type, so a case
  nobody considered is a compile error. Handlers are pure: they return the next
  state, or `emit(state, ...effects)`.
- `createActor(machine, {state, effects, activities})` runs it without a
  framework. Effects and activities are data a runner per type carries out; each
  runs in a generation that ends when it is superseded, its state stops listing
  it or the actor stops, and the events it sends afterwards are dropped.
  `after(key, ms, event)` is a timer activity.
- `useMachine(machine, options)` from `./react` runs one per component.
- `explore(machine, {from, events, invariants, transitions, complete})` from
  `./testing` walks every reachable state and reports the shortest path to a
  broken invariant.

[The guide](../../docs/guides/state-machines.md) says when to use it and how.
