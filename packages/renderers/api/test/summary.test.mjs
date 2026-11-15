import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {comparisonModel, extractionModel, rendererSummary} from '@githubnext/projections-renderer-kit'
import {parseSummaryItems} from '@githubnext/projections-renderer-sdk/protocol'
import {summaryCountText} from '@githubnext/projections-renderer-sdk/presentation'
import {createNativeEngine} from '@githubnext/projections-engine/native'
import {apiFacts, apiNouns} from '../node_modules/.cache/test/summary.js'

const engine = createNativeEngine()
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
const base = {
  projection: {id: 'p', title: 'P', renderer: 'api'},
  theme: {colorMode: 'light', tokens: {}},
  reducedMotion: false,
  locale: 'en',
}
const sentence = items => items.map(item => summaryCountText(item.count, item.noun))

test('the summary bar counts declarations as one figure and the compatibility levels as facts, breaking first', async () => {
  const before = fixture('http-client-v1')
  const after = fixture('http-client-v2')
  const comparison = await engine.compare(before, after)
  const compatibility = {
    version: 0,
    rules: 'Shared rules',
    counts: {breaking: 1, additive: 1, compatible: 0, unknown: 1},
    changes: Object.fromEntries(
      comparison.changes
        .filter(change => change.status !== 'unchanged' && change.collection === 'entities')
        .slice(0, 3)
        .map((change, index) => [change.id, {level: ['additive', 'breaking', 'unknown'][index], reason: 'Because'}]),
    ),
    notices: [],
  }
  const classified = {...comparison, metadata: {compatibility}}
  const init = {...base, mode: 'comparison', before, after, comparison: classified, comparisonMode: 'diff'}
  const facts = apiFacts({init, model: comparisonModel(before, after, classified), controls: {}, rendererName: 'api'})
  assert.deepEqual(sentence(facts), ['1 breaking change', '1 change of unknown compatibility', '1 additive change'])
  assert.deepEqual(
    facts.map(fact => [fact.icon, fact.ids.length, fact.description]),
    [
      ['breaking', 1, 'Rules: Shared rules'],
      ['unknown', 1, 'Rules: Shared rules'],
      ['additive', 1, 'Rules: Shared rules'],
    ],
  )
  const summary = rendererSummary(init, apiNouns, facts)
  assert.ok(parseSummaryItems(summary.items))
  // Every declaration kind is a declaration; containment is no figure.
  const counts = summary.items.filter(item => item.type === 'count')
  assert.ok(counts.length > 1, 'one count item per extraction kind, which the host merges by noun')
  assert.ok(counts.every(item => item.collection === 'entities' && item.noun.plural === 'declarations'))
})

test('an unclassified comparison or one revision has no facts', async () => {
  const before = fixture('http-client-v1')
  const after = fixture('http-client-v2')
  const comparison = await engine.compare(before, after)
  const init = {...base, mode: 'comparison', before, after, comparison, comparisonMode: 'diff'}
  assert.deepEqual(apiFacts({init, model: comparisonModel(before, after, comparison), controls: {}, rendererName: 'api'}), [])
  const single = {...base, mode: 'extraction', extraction: after}
  assert.deepEqual(apiFacts({init: single, model: extractionModel(after), controls: {}, rendererName: 'api'}), [])
})
