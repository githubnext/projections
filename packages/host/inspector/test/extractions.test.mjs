import {test} from 'node:test'
import assert from 'node:assert/strict'
import {ExtractionCoordinator} from '../dist/ui/app/extraction-coordinator.js'

/** A runner API whose every request waits for the test to settle it. */
function controlledApi() {
  const calls = []
  const request =
    method =>
    (...args) =>
      new Promise((resolve, reject) => calls.push({method, args, resolve, reject}))
  return {api: {run: request('run'), job: request('job'), cancel: request('cancel')}, calls}
}

const job = (id, status, extraction) => ({id, status, outputs: [], diagnostics: [], notices: [], ...(extraction ? {extraction} : {})})
const extraction = name => ({projection: {id: 'p', title: name}, entities: []})
const settle = () => new Promise(resolve => setImmediate(resolve))

function coordinator() {
  const reports = []
  const extractions = new ExtractionCoordinator({
    definition: () => undefined,
    shown: () => false,
    report: message => reports.push(message),
  })
  return {extractions, reports}
}

test('ending a generation stops its polling and leaves the runner job running', async t => {
  t.mock.timers.enable({apis: ['setTimeout']})
  const {api, calls} = controlledApi()
  const {extractions} = coordinator()
  extractions.connect(api)
  extractions.extract('p', ['HEAD'], {definition: 'wt'})
  calls[0].resolve(job('j1', 'running'))
  await settle()
  t.mock.timers.tick(200)
  await settle()
  assert.deepEqual(
    calls.map(call => call.method),
    ['run', 'job'],
  )

  extractions.disconnect()
  assert.equal(calls[1].args[1].aborted, true)
  calls[1].resolve(job('j1', 'completed', extraction('late')))
  t.mock.timers.tick(1000)
  await settle()
  assert.deepEqual(
    calls.map(call => call.method),
    ['run', 'job'],
  )
  const {rows, active, queue} = extractions.getSnapshot()
  assert.equal(active, undefined)
  assert.equal(rows.p.HEAD.status, 'queued')
  assert.deepEqual(
    queue.map(item => item.ref),
    ['HEAD'],
  )
})

test("a replaced API's completions are dropped; the next one extracts again", async t => {
  t.mock.timers.enable({apis: ['setTimeout']})
  const first = controlledApi()
  const second = controlledApi()
  const {extractions} = coordinator()
  extractions.connect(first.api)
  extractions.extract('p', ['HEAD'], {definition: 'wt'})
  first.calls[0].resolve(job('j1', 'running'))
  await settle()
  t.mock.timers.tick(200)
  await settle()

  extractions.connect(second.api)
  assert.equal(second.calls[0].method, 'run')
  first.calls[1].resolve(job('j1', 'completed', extraction('old')))
  await settle()
  assert.equal(extractions.getSnapshot().rows.p.HEAD.status, 'running')
  assert.ok(!extractions.getSnapshot().jobs.some(entry => entry.status === 'completed'))

  second.calls[0].resolve(job('j2', 'running'))
  await settle()
  t.mock.timers.tick(200)
  await settle()
  second.calls[1].resolve(job('j2', 'completed', extraction('new')))
  await settle()
  const row = extractions.getSnapshot().rows.p.HEAD
  assert.equal(row.status, 'done')
  assert.equal(row.document.projection.title, 'new')
  assert.equal(row.jobId, 'j2')
  assert.ok(!first.calls.some(call => call.method === 'cancel'))
})

test('a cancellation while a job starts cancels it once named, and what was queued never starts', async t => {
  t.mock.timers.enable({apis: ['setTimeout']})
  const {api, calls} = controlledApi()
  const {extractions} = coordinator()
  extractions.connect(api)
  extractions.extract('p', ['HEAD', 'main'], {definition: 'wt'})
  const cancelled = extractions.cancel()
  assert.equal(extractions.getSnapshot().rows.p.main.status, 'cancelled')
  assert.equal(extractions.getSnapshot().queue.length, 0)

  calls[0].resolve(job('j1', 'running'))
  await settle()
  assert.equal(calls[1].method, 'cancel')
  assert.equal(calls[1].args[0], 'j1')
  calls[1].resolve(job('j1', 'cancelled'))
  await cancelled
  await settle()
  t.mock.timers.tick(200)
  await settle()
  calls[2].resolve(job('j1', 'cancelled'))
  await settle()
  const {rows, active} = extractions.getSnapshot()
  assert.equal(rows.p.HEAD.status, 'cancelled')
  assert.equal(active, undefined)
  assert.deepEqual(
    calls.map(call => call.method),
    ['run', 'cancel', 'job'],
  )
})

test('a completion arriving after its row was asked for again, or dropped, publishes nothing', async t => {
  t.mock.timers.enable({apis: ['setTimeout']})
  const {api, calls} = controlledApi()
  const {extractions, reports} = coordinator()
  extractions.connect(api)
  extractions.extract('p', ['HEAD'], {definition: 'd1'})
  calls[0].resolve(job('j1', 'running'))
  await settle()

  extractions.extract('p', ['HEAD'], {definition: 'd2'})
  t.mock.timers.tick(200)
  await settle()
  calls[1].resolve(job('j1', 'completed', extraction('old')))
  await settle()
  assert.equal(extractions.extracted('p', 'd1', 'HEAD'), undefined)
  assert.equal(extractions.getSnapshot().rows.p.HEAD.document, undefined)
  assert.equal(calls[2].method, 'run')
  assert.equal(calls[2].args[0].definitionRevision, 'd2')

  // A new extractor drops the projection's rows: the job running meanwhile fails unseen.
  calls[2].resolve(job('j2', 'running'))
  await settle()
  extractions.setRows(current => ({...current, p: {}}))
  t.mock.timers.tick(200)
  await settle()
  calls[3].resolve({...job('j2', 'failed'), diagnostics: [{message: 'boom'}]})
  await settle()
  assert.deepEqual(extractions.getSnapshot().rows.p, {})
  assert.deepEqual(reports, [])
  assert.equal(extractions.getSnapshot().active, undefined)
})
