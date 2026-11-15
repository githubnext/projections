import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {comparisonModel, extractionModel, rendererSummary} from '@githubnext/projections-renderer-kit'
import {parseSummaryItems} from '@githubnext/projections-renderer-sdk/protocol'
import {summaryCountText} from '@githubnext/projections-renderer-sdk/presentation'
import {createNativeEngine} from '@githubnext/projections-engine/native'
import {textDiffFacts, textDiffNouns} from '../node_modules/.cache/test/summary.js'

const engine = createNativeEngine()
const graph = entities => ({protocolVersion: 0, schema: 'graph/v0', entities, relationships: []})
const output = (id, text) => ({id, kind: 'output', label: id, data: {text}})
const base = {
  projection: {id: 'p', title: 'P', renderer: 'text-diff'},
  theme: {colorMode: 'light', tokens: {}},
  reducedMotion: false,
  locale: 'en',
}
const words = item =>
  `${summaryCountText(item.count, item.noun)}${item.added ? ` +${item.added}` : ''}${item.removed ? ` −${item.removed}` : ''}${item.modified ? ` ~${item.modified}` : ''}`

async function summarize(before, after) {
  const comparison = await engine.compare(before, after)
  const init = {...base, mode: 'comparison', before, after, comparison, comparisonMode: 'diff'}
  const facts = textDiffFacts({init, model: comparisonModel(before, after, comparison), controls: {}, rendererName: 'text-diff'})
  return rendererSummary(init, textDiffNouns, facts).items
}

test('a comparison counts outputs, then the lines the diff inserts and deletes across them', async () => {
  const before = graph([output('report', 'Total: 3\nPKG-1\nPKG-2\n'), output('help', 'usage: tool\n'), output('gone', 'bye\nnow\n')])
  const after = graph([output('report', 'Total: 4\nPKG-1\nPKG-2\nPKG-3\n'), output('help', 'usage: tool\n'), output('new', 'hi\n')])
  const items = await summarize(before, after)
  assert.ok(parseSummaryItems(items))
  // After has 4 + 1 + 1 lines; `report` replaces one line and adds one, `new` adds its line, `gone` deletes both.
  assert.deepEqual(items.map(words), ['3 outputs +1 −1 ~1', '6 lines +3 −3'])
  const lines = items.at(-1)
  assert.equal(lines.count - lines.added + lines.removed, 3 + 1 + 2, 'what the count was is Before’s line count')
})

test('unchanged outputs keep their lines and report no changes', async () => {
  const same = graph([output('version', '1.2.0\n')])
  assert.deepEqual((await summarize(same, structuredClone(same))).map(words), ['1 output', '1 line'])
})

test('one revision counts every output’s lines, without changes', () => {
  const extraction = JSON.parse(readFileSync(new URL('../fixtures/parcel-cli-after.json', import.meta.url), 'utf8'))
  const init = {...base, mode: 'extraction', extraction}
  const facts = textDiffFacts({init, model: extractionModel(extraction), controls: {}, rendererName: 'text-diff'})
  const lineCount = text => text.split(/\r\n|\n|\r/).length - (/(\r\n|\n|\r)$/.test(text) || text === '' ? 1 : 0)
  const expected = extraction.entities.reduce((sum, entity) => sum + lineCount(entity.data.text), 0)
  assert.deepEqual(facts, [{type: 'fact', id: 'lines', count: expected, noun: {singular: 'line', plural: 'lines'}}])
})

test('an output the view refuses adds no lines and doesn’t throw', () => {
  const extraction = graph([output('ok', 'a\nb\n'), {id: 'bad', kind: 'output', label: 'bad', data: {}}])
  const init = {...base, mode: 'extraction', extraction}
  const facts = textDiffFacts({init, model: extractionModel(extraction), controls: {}, rendererName: 'text-diff'})
  assert.equal(facts[0].count, 2)
})
