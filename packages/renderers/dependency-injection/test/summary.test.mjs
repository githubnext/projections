import {test} from 'node:test'
import assert from 'node:assert/strict'
import {rendererSummary} from '@githubnext/projections-renderer-kit'
import {parseSummaryItems} from '@githubnext/projections-renderer-sdk/protocol'
import {summarySentence} from '@githubnext/projections-renderer-sdk/presentation'
import {dependencyInjectionFacts, dependencyInjectionNouns} from '../node_modules/.cache/test/summary.js'
import {compared, extractionModel} from './engine.mjs'
import {loadPair} from './fixtures.mjs'

const base = {
  projection: {id: 'p', title: 'P', renderer: 'dependency-injection'},
  theme: {colorMode: 'light', tokens: {}},
  reducedMotion: false,
  locale: 'en',
}

test("the summary bar names the composition's parts once each, then the facets that changed", async () => {
  const {before, after} = loadPair('orders')
  const {model, comparison} = await compared(before, after)
  const init = {...base, mode: 'comparison', before, after, comparison, comparisonMode: 'diff'}
  const summary = rendererSummary(
    init,
    dependencyInjectionNouns,
    dependencyInjectionFacts({init, model, controls: {}, rendererName: 'dependency-injection'}),
  )
  assert.ok(parseSummaryItems(summary.items))
  // A registration is counted once, as an entity; the relationship of that name folds it into its card.
  assert.equal(
    summarySentence(summary.items, 'en-US'),
    '10 services +2 \u22121 · 11 registrations +2 \u22121 ~1 · 11 implementations +2 \u22121 · 10 dependencies +3 \u22122 · 1 runtime resolution +1 · 1 lifetime changed',
  )
  const single = {...base, mode: 'extraction', extraction: after}
  assert.deepEqual(
    dependencyInjectionFacts({init: single, model: extractionModel(after), controls: {}, rendererName: 'dependency-injection'}),
    [],
  )
  assert.equal(
    summarySentence(rendererSummary(single, dependencyInjectionNouns).items, 'en-US'),
    '10 services · 11 registrations · 11 implementations · 10 dependencies · 1 runtime resolution',
  )
})
