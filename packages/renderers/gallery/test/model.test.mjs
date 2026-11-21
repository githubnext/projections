import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {comparisonModel} from '@githubnext/projections-renderer-kit'
import {createNativeEngine} from '@githubnext/projections-engine/native'
import {nestedMode, nestedPresentation, scenarioOf, subjectWords} from '../node_modules/.cache/test/model.js'
import {sections} from '../node_modules/.cache/test/view.js'

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
const before = fixture('gallery-before')
const after = fixture('gallery-after')
const environment = {theme: {colorMode: 'dark', tokens: {}}, reducedMotion: false, locale: 'en-US', pane: 'after'}
const entity = (extraction, id) => extraction.entities.find(item => item.id.endsWith(id))

test('a scenario entity reads as its renderer and subject', () => {
  const split = scenarioOf(entity(before, ':payments-split'))
  assert.equal(split.renderer, 'graph')
  assert.equal(split.subject.mode, 'comparison')
  assert.equal(split.comparator, 'default')
  assert.equal(subjectWords(split), '6 changes', 'entities and relationships')
  const pipeline = scenarioOf(entity(before, ':release-pipeline'))
  assert.equal(pipeline.renderer, 'dag', 'a name the graph bundle handles')
  assert.equal(pipeline.group, 'Pipelines')
  assert.equal(subjectWords(scenarioOf(entity(before, ':banner'))), 'One revision')
  const cards = scenarioOf(entity(after, ':cards'))
  assert.equal(cards.bundle, 'cards/dist')
  assert.equal(scenarioOf({id: 'x', kind: 'scenario', label: 'X', data: {mode: 'comparison'}}).subject, undefined)
  // A comparison a renderer can't read is no subject, so the card says so rather than the gallery failing.
  const {data} = entity(before, ':payments-split')
  for (const comparison of [{}, {changes: [], steps: [null]}, {changes: [{id: 'a'}], steps: []}]) {
    const broken = scenarioOf({id: 'x', kind: 'scenario', label: 'X', data: {...data, comparison}})
    assert.equal(broken.subject, undefined, JSON.stringify(comparison))
    assert.equal(subjectWords(broken), 'No subject')
  }
})

test('a nested renderer is given its scenario, in diff when it can, else animated at rest on after', () => {
  const split = scenarioOf(entity(before, ':payments-split'))
  const diff = nestedPresentation('s', 'Split', split, environment, {
    changeHighlighting: 'supported',
    comparisonModes: ['diff', 'animated'],
  })
  assert.equal(diff.init.comparisonMode, 'diff')
  assert.equal(diff.progress, undefined)
  assert.equal(diff.init.sizing, 'fill')
  assert.equal(diff.init.pane, undefined, "the gallery's held pane is not the scenario's")
  assert.deepEqual(diff.init.projection, {id: 's', title: 'Split', renderer: 'graph'})
  const animated = nestedPresentation('s', 'Split', split, environment, {changeHighlighting: 'supported'})
  assert.equal(animated.init.comparisonMode, 'animated')
  assert.deepEqual(animated.progress, {progress: 1, highlighting: 1, direction: 1})
  assert.equal(nestedMode({changeHighlighting: 'none', comparisonModes: ['diff', 'animated']}, 'animated'), 'animated')
  assert.equal(nestedMode({changeHighlighting: 'none', comparisonModes: ['side-by-side']}), 'animated')
  const one = nestedPresentation('b', 'Banner', scenarioOf(entity(before, ':banner')), environment, {changeHighlighting: 'none'})
  assert.equal(one.init.mode, 'extraction')
  // The scenario's kind presentation reaches its renderer as a definition's does.
  const kinds = {secret: {color: 'danger', noun: {singular: 'secret key', plural: 'secret keys'}}}
  const colored = nestedPresentation('s', 'Split', {...split, presentation: {kinds}}, environment, {changeHighlighting: 'supported'})
  assert.deepEqual(colored.init.projection, {id: 's', title: 'Split', renderer: 'graph', kinds})
})

test("sections keep each document's order, a removed scenario after the one it followed, in runs by group", async () => {
  const model = comparisonModel(before, after, await createNativeEngine().compare(before, after))
  const titles = sections(model).map(section => [
    (section.document.after ?? section.document.before).label,
    section.runs.map(run => [run.group ?? null, run.rows.map(row => (row.after ?? row.before).label)]),
  ])
  assert.deepEqual(titles, [
    ['Package cards', [[null, ['Packages as cards']]]],
    [
      'Graph',
      [
        [null, ['A small shop', 'Payments split out']],
        ['Pipelines', ['Release pipeline']],
      ],
    ],
    ['Text diff', [[null, ['Status output', 'One banner']]]],
  ])
})

test('nested renderers load a few at a time, each freeing its slot once', async () => {
  const {loadQueue} = await import('../node_modules/.cache/test/stage.js')
  const queue = loadQueue(2)
  const started = []
  const slots = [0, 1, 2, 3].map(index =>
    queue.acquire().then(free => {
      started.push(index)
      return free
    }),
  )
  await new Promise(setImmediate)
  assert.deepEqual(started, [0, 1])
  const first = await slots[0]
  first()
  first()
  await new Promise(setImmediate)
  assert.deepEqual(started, [0, 1, 2], 'freeing twice frees one slot')
  ;(await slots[1])()
  await new Promise(setImmediate)
  assert.deepEqual(started, [0, 1, 2, 3])
})

test('a content-sized frame of a large gallery draws its first scenario sets, by order alone', async () => {
  const {contentDrawn} = await import('../node_modules/.cache/test/view.js')
  const model = comparisonModel(before, after, await createNativeEngine().compare(before, after))
  const drawn = contentDrawn(sections(model))
  const labels = [...drawn].map(id => {
    const row = model.entities.find(item => item.id === id)
    return (row.after ?? row.before).label
  })
  // The first two sets as laid out (cards, then graph); text diff's scenarios are named, not drawn.
  assert.deepEqual(labels, ['Packages as cards', 'A small shop', 'Payments split out', 'Release pipeline'])
})
