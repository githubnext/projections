# State machines

Projections' hosts and integrations are full of lifecycles. A toolbar measures a
plan and settles on one, a job starts, is polled and is cancelled, and a webview
loads, reloads and closes. Written as booleans, refs, effects and timers, each
lifecycle is a state machine nobody named, and its bugs are events arriving in a
state the code didn't expect. Examples: a cancel before the job is named, a
result after the person moved on, a reload while a command waits. Model these as
explicit machines with `@githubnext/projections-machine`
([`packages/machine`](../../packages/machine/README.md)). It has no dependencies
and works with or without React.

## When to use it

Use it for anything with more than two states, anything with a timer, poll or
observer whose result comes back later, and anything an earlier fix patched with
another flag. A value that is only derived from props, or a single open/closed
toggle, doesn't need one.

## Define it

```ts
import {after, defineMachine, emit, ignore} from '@githubnext/projections-machine'

type State = {kind: 'idle'} | {kind: 'starting'; run: number} | {kind: 'polling'; run: number; job: string} | {kind: 'done'}
type Event =
  | {type: 'start'; run: number}
  | {type: 'named'; run: number; job: string}
  | {type: 'finished'}
  | {type: 'cancel'}
  | {type: 'timeout'}
type Effect = {type: 'create'; key: 'create'; run: number} | {type: 'cancelJob'; job: string}
type Activity = {type: 'poll'; key: string; job: string}

export const jobMachine = defineMachine<State, Event, Effect, Activity>()({
  states: {
    idle: {
      on: {
        start: (_state, {run}) => emit({kind: 'starting', run}, {type: 'create', key: 'create', run}),
        named: ignore,
        finished: ignore,
        cancel: ignore,
        timeout: ignore,
      },
    },
    starting: {
      on: {
        start: ignore,
        named: (state, event) => (event.run === state.run ? {kind: 'polling', run: state.run, job: event.job} : state),
        finished: ignore,
        cancel: () => ({kind: 'idle'}),
        timeout: () => ({kind: 'idle'}),
      },
      activities: state => [after(`limit:${state.run}`, 30_000, {type: 'timeout'})],
    },
    polling: {
      on: {
        start: ignore,
        named: ignore,
        finished: () => ({kind: 'done'}),
        cancel: state => emit({kind: 'idle'}, {type: 'cancelJob', job: state.job}),
        timeout: ignore,
      },
      activities: state => [{type: 'poll', key: `poll:${state.job}`, job: state.job}],
    },
    done: {on: {start: ignore, named: ignore, finished: ignore, cancel: ignore, timeout: ignore}},
  },
})
```

- **States** are a union keyed by `kind`, and each carries only the data it
  owns: `job` exists only while polling, so no state can hold a job it doesn't
  have. Parallel regions are fields of the states that have them, such as a
  `hand: 'free' | 'pressing'` beside the `kind`.
- **Every state lists every event type.** It gives a handler or `ignore`, so a
  case nobody considered is a compile error, not a silent no-op. A missing
  state, an extra one, a transition to a state without its data and a handler
  reading data its state lacks are compile errors too. Share handlers between
  states by spreading a common object into `on`.
- **Handlers are pure.** They return the next state, or
  `emit(state, ...effects)`. They don't call APIs, read the DOM or start timers.
- **Effects** are data a transition asks for (create a job, cancel one). Each
  effect type has a runner. An effect with a `key` supersedes a running effect
  with the same key: the earlier one's signal aborts and its events are dropped,
  so the latest request wins.
- **Activities** are what a state keeps running: a poll, an observer or a timer
  (`after(key, ms, event)`). The actor starts an activity when a state first
  lists its key and stops it when a state no longer does. Put what makes it a
  new activity, such as a job id or a run number, in the key.

## Run it

```ts
import {createActor} from '@githubnext/projections-machine'

const actor = createActor(jobMachine, {
  state: {kind: 'idle'},
  effects: {
    create: async ({run}, {send, signal}) => send({type: 'named', run, job: (await api.run({signal})).id}),
    cancelJob: ({job}) => api.cancel(job),
  },
  activities: {
    poll: async ({job}, {send, signal}) => {
      while (!signal.aborted) if ((await api.job(job, {signal})).status !== 'running') return send({type: 'finished'})
    },
  },
})
actor.start()
actor.send({type: 'start', run: 1})
```

**Generations.** Every effect and activity runs in a generation, which ends when
one of these happens:

- a later effect with its key runs;
- the state stops listing the activity;
- the actor stops.

