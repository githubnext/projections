import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {rendererSummary, stepEmphasis} from '@githubnext/projections-renderer-kit'
import {summarySentence} from '@githubnext/projections-renderer-sdk/presentation'
// `npm test` compiles src/ (without the browser entry) to this cache directory first.
import {CodeStatisticsRenderer} from '../node_modules/.cache/test/renderer.js'
import {codeStatisticsFacts, codeStatisticsNouns} from '../node_modules/.cache/test/summary.js'
import {signed} from '../node_modules/.cache/test/timeline.js'
import {compared} from './engine.mjs'
import {loadPair} from './fixtures.mjs'

/** Diff mode as the shell presents it: one static frame at progress 1 with no schedule. */
async function renderDiff(scenario, overrides = {}) {
  const {before, after} = loadPair(scenario)
  const {model, comparison} = await compared(before, after)
  const highlighting = overrides.highlighting ?? 1
  const html = renderToStaticMarkup(
    createElement(CodeStatisticsRenderer, {
      init: {},
      model,
      comparing: true,
      diff: true,
      comparisonMode: 'diff',
      progress: 1,
      highlighting,
      direction: 1,
      schedule: [],
      rendererName: 'code-statistics',
      selectedId: null,
      onSelect() {},
      onOpen() {},
      reportSteps() {},
      declareControls() {},
      emphasis: stepEmphasis([], 1, highlighting),
      onAction: () => () => {},
      options: {},
      viewport: undefined,
      reducedMotion: false,
      locale: 'en-US',
      ...overrides,
      controls: overrides.controls ?? {},
    }),
  )
  return {html, before, after, comparison}
}

