import assert from 'node:assert/strict'
import test from 'node:test'
import {canonical, cases, expected, fixture, run} from '../../test-support.mjs'

const [handlers, publishers] = cases('message-handlers')

test('reproduces the former built-in message-handlers extractor', async () => {
  for (const {name, inputs} of cases('message-handlers')) {
    assert.equal(
      await canonical(await run('message-handlers', fixture('message-handlers', name), inputs)),
      await canonical(expected('message-handlers', name)),
      name,
    )
  }
})

test('calls, registries and decorators bind events to resolved handlers', async () => {
  const state = await run('message-handlers', fixture('message-handlers', 'handlers'), handlers.inputs)
  assert.deepEqual(
    state.entities
      .filter(node => node.kind === 'event')
      .map(node => node.label)
      .sort(),
    ['created', 'deleted', 'updated'],
  )
  assert.equal(state.relationships.filter(edge => edge.kind === 'consumes').length, 3)
  assert(state.entities.some(node => node.kind === 'handler' && node.label === 'receive'))
  assert(state.entities.some(node => node.kind === 'handler' && node.label === 'Worker.run'))
})

test('publish APIs attribute events to their enclosing publisher and warn on dynamic events', async () => {
  const state = await run('message-handlers', fixture('message-handlers', 'publishers'), publishers.inputs)
  const label = new Map(state.entities.map(node => [node.id, node.label]))
  assert.deepEqual(
    state.relationships.filter(edge => edge.kind === 'publishes').map(edge => [label.get(edge.from), label.get(edge.to)]),
    [['create', 'created']],
  )
  assert.deepEqual(
    state.entities
      .filter(node => node.kind === 'event')
      .map(node => node.label)
      .sort(),
    ['archived', 'created'],
  )
  assert.match(JSON.stringify(state.metadata), /dynamic event/)
})

test('requires at least one registration convention', async () => {
  await assert.rejects(run('message-handlers', fixture('message-handlers', 'handlers')), /requires inputs/)
  await assert.rejects(
    run('message-handlers', fixture('message-handlers', 'handlers'), {...handlers.inputs, eventArgument: 1.5}),
    /nonnegative integer/,
  )
})
