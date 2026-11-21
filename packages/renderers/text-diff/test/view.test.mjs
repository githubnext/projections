import {test} from 'node:test'
import {stepEmphasis, comparisonModel, extractionModel} from '@githubnext/projections-renderer-kit'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createNativeEngine} from '@githubnext/projections-engine/native'
import {outputDiff, wordDiff} from '../node_modules/.cache/test/rows.js'
import {readOutput, validateModel} from '../node_modules/.cache/test/model.js'
import {segments} from '../node_modules/.cache/test/folding.js'
import {outputOrder, TextDiffView} from '../node_modules/.cache/test/view.js'
import {plain} from '../../kit/test/markup.mjs'

const noop = () => undefined

const engine = createNativeEngine()
const graph = entities => ({protocolVersion: 0, schema: 'graph/v0', entities, relationships: []})
const output = (id, text, presentation) => ({id, kind: 'output', label: id, data: {text, ...(presentation ? {presentation} : {})}})

const before = graph([
  output('report', 'Total: 3\nPKG-1  Boston\nPKG-2  Dallas\n'),
  output('help', 'usage: tool\n'),
  output('gone', 'bye\n'),
])
const after = graph([
  output('report', 'Total: 4\nPKG-1  Boston\nPKG-2  Dallas\nPKG-3  <script>x</script>\n'),
  output('help', 'usage: tool\n'),
  output('new', 'hi\n', 'prose'),
])

async function comparison(a = before, b = after) {
  return {model: comparisonModel(a, b, await engine.compare(a, b))}
}
const props = (model, progress, {comparing = true, highlighting = 1, schedule = [], options = {}} = {}) => ({
  init: {},
  model,
  comparing,
  diff: comparing,
  comparisonMode: comparing ? 'diff' : undefined,
  progress,
  highlighting,
  direction: 1,
  schedule,
  rendererName: 'text-diff',
  selectedId: null,
  onSelect: noop,
  onOpen: noop,
  reportSteps: noop,
  controls: options,
  declareControls: noop,
  get emphasis() {
    return stepEmphasis(this.schedule ?? [], this.progress, this.highlighting)
  },
  onAction: () => noop,
  options,
  viewport: undefined,
  reducedMotion: false,
  locale: 'en',
})
const render = p => renderToStaticMarkup(createElement(TextDiffView, p))

test('split rows pair changed lines and mark line-ending-only changes', () => {
  const diff = outputDiff('a\nb\nc\n', 'a\nB\nc\nd')
  assert.deepEqual(
    diff.split.map(row => [row.left?.text ?? '·', row.right?.text ?? '·']),
    [
      ['a', 'a'],
      ['b', 'B'],
      ['c', 'c'],
      ['·', 'd'],
    ],
  )
  const endings = outputDiff('a\r\nb\r\n', 'a\nb\n')
  assert.deepEqual(
    endings.unified.map(row => `${row.kind}:${row.text}:${row.ending}`),
    ['delete:a:CRLF', 'delete:b:CRLF', 'insert:a:LF', 'insert:b:LF'],
  )
  assert.deepEqual(
    outputDiff('x', 'x\n').unified.map(row => row.ending),
    ['no newline at end', 'LF'],
  )
})

test('changed lines pair their changed words; wholesale rewrites and terminator-only changes are not split into words', () => {
  const diff = outputDiff('Total: 3 late\n', 'Total: 4 late\n')
  const [old, next] = diff.unified
  assert.deepEqual(old.words, [
    {text: 'Total: ', changed: false},
    {text: '3', changed: true},
    {text: ' late', changed: false},
  ])
  assert.deepEqual(next.words, [
    {text: 'Total: ', changed: false},
    {text: '4', changed: true},
    {text: ' late', changed: false},
  ])
  assert.deepEqual(diff.split[0].left.words, old.words)
  assert.equal(wordDiff('alpha beta gamma', 'one two three'), undefined)
  assert.equal(wordDiff('same', 'same'), undefined)
})

