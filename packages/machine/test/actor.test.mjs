import {test} from 'node:test'
import assert from 'node:assert/strict'
import {after, createActor, defineMachine, emit, ignore} from '../dist/index.js'

// A job runner: start names a job, polling runs while it does, a cancel asks for the job's cancellation.
const runner = defineMachine()({
  states: {
    idle: {
      on: {
        start: (_state, event) => emit({kind: 'starting', run: event.run}, {type: 'create', key: 'create', run: event.run}),
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
        timeout: () => ({kind: 'failed'}),
      },
      activities: state => [after(`limit:${state.run}`, 1000, {type: 'timeout'})],
    },
    polling: {
      on: {
        start: ignore,
        named: ignore,
        finished: (_state, event) => ({kind: 'done', result: event.result}),
        cancel: state => emit({kind: 'idle'}, {type: 'cancelJob', job: state.job}),
        timeout: ignore,
      },
      activities: state => [{type: 'poll', key: `poll:${state.job}`, job: state.job}],
    },
    done: {on: {start: ignore, named: ignore, finished: ignore, cancel: ignore, timeout: ignore}},
    failed: {on: {start: ignore, named: ignore, finished: ignore, cancel: ignore, timeout: ignore}},
  },
})

test('a transition returns the next state, its effects and whether a handler took the event', () => {
  const started = runner.transition({kind: 'idle'}, {type: 'start', run: 1})
  assert.deepEqual(started, {state: {kind: 'starting', run: 1}, effects: [{type: 'create', key: 'create', run: 1}], handled: true})
  const idle = {kind: 'idle'}
  assert.deepEqual(runner.transition(idle, {type: 'cancel'}), {state: idle, effects: [], handled: false})
  assert.equal(runner.transition(idle, {type: 'cancel'}).state, idle)
})

test('a state or event the definition lacks, or a transition to an unknown state, throws', () => {
  assert.throws(() => runner.transition({kind: 'paused'}, {type: 'start', run: 1}), /no state "paused"/)
  assert.throws(() => runner.transition({kind: 'idle'}, {type: 'pause'}), /no handler for "pause"/)
  const broken = defineMachine()({states: {a: {on: {go: () => ({kind: 'b'})}}}})
  assert.throws(() => broken.transition({kind: 'a'}, {type: 'go'}), /no state "b"/)
})

test("an actor runs effects, keeps each state's activities running and stops them when the state leaves", () => {
  const log = []
  const actor = createActor(runner, {
    state: {kind: 'idle'},
    effects: {
      create: (effect, context) => context.send({type: 'named', run: effect.run, job: 'j1'}),
      cancelJob: effect => log.push(`cancel ${effect.job}`),
    },
    activities: {
      poll: (activity, context) => {
        log.push(`poll ${activity.job}`)
        context.signal.addEventListener('abort', () => log.push(`aborted ${activity.job}`))
        return () => log.push(`stopped ${activity.job}`)
      },
    },
  })
  const seen = []
  actor.subscribe(state => seen.push(state.kind))
  actor.start()
  actor.send({type: 'start', run: 1})
  // The effect's event waited for the start to be handled, then ran in the same batch: one notification.
  assert.deepEqual(actor.getState(), {kind: 'polling', run: 1, job: 'j1'})
  assert.deepEqual(seen, ['polling'])
  actor.send({type: 'cancel'})
  assert.deepEqual(log, ['poll j1', 'aborted j1', 'stopped j1', 'cancel j1'])
  assert.equal(actor.getState().kind, 'idle')
})

test("an activity's events are dropped once its state stops listing it", () => {
  let late
  const actor = createActor(runner, {
    state: {kind: 'polling', run: 1, job: 'j1'},
    effects: {create: () => undefined, cancelJob: () => undefined},
    activities: {poll: (_activity, context) => (late = context.send)},
  })
  actor.start()
  actor.send({type: 'cancel'})
  late({type: 'finished', result: 7})
  assert.equal(actor.getState().kind, 'idle')
})

