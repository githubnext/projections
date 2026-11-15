// Unit tests of `develop-model.ts`: the bookmarks the Viewing view writes and removes, the progress of checking recent
// commits, and the renderers' scenarios; loaded from source with Node's type stripping.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {addBookmark, removeBookmark, parseScenarios, scenariosFor, sweepProgress} from '../src/develop-model.ts'

const a = 'a'.repeat(40)
const b = 'b'.repeat(40)

test('bookmarks are added to the file projections reads', () => {
  const first = addBookmark(undefined, {projectionId: 'packages', before: a, after: b, title: 'Auth arrives'})
  assert.equal(first.id, 'packages-bbbbbbbb')
  assert.deepEqual(JSON.parse(first.text), {
    format: 'projections.bookmarks',
    version: 0,
    bookmarks: [{id: 'packages-bbbbbbbb', title: 'Auth arrives', projectionId: 'packages', before: a, after: b}],
  })
  // A second of the same pair gets its own ID; the file's others are kept, sorted by ID.
  const second = addBookmark(first.text, {projectionId: 'packages', before: a, after: b, title: ''})
  assert.equal(second.id, 'packages-bbbbbbbb-2')
  assert.deepEqual(
    JSON.parse(second.text).bookmarks.map(item => [item.id, item.title]),
    [
      ['packages-bbbbbbbb', 'Auth arrives'],
      ['packages-bbbbbbbb-2', 'packages-bbbbbbbb-2'],
    ],
  )
  assert.throws(() => addBookmark('{"format": "other"}', {projectionId: 'p', before: a, after: b, title: 't'}), /not a bookmarks file/)
})

test('bookmark writes keep the file’s indentation, else indent by two spaces', () => {
  const four = `${JSON.stringify({format: 'projections.bookmarks', version: 0, bookmarks: []}, null, 4)}\n`
  const added = addBookmark(four, {projectionId: 'p', before: 'v1', after: 'main', title: 'Since v1'})
  assert.equal(added.text, `${JSON.stringify(JSON.parse(added.text), null, 4)}\n`)
  assert.match(added.text, /^ {4}"bookmarks": \[\n {8}\{\n {12}"id": "p-main",$/m)
  const tabs = removeBookmark(added.text.replaceAll('    ', '\t'), 'p-main')
  assert.equal(tabs, '{\n\t"format": "projections.bookmarks",\n\t"version": 0,\n\t"bookmarks": []\n}\n')
  const minified = addBookmark('{"format":"projections.bookmarks","version":0,"bookmarks":[]}', {
    projectionId: 'p',
    before: 'v1',
    after: 'main',
    title: 't',
  })
  assert.equal(minified.text, `${JSON.stringify(JSON.parse(minified.text), null, 2)}\n`)
})

test('the sweep’s progress', () => {
  assert.equal(sweepProgress(undefined), '')
  assert.equal(sweepProgress({status: 'running', changes: [1, 2, 3], cells: [1]}), 'Checking recent commits… 1 of 3')
  assert.equal(sweepProgress({status: 'running', changes: [], cells: []}), 'Checking recent commits… 0 of …')
  // Over several projections, a cell per change and projection.
  assert.equal(sweepProgress({status: 'running', changes: [1, 2, 3], cells: [1, 2]}, 2), 'Checking recent commits… 2 of 6')
  assert.equal(sweepProgress({status: 'cancelled', changes: [1], cells: []}), 'Checking recent commits cancelled')
  assert.equal(sweepProgress({status: 'completed', changes: [1], cells: [1]}), '')
})

test("a scenarios.json is read for its title, renderer and scenarios, and matched to a projection's renderer", () => {
  const text = JSON.stringify({
    format: 'projections.scenarios',
    version: 0,
    title: 'API',
    renderer: 'api',
    scenarios: [{id: 'one', title: 'One'}, {id: 'two'}, {}],
  })
  assert.deepEqual(parseScenarios(text), {
    title: 'API',
    renderer: 'api',
    scenarios: [
      {id: 'one', title: 'One'},
      {id: 'two', title: 'two'},
    ],
  })
  assert.equal(parseScenarios('{"format":"other"}'), undefined)
  assert.equal(parseScenarios('not json'), undefined)
  // A built-in renderer by name; a custom bundle by the package holding it.
  assert.equal(scenariosFor({directory: 'packages/renderers/api', renderer: 'api'}, {label: 'api'}), true)
  assert.equal(scenariosFor({directory: 'packages/renderers/api', renderer: 'api'}, {label: 'graph'}), false)
  assert.equal(scenariosFor({directory: 'tools/cards'}, {label: 'tools/cards/dist', bundle: './tools/cards/dist'}), true)
  assert.equal(scenariosFor({directory: 'tools/other'}, {label: 'tools/cards/dist', bundle: 'tools/cards/dist'}), false)
})

test('a bookmark is removed from the file by its id', () => {
  const {text, id} = addBookmark(undefined, {projectionId: 'packages', before: 'v1.0', after: 'main', title: 'Since v1.0'})
  const removed = JSON.parse(removeBookmark(text, id))
  assert.deepEqual(removed, {format: 'projections.bookmarks', version: 0, bookmarks: []})
  assert.throws(() => removeBookmark('{"format":"other"}', id))
})