test('long unchanged runs fold into gaps around each change, and an opened gap shows its lines', () => {
  const changed = [
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ]
  assert.deepEqual(segments(changed), [
    {kind: 'gap', start: 0, end: 5},
    {kind: 'rows', start: 5, end: 12},
    {kind: 'gap', start: 12, end: 18},
  ])
  // An opened gap keeps its fold before its rows, to fold them again.
  assert.deepEqual(segments(changed, 3, new Set([0])), [
    {kind: 'open', start: 0, end: 5},
    {kind: 'rows', start: 0, end: 12},
    {kind: 'gap', start: 12, end: 18},
  ])
  // A gap never hides a single line.
  assert.deepEqual(segments([false, false, false, false, true]), [{kind: 'rows', start: 0, end: 5}])
  assert.deepEqual(segments([]), [])
})

test('an extraction and the unchanged outputs of a comparison are plain numbered text', async () => {
  const markup = render(props(extractionModel(after), 1, {comparing: false}))
  assert.ok(!/class="badge|pk-change-status|td-mark|td-delete|td-insert|td-filler|Removed: |Added: /.test(markup))
  const {model} = await comparison()
  const diff = render(props(model, 1))
  const section = (html, id) => html.match(new RegExp(`<section[^>]*data-entity-id="${id}".*?</section>`))?.[0]
  const reserved = '<span class="pk-change-status pk-group-status" data-change-footer=""></span>'
  // The unchanged output reads exactly as in the extraction alone, with its status cell reserved and empty.
  assert.ok(section(diff, 'help').includes(reserved))
  assert.equal(section(diff, 'help').replace(reserved, ''), section(markup, 'help'))
})

test('the diff shows every output with both line sets, marked and spoken, and text is never HTML', async () => {
  const {model} = await comparison()
  for (const layout of ['split', 'unified']) {
    const markup = render(props(model, 1, {options: {textDiffLayout: layout}}))
    assert.match(markup, new RegExp(`data-layout="${layout}"`))
    for (const id of ['report', 'help', 'gone', 'new']) assert.match(markup, new RegExp(`data-entity-id="${id}"`))
    assert.ok(markup.includes('Total: ') && markup.includes('>3<') && markup.includes('>4<'))
    assert.match(markup, /Removed: <\/span><span class="td-text">Total: <span class="td-word">3<\/span>/)
    assert.match(markup, /Added: <\/span><span class="td-text">Total: <span class="td-word">4<\/span>/)
    assert.match(markup, /Removed: <\/span><span class="td-text">bye/)
    assert.match(markup, /Added: <\/span><span class="td-text">hi/)
    assert.match(markup, /class="td-mark"[^>]*>−</)
    assert.ok(markup.includes('&lt;script&gt;x&lt;/script&gt;') && !markup.includes('<script>'))
    assert.ok(!markup.includes('aria-label="Text diff layout"'), 'the layout control is host-drawn')
  }
  const split = render(props(model, 1))
  assert.match(split, /data-layout="split"/)
  assert.match(split, /td-caption td-side-before">Before</)
  // A line on one side faces a blank filler, so unchanged lines stay aligned.
  assert.match(split, /td-cell td-filler td-side-before/)
})

test('without highlighting the diff keeps its content and status cells, and drops only the tint and status words', async () => {
  const {model} = await comparison()
  const strip = markup =>
    markup.replace(/--emphasis:[^;"]*;?/g, '').replace(/<span class="pk-status-text".*?<\/span><\/span>(?=<\/span><\/header>)/g, '')
  const on = render(props(model, 1, {highlighting: 1}))
  const off = render(props(model, 1, {highlighting: 0}))
  assert.match(on, /--emphasis:1/)
  assert.match(off, /--emphasis:0/)
  assert.doesNotMatch(off, /pk-status-text/)
  assert.equal(strip(off), strip(on))
})

test("each changed output states its status as text in a reserved cell at its header's end", async () => {
  const {model} = await comparison()
  const markup = render(props(model, 1))
  const status = id =>
    plain(
      markup.match(
        new RegExp(
          `<section[^>]*data-entity-id="${id}"[^>]*><header class="pk-group-header">.*?<span class="pk-change-status pk-group-status"[^>]*>(.*?)</span></header>`,
        ),
      )[1],
    )
  assert.deepEqual(['report', 'gone', 'new', 'help'].map(status), ['Modified', 'Removed', 'Added', ''])
  assert.match(markup, /--pk-status-width:11ch/)
})

test("a formatted output's command label is a code identifier heading before its status cell; a prose title is not", async () => {
  const {model} = await comparison()
  const markup = render(props(model, 1))
  const header = id =>
    markup.match(new RegExp(`<section[^>]*data-entity-id="${id}"[^>]*><header class="pk-group-header">(.*?)</header>`))[1]
  assert.match(
    header('report'),
    /^<h2 class="pk-group-title" id="[^"]+"><button type="button" class="pk-group-label pk-truncate pk-diff-text" data-projections-identifier="" title="report" aria-pressed="false">report<\/button><\/h2><span class="pk-change-status pk-group-status" data-change-footer=""><span class="pk-status-text"[^>]*><span class="pk-status-part modified"/,
  )
  assert.match(header('new'), /title="new"/)
  assert.doesNotMatch(header('new'), /data-projections-identifier/)
})

test('a removed output is marked removed, so its title is struck through; an unchanged one is not marked', async () => {
  const {model} = await comparison()
  const markup = render(props(model, 1))
  const open = id => markup.match(new RegExp(`<section[^>]*data-entity-id="${id}"[^>]*>`))[0]
  assert.match(open('gone'), /data-change="removed"/)
  assert.match(open('new'), /data-change="added"/)
  assert.match(open('report'), /data-change="modified"/)
  assert.doesNotMatch(open('help'), /data-change/)
  // The output's section is labelled by its heading.
  const labelled = open('gone').match(/aria-labelledby="([^"]+)"/)[1]
  assert.match(markup, new RegExp(`<h2 class="pk-group-title" id="${labelled}"><button[^>]*>gone</button>`))
  // A single extraction draws no status and no marks.
  const single = render(props(extractionModel(before), 1, {comparing: false}))
  assert.doesNotMatch(single, /data-change|pk-group-status/)
})

test('outputs keep extraction order, with removals where they were', async () => {
  const {model} = await comparison()
  assert.deepEqual(
    outputOrder(model).map(row => row.id),
    ['report', 'help', 'gone', 'new'],
  )
  assert.deepEqual(
    outputOrder(extractionModel(before)).map(row => row.id),
    ['report', 'help', 'gone'],
  )
})

test('invalid output data fails with a clear error', async () => {
  const bad = [
    [graph([{id: 'o', kind: 'output', label: 'o', data: {text: 42}}]), /must contain string data\.text/],
    [graph([output('o', 'x', 'markdown')]), /invalid data\.presentation/],
    [graph([{id: 'o', kind: 'note', label: 'o', data: {text: 'x'}}]), /must have kind "output"/],
    [
      {...graph([output('a', 'x'), output('b', 'y')]), relationships: [{id: 'r', kind: 'calls', from: 'a', to: 'b'}]},
      /does not support relationships/,
    ],
    [{...graph([output('o', 'x')]), schema: 'dag/v0'}, /requires graph\/v0/],
  ]
  for (const [extraction, message] of bad) {
    assert.throws(() => validateModel(extractionModel(extraction)), message)
    assert.throws(() => render(props(extractionModel(extraction), 1, {comparing: false})), message)
  }
  assert.deepEqual(readOutput(output('o', '')), {id: 'o', label: 'o', text: '', presentation: 'formatted'})
  assert.match(render(props(extractionModel(graph([output('o', '')])), 1, {comparing: false})), /\(no output\)/)
})
