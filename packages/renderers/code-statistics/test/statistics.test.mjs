import {test} from 'node:test'
import {
  categoryPalette,
  ease,
  languageCategory,
  motionWindow,
  smootherstep,
  stepEmphasis,
  codeStatisticsControls,
  codeStatisticsControlsFor,
  codeStatisticsOptions,
} from '@githubnext/projections-renderer-kit'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
// `npm test` compiles src/ (without the browser entry) to this cache directory first.
import {donutSlice, signed, statisticsMotion} from '../node_modules/.cache/test/timeline.js'
import {controlValues, parseControls} from '@githubnext/projections-renderer-sdk/protocol'
import {languageColor, languageNamed} from '@githubnext/projections-renderer-sdk/languages'
import {CodeStatisticsRenderer} from '../node_modules/.cache/test/renderer.js'
import {codeStatisticsFacts} from '../node_modules/.cache/test/summary.js'
import {compared, extractionModel, scheduleSteps, stepEnds, stepHolds} from './engine.mjs'
import {loadFixture, loadPair} from './fixtures.mjs'

const noop = () => undefined

const before = loadFixture('before')
const after = loadFixture('after')

/** The total the host's summary bar states for a comparison (`codeStatisticsFacts`): its count, change and noun. */
async function total(controls, model) {
  const [fact] = codeStatisticsFacts({
    init: {mode: 'comparison'},
    model: model ?? (await compared(before, after)).model,
    controls: controls ?? {},
    rendererName: 'code-statistics',
  })
  return {count: fact.count, change: (fact.added ?? 0) - (fact.removed ?? 0), noun: fact.noun.plural}
}

/** Moves the steps that change any of `ids` to the front (like the priority-order example comparator). */
const prioritize = (comparison, ids) => {
  const first = comparison.steps.filter(step => step.changes.some(change => ids.includes(change)))
  return {...comparison, steps: [...first, ...comparison.steps.filter(step => !first.includes(step))]}
}

test('each language changes in its own comparison step: enter empty then grow, shrink then leave', async () => {
  const {model} = await compared(before, after)
  const schedule = scheduleSteps(model)
  const motion = statisticsMotion(model, schedule)
  const [removed, resized, added] = stepEnds(schedule)
  const centre = motionWindow(schedule.find(step => step.entities.includes('language:TypeScript'))).time
  assert.deepEqual(
    model.steps.map(step => step.kind),
    ['remove', 'restructure', 'add'],
  )
  assert.deepEqual(motion('language:Ruby', removed), {size: 0, opacity: 0, mix: 1, local: 1})
  assert.deepEqual(motion('language:TypeScript', removed), {size: 1, opacity: 1, mix: 0, local: 0})
  assert.deepEqual(motion('language:TypeScript', resized), {size: 1, opacity: 1, mix: 1, local: 1})
  assert.deepEqual(motion('language:Python', resized), {size: 0, opacity: 0, mix: 0, local: 0})
  assert.deepEqual(motion('language:Python', added), {size: 1, opacity: 1, mix: 1, local: 1})
  for (let index = 0; index <= 1000; index++) {
    const t = index / 1000
    const python = motion('language:Python', t),
      ruby = motion('language:Ruby', t)
    if (python.opacity > 0 && python.opacity < 1) assert.equal(python.mix, 0, 'an arriving language fades in empty')
    if (ruby.opacity > 0 && ruby.opacity < 1) assert.equal(ruby.mix, 1, 'a departing language is empty before it fades')
    assert.ok(python.size >= python.opacity && ruby.size >= ruby.opacity, 'slots open before and close after the fade')
    // A resize mirrors itself about the middle of its motion.
    const mirrored = 2 * centre - t
    if (mirrored >= 0 && mirrored <= 1) {
      assert.ok(Math.abs(motion('language:TypeScript', t).mix - (1 - motion('language:TypeScript', mirrored).mix)) < 1e-9)
    }
  }
})