const format = value => value.toLocaleString('en-US')
const total = (extraction, key = 'code') => extraction.entities.reduce((sum, entity) => sum + (entity.data[key] ?? 0), 0)
/** The sentence the host's summary bar says for a comparison, with these control values. */
async function barSentence(scenario, controls = {}) {
  const {before, after} = loadPair(scenario)
  const {model, comparison} = await compared(before, after)
  const init = {mode: 'comparison', before, after, comparison, comparisonMode: 'diff', locale: 'en-US'}
  const facts = codeStatisticsFacts({init, model, controls, rendererName: 'code-statistics'})
  return {sentence: summarySentence(rendererSummary(init, codeStatisticsNouns, facts).items, 'en-US'), before, after, comparison}
}
const words = html => html.replace(/<span class="sr-only">.*?<\/span>/g, '').replace(/<[^>]+>/g, '')
/** Each bar row's markup, by entity ID. */
const rows = html =>
  new Map(
    html
      .split('<div class="stat-slot ')
      .slice(1)
      .map(row => [row.match(/data-statistics-id="([^"]+)"/)[1], row]),
  )

test("the host's summary bar states the languages and the total with its change; the diff draws no summary line", async () => {
  for (const [scenario, expected] of [
    ['languages', '5 languages +1 \u22121 ~2 · 2,700 lines of code +460'],
    ['gateway', '11 languages +2 \u22121 ~8 · 39,882 lines of code +2,056'],
  ]) {
    const {sentence, before, after, comparison} = await barSentence(scenario)
    assert.equal(sentence, expected, scenario)
    // Every number comes from the extractions and every count from the comparison.
    assert.ok(expected.endsWith(`${format(total(after))} lines of code ${signed(total(after) - total(before), format)}`))
    const counted = status => comparison.changes.filter(change => change.status === status).length
    assert.ok(expected.includes(`+${counted('added')}`) && expected.includes(`~${counted('modified')}`))
    const {html} = await renderDiff(scenario)
    assert.doesNotMatch(html, /pk-diff-summary|statistics-header|lines of code \(was/)
  }
  // The measure, files scope and grouping change the total's noun and counts.
  assert.match((await barSentence('languages', {measure: 'files'})).sentence, / · 29 files \+2$/)
  assert.match((await barSentence('languages', {scope: 'tests'})).sentence, / · 770 lines of code in tests \+290$/)
  assert.match((await barSentence('languages', {byLanguage: false})).sentence, / · 3,405 lines \+518$/)
})

test('every language of either revision keeps one row with its Before count struck, its After count and the signed change', async () => {
  for (const scenario of ['languages', 'gateway']) {
    const {html, before, after, comparison} = await renderDiff(scenario)
    const drawn = rows(html)
    const ids = new Set([...before.entities, ...after.entities].map(entity => entity.id))
    assert.deepEqual(new Set(drawn.keys()), ids, `${scenario}: the union of both revisions`)
    for (const id of ids) {
      const row = drawn.get(id)
      const was = before.entities.find(entity => entity.id === id)?.data.code
      const now = after.entities.find(entity => entity.id === id)?.data.code
      const status = comparison.changes.find(change => change.id === id)?.status ?? 'unchanged'
      const mark = row.match(/class="stat-row[^"]*"[^>]*?data-change="(\w+)"/)?.[1] ?? 'unchanged'
      assert.equal(mark, status, `${id} is marked as the comparison changed it`)
      const struck = row.match(/<del class="stat-was"><span class="sr-only">was <\/span>([\d,]+)<\/del>/)?.[1]
      const shown = row.match(/<span class="stat-now">(?:<span class="sr-only">, now <\/span>)?([\d,]+)<\/span>/)?.[1]
      const delta = row.match(/stat-diff-delta (?:added|removed)">([^<]+)</)?.[1]
      if (status === 'added') {
        assert.equal(struck, undefined)
        assert.equal(shown, format(now))
        assert.equal(delta, signed(now, format))
        assert.match(row, /<span class="stat-gain diff"/)
      } else if (status === 'removed') {
        assert.equal(struck, format(was), `${id} keeps its Before count, struck through`)
        assert.equal(shown, undefined)
        assert.equal(delta, signed(-was, format))
        assert.match(row, /<span class="stat-loss diff"/)
        assert.match(row, /class="stat-label pk-diff-text"/)
      } else if (was !== now) {
        assert.equal(struck, format(was))
        assert.equal(shown, format(now))
        assert.equal(delta, signed(now - was, format))
        assert.match(row, now > was ? /<span class="stat-gain diff"/ : /<span class="stat-loss diff"/)
      } else {
        assert.equal(struck, undefined)
        assert.equal(delta, undefined)
        assert.equal(shown, format(now))
        assert.doesNotMatch(row, /stat-gain|stat-loss/)
      }
      // The change is stated in words, not color alone.
      if (status !== 'unchanged') {
        assert.match(row, new RegExp(`aria-label="Inspect [^"]*, ${status[0].toUpperCase()}${status.slice(1)}"`))
        assert.match(row, new RegExp(`data-change-status="${status}"`))
      }
    }
  }
  const {html} = await renderDiff('languages')
  assert.match(html, /aria-label="Inspect Ruby, was 120 lines of code, −120, Removed"/)
  assert.match(html, /aria-label="Inspect TypeScript, 1,400 lines of code, was 1,000, \+400, Modified"/)
  assert.match(html, /aria-label="Inspect Python, 300 lines of code, \+300, Added"/)
})

test('highlighting off draws diff mode plain but keeps every count and row', async () => {
  const on = await renderDiff('gateway')
  const off = await renderDiff('gateway', {highlighting: 0})
  assert.equal(words(off.html), words(on.html).replace(/Modified|Removed|Added/g, ''))
  assert.doesNotMatch(off.html, /stat-gain|stat-loss|data-change-status/)
  for (const row of rows(off.html).values()) if (/data-change=/.test(row)) assert.match(row, /--emphasis:0/)
})

test('the share chart pairs the rings: After outside, Before inside, with the values beside them', async () => {
  const {html} = await renderDiff('languages', {controls: {chart: 'share'}})
  const arc = id => html.match(new RegExp(`<g class="stat-arc[^"]*"[^>]*data-entity-id="${id}".*?</g>`))[0]
  assert.match(arc('language:Ruby'), /data-change="removed"/)
  assert.match(arc('language:Ruby'), /stat-ring-slice before/)
  assert.doesNotMatch(arc('language:Ruby'), /stat-ring-slice after/)
  assert.match(arc('language:Ruby'), /aria-label="Ruby, was 120 lines of code, −120, was 5 percent, Removed"/)
  assert.doesNotMatch(arc('language:Python'), /stat-ring-slice before/)
  assert.match(arc('language:Python'), /aria-label="Python, 300 lines of code, \+300, 11 percent, Added"/)
  assert.match(
    arc('language:TypeScript'),
    /aria-label="TypeScript, 1,400 lines of code, was 1,000, \+400, 52 percent, was 45 percent, Modified"/,
  )
  assert.match(html, /Outer ring After, inner ring Before/)
  assert.equal([...html.matchAll(/class="stat-values-row pk-region[^"]*" data-entity-id="[^"]+"/g)].length, 6)
})

test('the composition marks each line kind that changed and states it in words', async () => {
  const {html} = await renderDiff('languages', {controls: {byLanguage: false}})
  assert.equal([...html.matchAll(/class="stat-row pk-region" data-change="modified"/g)].length, 3)
  assert.equal([...html.matchAll(/data-change-status="modified"/g)].length, 3)
  assert.match(html, /aria-label="Code, 2,700 lines, was 2,240, \+460"/)
})
