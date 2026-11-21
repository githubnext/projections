// Compile-time checks (npm run typecheck): what a definition must say, and what TypeScript rejects.
import {after, createActor, defineMachine, emit, ignore} from '../src/index.js'

type State = {kind: 'idle'} | {kind: 'running'; job: string} | {kind: 'done'; result: number}
type Event = {type: 'start'; job: string} | {type: 'finished'; result: number} | {type: 'reset'}
type Effect = {readonly type: 'log'; readonly text: string} | {readonly type: 'notify'; readonly count: number}
interface Activity {
  type: 'poll'
  key: string
  job: string
}

const define = defineMachine<State, Event, Effect, Activity>()

export const complete = define({
  states: {
    idle: {on: {start: (_state, event) => ({kind: 'running', job: event.job}), finished: ignore, reset: ignore}},
    running: {
      on: {
        start: ignore,
        // The handler sees its own state's data and its own event's.
        finished: (state, event) =>
          emit({kind: 'done', result: event.result}, {type: 'log', text: state.job}, {type: 'notify', count: event.result}),
        reset: () => ({kind: 'idle'}),
      },
      activities: state => [{type: 'poll', key: state.job, job: state.job}, after('limit', 1000, {type: 'reset'})],
    },
    done: {on: {start: ignore, finished: ignore, reset: () => ({kind: 'idle'})}},
  },
})

define({
  // @ts-expect-error A state without a node.
  states: {
    idle: {on: {start: ignore, finished: ignore, reset: ignore}},
    running: {on: {start: ignore, finished: ignore, reset: ignore}},
  },
})

define({
  states: {
    // @ts-expect-error A node that doesn't consider every event.
    idle: {on: {start: ignore, finished: ignore}},
    running: {on: {start: ignore, finished: ignore, reset: ignore}},
    done: {on: {start: ignore, finished: ignore, reset: ignore}},
  },
})

define({
  states: {
    idle: {on: {start: ignore, finished: ignore, reset: ignore}},
    running: {on: {start: ignore, finished: ignore, reset: ignore}},
    done: {on: {start: ignore, finished: ignore, reset: ignore}},
    // @ts-expect-error A state the union doesn't have.
    paused: {on: {start: ignore, finished: ignore, reset: ignore}},
  },
})

define({
  states: {
    idle: {
      on: {
        // @ts-expect-error A transition to a state without its data.
        start: () => ({kind: 'running'}),
        finished: ignore,
        reset: ignore,
      },
    },
    running: {on: {start: ignore, finished: ignore, reset: ignore}},
    done: {on: {start: ignore, finished: ignore, reset: ignore}},
  },
})

define({
  states: {
    idle: {on: {start: ignore, finished: ignore, reset: ignore}},
    // @ts-expect-error A handler that reads data its state doesn't have.
    running: {on: {start: ignore, finished: state => ({kind: 'done', result: state.result}), reset: ignore}},
    done: {on: {start: ignore, finished: ignore, reset: ignore}},
  },
})

createActor(complete, {
  state: {kind: 'idle'},
  // Each runner sees its own effect's fields.
  effects: {log: effect => effect.text, notify: effect => effect.count},
  activities: {poll: (activity, context) => context.send({type: 'finished', result: activity.job.length})},
})

// @ts-expect-error An actor without a runner for each effect and activity type.
createActor(complete, {state: {kind: 'idle'}, effects: {log: () => undefined, notify: () => undefined}})