When a generation ends, its `signal` aborts, its cleanup runs and the events it
sends are dropped. A late result can't reach a state that has moved on, so there
are no hand-written run tokens, epochs or "is this still current" checks.

**Ordering.** Events are taken one at a time, in order. An event sent while
another is being handled (by an effect, a listener or a synchronous activity)
waits its turn. Events sent before `start` wait for it. `stop` keeps the state,
and `start` resumes from it.

When a transition changes the state, it runs in this order:

1. the activities the new state no longer lists end;
2. the transition's effects run, in order;
3. the activities it newly lists start.

So a new activity sees what the effects did: a clock an effect shifted, or a
request an effect sent.

**A `send` can end its own runner.** A `send` from a callback (a frame, a timer,
a response) is handled before it returns. The event can end the very runner that
sent it, running its cleanup before `send` returns: an activity whose state
stops listing it, or a keyed effect whose transition asks for another effect
with its key. (A state change doesn't end effects; an unkeyed effect lasts until
the actor stops.) A runner that does more work after sending must request that
work first, so the cleanup cancels it, or check `signal.aborted` after sending.
For example, a frame loop should request the next frame before sending its tick.

In React, `useMachine(machine, options)` from
`@githubnext/projections-machine/react` runs an actor per component and returns
`[state, send, actor]`.

- Runners may close over props: each render's runners are used.
- The actor starts in a layout effect, so activities run before paint. A change
  an event makes there also renders before paint, as a `setState` would; a
  layout that measures and re-plans needs this.
- An actor outside React (the VS Code extension host, a class like an extraction
  coordinator) uses `createActor` directly. Its `subscribe` suits
  `useSyncExternalStore`.

## Test it

The transition is a pure function, so test it without a browser.
`explore(machine, options)` from `@githubnext/projections-machine/testing` walks
every state reachable from `from` by `events`, breadth first. It also fires the
events of each state's `after` timers.

```js
import {explore} from '@githubnext/projections-machine/testing'

explore(jobMachine, {
  from: {kind: 'idle'},
  events: [{type: 'start', run: 1}, {type: 'start', run: 2}, {type: 'named', run: 1, job: 'a'}, {type: 'finished'}, {type: 'cancel'}],
  invariants: {'a poll belongs to its run': state => state.kind !== 'polling' || state.run === 1},
  transitions: {'cancelling a named job cancels it': ({from, event, effects}) =>
    from.kind !== 'polling' || event.type !== 'cancel' || effects.some(effect => effect.type === 'cancelJob')},
  complete: true,
})
```

- **`invariants`** check every state reached.
- **`transitions`** check every step: `from`, `event`, `to`, `effects`.
- **`complete`** fails when a handler the definition lists is never taken. An
  unreachable transition is dead code, or a sign the events miss a case.

A violation throws an `ExplorationError` with the shortest path to it, for
example `idle --start--> starting --named--> polling --cancel--> idle`. Prefer
local properties, of a state or of one step, to properties of whole paths:
states are deduplicated, so each is checked on its shortest path. Give `key`
when the default identity is too fine or too coarse.

## What the checks hold you to

`npm run check:machines` (a `tools check --fast` gate, run in CI) does two
things:

- **The lifecycle rule** (`machines/lifecycle`) warns in the hosts and the VS
  Code extension about boolean refs, timers started from effects, and `useState`
  setters called from timer or promise callbacks. Those are the shapes implicit
  lifecycles take. The check fails when a file has more of them than
  [its baseline](../../tools/scripts/check-machines/baseline.json). It also
  fails when a file has fewer: lower the baseline with
  `node tools/scripts/check-machines.mjs --update` in the change that converts
  the code.
- **Every machine needs an `explore` test.** Bind each `defineMachine` to an
  exported const, and have a test in the workspace's `test/` directory call
  `explore(` with it.

## Why not a library

We weighed XState v5 and smaller libraries. XState's actor model is strong, but
it costs about 13 KB gzipped, roughly a tenth of a sandboxed renderer bundle.
Its context is shared across all states, so it can't make per-state data
exclusive. It also works against the two React-timed machines we care most
about: a layout loop that must settle before paint, and playback whose values an
embedder may own. This package keeps what we need: exhaustive typed handlers,
effects and activities as data, generations and exploration. It stays small
enough to read in one sitting. If a machine outgrows it (hierarchical states,
history, pausable timers across several concurrent actors), bring that case to a
design review rather than growing this package to match.