test('a keyed effect supersedes the running one: the earlier result never arrives', () => {
  const sends = []
  const actor = createActor(runner, {
    state: {kind: 'idle'},
    effects: {create: (_effect, context) => sends.push(context), cancelJob: () => undefined},
    activities: {poll: () => undefined},
  })
  actor.start()
  actor.send({type: 'start', run: 1})
  actor.send({type: 'cancel'})
  actor.send({type: 'start', run: 2})
  assert.equal(sends[0].signal.aborted, true)
  sends[0].send({type: 'named', run: 2, job: 'stale'})
  assert.deepEqual(actor.getState(), {kind: 'starting', run: 2})
  sends[1].send({type: 'named', run: 2, job: 'fresh'})
  assert.deepEqual(actor.getState(), {kind: 'polling', run: 2, job: 'fresh'})
})

test('an after timer sends its event, and leaving the state clears it', t => {
  t.mock.timers.enable({apis: ['setTimeout']})
  const actor = createActor(runner, {
    state: {kind: 'idle'},
    effects: {create: () => undefined, cancelJob: () => undefined},
    activities: {poll: () => undefined},
  })
  actor.start()
  actor.send({type: 'start', run: 1})
  actor.send({type: 'cancel'})
  actor.send({type: 'start', run: 2})
  t.mock.timers.tick(999)
  assert.equal(actor.getState().kind, 'starting')
  t.mock.timers.tick(1)
  assert.equal(actor.getState().kind, 'failed')
})

test('events wait for start, stop ends every generation, and start resumes from the kept state', () => {
  let poll
  const actor = createActor(runner, {
    state: {kind: 'idle'},
    effects: {create: (effect, context) => context.send({type: 'named', run: effect.run, job: 'j'}), cancelJob: () => undefined},
    activities: {poll: (_activity, context) => (poll = context)},
  })
  actor.send({type: 'start', run: 1})
  assert.equal(actor.getState().kind, 'idle')
  actor.start()
  assert.equal(actor.getState().kind, 'polling')
  const first = poll
  actor.stop()
  assert.equal(first.signal.aborted, true)
  first.send({type: 'finished', result: 1})
  actor.start()
  assert.equal(actor.getState().kind, 'polling')
  assert.notEqual(poll, first)
  poll.send({type: 'finished', result: 2})
  assert.deepEqual(actor.getState(), {kind: 'done', result: 2})
})

test("a runner's error or rejection is reported, and the actor keeps going", async () => {
  const errors = []
  const actor = createActor(runner, {
    state: {kind: 'idle'},
    onError: error => errors.push(error.message),
    effects: {
      create: () => {
        throw new Error('create failed')
      },
      cancelJob: () => Promise.reject(new Error('cancel failed')),
    },
    activities: {poll: () => undefined},
  })
  actor.start()
  actor.send({type: 'start', run: 1})
  assert.equal(actor.getState().kind, 'starting')
  actor.send({type: 'named', run: 1, job: 'j'})
  actor.send({type: 'cancel'})
  assert.equal(actor.getState().kind, 'idle')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(errors, ['create failed', 'cancel failed'])
})

test('two activities with one key in a state are a definition error', () => {
  const twice = defineMachine()({states: {a: {on: {}, activities: () => [after('t', 1, {type: 'x'}), after('t', 2, {type: 'x'})]}}})
  assert.throws(() => createActor(twice, {state: {kind: 'a'}}).start(), /two activities keyed "t"/)
})

// A counter for ordering checks: `add` adds, effects ask for work and report back.
const counter = defineMachine()({
  states: {
    counting: {
      on: {
        add: (state, event) => ({kind: 'counting', n: state.n + event.by}),
        twice: state => emit(state, {type: 'work', key: 'work', by: 10}, {type: 'work', key: 'work', by: 100}),
        hold: state => emit(state, {type: 'hold', name: 'a'}, {type: 'hold', name: 'b'}),
      },
    },
  },
})

