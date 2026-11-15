import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
  createFrame,
  presentComparison,
  variedBeyond,
  variedBeyondLabel,
  variedName,
  variedValue,
  variedWithin,
  variedWords,
} from '../dist/presentation.js'
import {defaultThemeTokens, iconNames, iconToken, isIconValue} from '../dist/protocol.js'

const extraction = entities => ({
  protocolVersion: 0,
  schema: 'graph/v0',
  volatile: [{kinds: ['test'], path: '/data/durationMs', tolerance: {absolute: 50, relative: 0.2}}],
  entities,
  relationships: [],
})
const test_ = (id, durationMs, status = 'passed') => ({id, kind: 'test', label: id, data: {durationMs, status}})
const before = extraction([test_('parse', 100), test_('load', 100), test_('lex', 50)])
const after = extraction([test_('parse', 130), test_('load', 400), test_('lex', 50)])
const comparison = {
  protocolVersion: 0,
  changes: [
    {
      id: 'load',
      collection: 'entities',
      before: ['load'],
      after: ['load'],
      status: 'modified',
      correspondence: 'exact',
      varied: [{path: '/data/durationMs', within: false}],
    },
    {
      id: 'parse',
      collection: 'entities',
      before: ['parse'],
      after: ['parse'],
      status: 'unchanged',
      correspondence: 'exact',
      varied: [{path: '/data/durationMs', within: true}],
    },
  ],
  steps: [{changes: ['load']}],
  variation: {within: 1, beyond: 1},
}

test('presented rows carry the comparison’s varied values', () => {
  const presented = presentComparison(before, after, comparison)
  const row = id => presented.entities.find(entity => entity.id === id)
  assert.deepEqual(row('parse').varied, [{path: '/data/durationMs', within: true}])
  assert.deepEqual(row('load').varied, [{path: '/data/durationMs', within: false}])
  assert.equal(row('lex').varied, undefined)
  assert.ok(variedWithin(row('parse')) && !variedBeyond(row('parse')))
  assert.ok(variedBeyond(row('load')) && !variedWithin(row('load')))
  assert.ok(!variedWithin(row('lex')) && !variedBeyond(row('lex')))
})

test('a modified change is marked volatile only for a value beyond tolerance', () => {
  assert.ok(!variedBeyond({status: 'modified', varied: [{path: '/data/durationMs', within: true}]}))
  assert.ok(
    variedBeyond({
      status: 'modified',
      varied: [
        {path: '/data/a', within: true},
        {path: '/data/b', within: false},
      ],
    }),
  )
  assert.ok(!variedBeyond({status: 'unchanged', varied: [{path: '/data/a', within: false}]}))
  assert.ok(!variedBeyond({status: 'modified'}))
  assert.equal(variedBeyondLabel, 'Volatile field changed beyond tolerance')
})

test('items that varied within tolerance are never emphasized and move in no step', () => {
  const presented = presentComparison(before, after, comparison)
  for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    const frame = createFrame(after, presented, progress)
    const parse = frame.nodes.find(node => node.id === 'parse')
    assert.equal(parse.emphasis, 0, `at ${progress}`)
    assert.equal(parse.opacity, 1)
  }
  assert.deepEqual(
    presented.steps.flatMap(step => step.entities),
    ['load'],
  )
})

test('varied paths read as names and resolve against an item', () => {
  assert.equal(variedName('/data/durationMs'), 'durationMs')
  assert.equal(variedName('/data/timings/p~150'), 'timings/p/50')
  assert.equal(variedName('/data/a~0b'), 'a~b')
  const item = {data: {durationMs: 12, timings: [{p50: 3}], 'a/b': 1}}
  assert.equal(variedValue(item, '/data/durationMs'), 12)
  assert.equal(variedValue(item, '/data/timings/0/p50'), 3)
  assert.equal(variedValue(item, '/data/a~1b'), 1)
  assert.equal(variedValue(item, '/data/missing'), undefined)
  assert.equal(variedValue(item, '/data/timings/x'), undefined)
  assert.equal(variedWords(true), 'within tolerance')
  assert.equal(variedWords(false), 'beyond tolerance (volatile)')
})

test('the varied icon is in the vocabulary with a default image', () => {
  assert.ok(iconNames.includes('varied'))
  for (const mode of ['light', 'dark']) assert.ok(isIconValue(defaultThemeTokens(mode)[iconToken('varied')]))
})