test('intermediate frames follow the kit ease, not a linear ramp', async () => {
  const {model} = await compared(before, after)
  const schedule = scheduleSteps(model)
  const motion = statisticsMotion(model, schedule)
  // Global progress at which a language's own step reaches local progress `local`.
  const at = (id, local) => {
    const {time, radius} = motionWindow(schedule.find(entry => entry.entities.includes(id)))
    return time + radius * (2 * local - 1)
  }
  assert.equal(ease(0.25), smootherstep(0.25), 'the kit ease is the quintic graph-layout curve')
  for (const local of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const progress = at('language:TypeScript', local)
    const eased = smootherstep(local)
    assert.ok(Math.abs(motion('language:TypeScript', progress).mix - eased) < 1e-9)
    const value = 1000 + 400 * eased
    const html = await render(progress, 1)
    const typescript = slots(html).find(slot => slot.id === 'language:TypeScript')
    // The bar, the hatched gain inside it and the count all follow the eased value.
    assert.ok(Math.abs(typescript.width - (value / 1400) * 100) < 1e-9, `TypeScript bar at local ${local}`)
    const gain = html.match(/data-statistics-id="language:TypeScript".*?class="stat-gain"[^>]* style="left:([\d.e-]+)%/u)
    assert.ok(Math.abs(Number(gain[1]) - (1000 / value) * 100) < 1e-9, `TypeScript gain at local ${local}`)
    assert.match(html, new RegExp(`aria-label="Inspect TypeScript, ${Math.round(value).toLocaleString('en-US')} lines of code`))
    // The donut's slice and its percentage use the same eased counts (CSS shrinks in the same step).
    const css = 640 - 120 * eased
    const percent = Math.round((value / (value + css + 400 + 80)) * 100)
    assert.match(
      await render(progress, 1, {controls: {chart: 'share'}}),
      new RegExp(`aria-label="TypeScript, ${Math.round(value).toLocaleString('en-US')} lines of code, ${percent} percent`),
    )
  }
  // A quarter of the way through its step the bar has covered about a tenth of its change, not a quarter.
  const quarter = slots(await render(at('language:TypeScript', 0.25), 1)).find(slot => slot.id === 'language:TypeScript')
  assert.ok(Math.abs(quarter.width - (1100 / 1400) * 100) > 3, 'clearly different from linear interpolation')
  // Arriving and departing rows open, fade and fill on the same curve, one phase after another.
  const close = (actual, expected, label) => {
    for (const key of ['size', 'opacity', 'mix']) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${label} ${key}`)
  }
  const python = local => motion('language:Python', at('language:Python', local))
  close(python(0.275), {size: smootherstep(0.5), opacity: 0, mix: 0}, 'Python opens its slot')
  close(python(0.575), {size: 1, opacity: smootherstep(0.5), mix: 0}, 'Python fades in empty')
  close(python(0.775), {size: 1, opacity: 1, mix: smootherstep(0.25)}, 'Python grows')
  const ruby = local => motion('language:Ruby', at('language:Ruby', local))
  close(ruby(0.225), {size: 1, opacity: 1, mix: smootherstep(0.75)}, 'Ruby empties')
  close(ruby(0.425), {size: 1, opacity: 1 - smootherstep(0.5), mix: 1}, 'Ruby fades out')
  close(ruby(0.725), {size: 1 - smootherstep(0.5), opacity: 0, mix: 1}, 'Ruby closes its slot')
})

test('nothing moves inside the holds between steps', async () => {
  const {model} = await compared(before, after)
  const schedule = scheduleSteps(model)
  for (const {start, end} of stepHolds(schedule)) {
    const reference = await render((start + end) / 2, 1)
    for (let index = 1; index < 10; index++) {
      assert.equal(await render(start + ((end - start) * index) / 10, 1), reference, `motion inside ${start}..${end}`)
    }
  }
})

test('a custom comparator order changes the visual order', async () => {
  const {comparison} = await compared(before, after)
  const {model} = await compared(before, after, prioritize(comparison, ['language:Python']))
  const ends = stepEnds(scheduleSteps(model))
  const first = slots(await render(ends[0], 1, {model}))
  const at = name => first.find(slot => slot.id === `language:${name}`)
  assert.equal(at('Python').opacity, 1, 'Python arrives first')
  assert.ok(at('Python').width > 0)
  assert.equal(at('Ruby').opacity, 1, 'Ruby has not left yet')
  assert.equal(at('Ruby').rows, 1)
  assert.match(await render(ends[0], 1, {model}), /aria-label="Inspect TypeScript, 1,000 lines of code, \+400"/u)
})

test('an explicit reverse order is followed when playing backward', async () => {
  const {comparison} = await compared(before, after)
  // Backward, Ruby returns first, then TypeScript and CSS shrink back, then Python leaves (the mirror is the opposite).
  const explicit = {...comparison, order: {reverse: 'explicit'}, reverseSteps: [...comparison.steps]}
  const {model} = await compared(before, after, explicit)
  const backward = scheduleSteps(model, -1)
  const ends = stepEnds(backward, -1)
  const at = (html, name) => slots(html).find(slot => slot.id === `language:${name}`)
  const leaving = await render(ends.at(-1), 1, {model, schedule: backward})
  assert.equal(at(leaving, 'Ruby').opacity, 1, 'leaving progress 1, Ruby returns first')
  assert.equal(at(leaving, 'Python').opacity, 1, 'Python has not left')
  assert.match(leaving, /aria-label="Inspect TypeScript, 1,400 lines of code/u)
  const mirror = await render(ends.at(-1), 1, {model: (await compared(before, after)).model})
  assert.equal(at(mirror, 'Python').rows, 0, 'under the mirror order Python leaves first')
  assert.equal(at(mirror, 'Ruby').rows, 0)
})

test('measure, grouping and chart are declared controls; invalid host values fall back to their defaults', () => {
  assert.deepEqual(parseControls(codeStatisticsControls), codeStatisticsControls)
  assert.deepEqual(
    codeStatisticsControls.map(control => control.id),
    ['measure', 'byLanguage', 'chart'],
  )
  const controls = codeStatisticsControlsFor(before.entities)
  assert.deepEqual(
    controls.map(control => control.id),
    ['scope', 'measure', 'byLanguage', 'chart'],
    'Files is offered when languages count tests',
  )
  assert.deepEqual(parseControls(controls), controls)
  assert.deepEqual(
    codeStatisticsControlsFor([{id: 'x', kind: 'language', label: 'X', data: {code: 1}}]).map(control => control.id),
    ['measure', 'byLanguage', 'chart'],
  )
  const values = options => codeStatisticsOptions(controlValues(controls, options))
  assert.deepEqual(values({}), {measure: 'code', chart: 'bars', byLanguage: true, scope: 'all'})
  assert.deepEqual(values({measure: 'comment', chart: 'share', byLanguage: false, scope: 'tests'}), {
    measure: 'comment',
    chart: 'share',
    byLanguage: false,
    scope: 'tests',
  })
  assert.deepEqual(values({measure: 'words', chart: 'pie', byLanguage: 'yes', scope: 'docs'}), {
    measure: 'code',
    chart: 'bars',
    byLanguage: true,
    scope: 'all',
  })
})

test('the Files control counts tests or the rest, and every language still follows its step', async () => {
  // The host's summary bar states the total in the Files scope; the view draws no header.
  assert.deepEqual(await total({scope: 'tests'}), {count: 770, change: 290, noun: 'lines of code in tests'})
  assert.deepEqual(await total({scope: 'other'}), {count: 1930, change: 170, noun: 'lines of code outside tests'})
  assert.doesNotMatch(await render(1, 0, {controls: {scope: 'tests'}}), /statistics-header|statistics-scope|<strong>/u)
  assert.match(await render(1, 0, {controls: {scope: 'tests', measure: 'files'}}), /aria-label="Inspect TypeScript, 6 files, \+2"/u)
  // A scope lists only the languages it counts something in: CSS and Shell have no tests.
  const tests = await render(1, 0, {controls: {scope: 'tests'}})
  assert.match(tests, /aria-label="Inspect Go, /u)
  assert.doesNotMatch(tests, /aria-label="Inspect (CSS|Shell), /u)
  assert.match(await render(1, 0, {controls: {scope: 'other'}}), /aria-label="Inspect CSS, /u)
  assert.match(await render(1, 0), /aria-label="Inspect Shell, /u, 'every file still lists every language')
  // Mid-transition, TypeScript's test code moves only inside its own step.
  assert.match(await render('mid', 1, {controls: {scope: 'tests'}}), /aria-label="Inspect TypeScript, 430 lines of code, \+260, Modified"/u)
})

test('helpers format signed deltas and full-turn donut slices', () => {
  assert.equal(signed(400), '+400')
  assert.equal(signed(-20), '−20')
  assert.equal(signed(0), '0')
  const whole = donutSlice(160, 120, 74, -Math.PI / 2, Math.PI * 1.5)
  assert.equal((whole.match(/ A/gu) ?? []).length, 4, 'a full turn is drawn as half-turn arcs')
  assert.equal(donutSlice(160, 120, 74, 1, 1), '')
})

/** Renders at `progress`; `mid` is the middle of TypeScript's resize, which removing Ruby's reading lead pushes past 0.5. */
async function render(progress, highlighting, overrides = {}) {
  const model = overrides.model ?? (await compared(before, after)).model
  const schedule = scheduleSteps(model)
  return renderToStaticMarkup(
    createElement(CodeStatisticsRenderer, {
      init: {},
      model,
      comparing: true,
      progress: progress === 'mid' ? motionWindow(schedule.find(step => step.entities.includes('language:TypeScript'))).time : progress,
      highlighting,
      direction: 1,
      schedule,
      rendererName: 'code-statistics',
      selectedId: null,
      onSelect: noop,
      onOpen: noop,
      reportSteps: noop,
      controls: {},
      declareControls: noop,
      get emphasis() {
        return stepEmphasis(this.schedule ?? [], this.progress, this.highlighting)
      },
      onAction: () => noop,
      options: {},
      viewport: undefined,
      reducedMotion: false,
      locale: 'en-US',
      ...overrides,
    }),
  )
}
function slots(html) {
  return [
    ...html.matchAll(
      /<div class="stat-slot[^"]*" data-statistics-id="([^"]+)" style="grid-template-rows:([\d.e-]+)fr;opacity:([\d.e-]+)"[^>]*>.*?class="stat-bar[^"]*" data-projections-category="[^"]+" style="width:([\d.e-]+)%;background:([^"]+)"/gu,
    ),
  ].map(([, id, rows, opacity, width, colour]) => ({id, rows: Number(rows), opacity: Number(opacity), width: Number(width), colour}))
}

test('endpoints are neutral and the midpoint interpolates every count', async () => {
  for (const progress of [0, 1]) {
    assert.doesNotMatch(await render(progress, 0), /stat-gain|stat-loss|stat-delta-label|class="badge|pk-status-text/u)
  }
  assert.deepEqual(await total(), {count: 2700, change: 460, noun: 'lines of code'})
  assert.doesNotMatch(await render(1, 0), /<strong>/u, "the total is the host's summary bar's")
  const mid = await render('mid', 1)
  assert.match(mid, /aria-label="Inspect Go, 400 lines of code"/u)
  assert.match(mid, /stat-gain/u)
  assert.match(mid, /stat-loss/u)
  // Every row reserves its status cell; changed languages state their status as icon and word.
  const rows = [...mid.matchAll(/class="stat-row/gu)].length
  assert.equal([...mid.matchAll(/class="pk-change-status stat-status"/gu)].length, rows)
  assert.match(
    mid,
    /data-change-status="modified"><span class="pk-icon" data-icon="modified" aria-hidden="true"><\/span><span class="pk-label">Modified<\/span>/u,
  )
  assert.match(mid, /aria-label="Inspect TypeScript, 1,200 lines of code, \+400, Modified"/u)
  const legend = await render('mid', 1, {controls: {chart: 'share'}})
  assert.equal(
    [...legend.matchAll(/class="pk-change-status stat-status"/gu)].length,
    [...legend.matchAll(/class="stat-values-row"/gu)].length,
  )
  assert.match(legend, /data-change-status="modified"/u)
  assert.match(await render('mid', 1, {controls: {measure: 'files'}}), /aria-label="Inspect TypeScript, 13 files, \+2, Modified"/u)
  assert.match(await render('mid', 1, {locale: 'de-DE'}), /aria-label="Inspect TypeScript, 1\.200 lines of code, \+400, Modified"/u)
})

test('languages enter and leave without mounting, unmounting or changing colour', async () => {
  const frames = []
  for (let step = 0; step <= 40; step++) frames.push(slots(await render(step / 40, 1)))
  const ids = frames.map(frame => frame.map(slot => slot.id).join('|'))
  assert.equal(new Set(ids).size, 1, 'the same rows, in the same order, at every frame')
  const at = (frame, name) => frame.find(slot => slot.id === `language:${name}`)
  for (const slot of frames[0]) assert.equal(at(frames.at(-1), slot.id.slice(9)).colour, slot.colour)
  for (const frame of frames) {
    for (const name of ['Python', 'Ruby']) {
      if (at(frame, name).opacity > 0 && at(frame, name).opacity < 1) assert.equal(at(frame, name).width, 0)
    }
  }
  assert.equal(at(slots(await render(1, 0)), 'Ruby').rows, 0)
  assert.equal(at(slots(await render(0, 0)), 'Python').rows, 0)
})

test('languages take their GitHub Linguist colors, the same as file packing, in each theme', async () => {
  const light = slots(await render(1, 0, {colorMode: 'light'}))
  const dark = slots(await render(1, 0, {colorMode: 'dark'}))
  const colour = (frame, name) => frame.find(slot => slot.id === `language:${name}`)?.colour
  assert.equal(colour(light, 'TypeScript'), languageColor(languageNamed('TypeScript'), 'light'))
  assert.equal(colour(light, 'Python'), categoryPalette([{category: languageCategory('Python'), weight: 1}], 'light').paintOf('Python'))
  assert.equal(colour(dark, 'Ruby'), categoryPalette([{category: languageCategory('Ruby'), weight: 1}], 'dark').paintOf('Ruby'))
  assert.notEqual(colour(light, 'Ruby'), colour(dark, 'Ruby'), 'dark-on-dark Ruby is lightened for the dark theme')
})

test('composition, share and host-controlled options render; a single revision is neutral', async () => {
  const composition = await render('mid', 1, {controls: {byLanguage: false}})
  assert.match(composition, /Every physical line counts once/u)
  assert.doesNotMatch(composition, /aria-label="Measure"/u)
  assert.doesNotMatch(composition, /aria-label="Grouping"/u)
  const share = await render('mid', 1, {controls: {chart: 'share'}})
  assert.match(share, /aria-label="Share of lines of code by language"/u)
  assert.match(share, /aria-label="TypeScript, 1,200 lines of code, \d+ percent, \+400, Modified"/u)
  // The host draws the controls; the frame draws none.
  const local = await render(1, 0)
  assert.doesNotMatch(local, /aria-label="(Measure|Chart|Grouping)"|<select|aria-pressed="(true|false)">(Bars|Share)/u)
  const {model} = await compared(before, after)
  const single = await render(1, 0, {model: extractionModel(after), comparing: false})
  assert.match(single, /data-diff-highlighting="false"/u)
  assert.doesNotMatch(single, /stat-gain|stat-loss|class="badge/u)
  assert.equal(model.entities.length, 6)
})

test('a dozen-language migration keeps every row through the transition and ends neutral', async () => {
  const gateway = loadPair('gateway')
  const {model} = await compared(gateway.before, gateway.after)
  const frames = []
  for (let step = 0; step <= 40; step++) frames.push(slots(await render(step / 40, step % 40 ? 1 : 0, {model})))
  assert.equal(new Set(frames.map(frame => frame.map(slot => slot.id).join('|'))).size, 1)
  assert.equal(frames[0].length, 12)
  for (const slot of frames[0]) assert.equal(frames.at(-1).find(other => other.id === slot.id).colour, slot.colour)
  const html = await render(1, 0, {model})
  assert.doesNotMatch(html, /stat-gain|stat-loss|stat-delta-label|class="badge/u)
  const sum = extraction => extraction.entities.reduce((lines, entity) => lines + entity.data.code, 0)
  assert.deepEqual(await total({}, model), {
    count: sum(gateway.after),
    change: sum(gateway.after) - sum(gateway.before),
    noun: 'lines of code',
  })
})

test('generic measurements draw each entity’s data.value in its unit, with only the chart control', async () => {
  const pair = loadPair('scopes')
  const {model} = await compared(pair.before, pair.after)
  const entities = model.entities.flatMap(row => [row.before, row.after])
  assert.deepEqual(
    codeStatisticsControlsFor(entities).map(control => control.id),
    ['chart'],
    'one value per row: no measure, grouping or files',
  )
  const end = await render(1, 0, {model})
  assert.match(end, /aria-label="methods by scope"/u)
  assert.match(end, /aria-label="Inspect projects:read, 17 methods/u)
  assert.doesNotMatch(end, /lines of code/u)
  const [fact] = codeStatisticsFacts({init: {mode: 'comparison'}, model, controls: {}, rendererName: 'code-statistics'})
  assert.deepEqual(
    {count: fact.count, added: fact.added, noun: fact.noun},
    {count: 46, added: 3, noun: {singular: 'method', plural: 'methods'}},
    'the summary bar totals the shared unit',
  )
  const mixed = structuredClone(pair.after)
  mixed.entities[0].data.unit = 'ms'
  assert.deepEqual(
    codeStatisticsFacts({init: {mode: 'extraction'}, model: extractionModel(mixed), controls: {}, rendererName: 'code-statistics'}),
    [],
    'rows in different units state no total',
  )
  // Line counts keep the language view, whatever the value field says.
  assert.ok(codeStatisticsControlsFor([before]).some(control => control.id === 'measure'))
})