test('an event a superseded effect sent while it waited to be taken is dropped too', () => {
  const actor = createActor(counter, {
    state: {kind: 'counting', n: 0},
    effects: {work: (effect, context) => context.send({type: 'add', by: effect.by}), hold: () => undefined},
  })
  actor.start()
  actor.send({type: 'twice'})
  // Both results were sent before either was taken; the first effect was superseded by then.
  assert.equal(actor.getState().n, 100)
})

test("every effect's cleanup runs when the actor stops", () => {
  const cleaned = []
  const actor = createActor(counter, {
    state: {kind: 'counting', n: 0},
    effects: {work: () => undefined, hold: effect => () => cleaned.push(effect.name)},
  })
  actor.start()
  actor.send({type: 'hold'})
  actor.stop()
  assert.deepEqual(cleaned, ['a', 'b'])
})

test('every listener hears a batch before the events listeners send are taken', () => {
  const actor = createActor(counter, {state: {kind: 'counting', n: 0}, effects: {work: () => undefined, hold: () => undefined}})
  const heard = []
  actor.subscribe(state => {
    if (state.n === 1) actor.send({type: 'add', by: 1})
  })
  actor.subscribe(state => heard.push(state.n))
  actor.start()
  actor.send({type: 'add', by: 1})
  assert.deepEqual(heard, [1, 2])
})

test("a transition's effects run after the activities it ends stop, and before the activities it starts", () => {
  const log = []
  const phases = defineMachine()({
    states: {
      paused: {
        on: {play: () => emit({kind: 'playing'}, {type: 'shift'}), pause: ignore},
        activities: () => [{type: 'watch', key: 'paused'}],
      },
      playing: {on: {play: ignore, pause: () => ({kind: 'paused'})}, activities: () => [{type: 'watch', key: 'playing'}]},
    },
  })
  const actor = createActor(phases, {
    state: {kind: 'paused'},
    effects: {shift: () => log.push('effect')},
    activities: {
      watch: ({key}) => {
        log.push(`start ${key}`)
        return () => log.push(`stop ${key}`)
      },
    },
  })
  actor.start()
  actor.send({type: 'play'})
  assert.deepEqual(log, ['start paused', 'stop paused', 'effect', 'start playing'])
  actor.stop()
})

test('an effect that stops the actor leaves the new state’s activities to the next start', () => {
  const started = []
  let actor
  const phases = defineMachine()({
    states: {
      idle: {on: {go: () => emit({kind: 'busy'}, {type: 'halt'})}},
      busy: {on: {go: ignore}, activities: () => [{type: 'work', key: 'work'}]},
    },
  })
  actor = createActor(phases, {
    state: {kind: 'idle'},
    effects: {halt: () => actor.stop()},
    activities: {work: () => void started.push('work')},
  })
  actor.start()
  actor.send({type: 'go'})
  assert.deepEqual(started, [])
  actor.start()
  assert.deepEqual(started, ['work'])
  actor.stop()
})

test('a send from a callback that leaves the state ends its own activity before it returns', () => {
  const seen = []
  let later
  const once = defineMachine()({
    states: {
      ticking: {on: {tick: () => ({kind: 'done'})}, activities: () => [{type: 'loop', key: 'loop'}]},
      done: {on: {tick: ignore}},
    },
  })
  const actor = createActor(once, {
    state: {kind: 'ticking'},
    activities: {
      loop: (_, {send, signal}) => {
        signal.addEventListener('abort', () => seen.push('cleanup'))
        // A frame or timer callback, after the actor has finished handling events.
        later = () => {
          send({type: 'tick'})
          seen.push(signal.aborted ? 'aborted' : 'live')
        }
      },
    },
  })
  actor.start()
  later()
  assert.deepEqual(seen, ['cleanup', 'aborted'])
})
