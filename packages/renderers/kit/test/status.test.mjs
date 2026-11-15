import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {svgStatusWidth} from '../dist/index.js'
import {SvgChangeStatus} from '../dist/react.js'

const status = props => renderToStaticMarkup(createElement('svg', null, createElement(SvgChangeStatus, {emphasis: 1, y: 30, ...props})))
const words = markup => [...markup.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(match => match[1])
const textX = markup => [...markup.matchAll(/<text x="([-\d.]+)"/g)].map(match => Number(match[1]))
const upgrade = [{status: 'modified', glyph: '↑', icon: 'upgraded', label: 'Minor upgrade'}]

test("a card's status centres its icon and word together on the band's middle", () => {
  // Outside a browser words are estimated (6.5 a character): an icon (12), its gap (2.5) and the word, centred on x.
  const total = svgStatusWidth(upgrade)
  const centred = status({change: {status: 'modified'}, parts: upgrade, x: 0, anchor: 'middle', room: 168})
  assert.deepEqual(words(centred), ['Minor upgrade'])
  assert.equal(textX(centred)[0], -total / 2 + 12 + 2.5)
  // Two parts stay one centred line.
  const two = [{status: 'renamed', glyph: '→', icon: 'moved', label: 'Moved'}, ...upgrade]
  const both = status({change: {status: 'modified', renamed: true}, parts: two, x: 100, anchor: 'middle', room: 400})
  assert.equal(textX(both)[0], 100 - svgStatusWidth(two) / 2 + 14.5)
  // The default still starts at x.
  assert.equal(textX(status({change: {status: 'added'}, x: 16}))[0], 16 + 14.5)
})

test('a status wider than its band ends in an ellipsis, whole in its tooltip', () => {
  const room = 12 + 2.5 + 6 * 6.5
  const cut = status({change: {status: 'modified'}, parts: upgrade, x: 0, anchor: 'middle', room})
  const [word] = words(cut)
  assert.ok(word.endsWith('…') && 'Minor upgrade'.startsWith(word.slice(0, -1).trimEnd()), word)
  assert.ok(12 + 2.5 + word.length * 6.5 <= room, `${word} fits ${room}`)
  assert.match(cut, /<title>Minor upgrade<\/title>/)
  // A later part goes before an earlier one is cut.
  const two = [{status: 'renamed', glyph: '→', icon: 'moved', label: 'Moved'}, ...upgrade]
  const first = status({
    change: {status: 'modified', renamed: true},
    parts: two,
    x: 0,
    anchor: 'middle',
    room: 12 + 2.5 + 5 * 6.5 + 10 + 12 + 2.5 + 2 * 6.5,
  })
  assert.deepEqual(words(first)[0], 'Moved')
  assert.ok(words(first)[1].endsWith('…'))
  // Whole words carry no tooltip of their own.
  assert.doesNotMatch(status({change: {status: 'added'}, x: 0, anchor: 'middle', room: 200}), /<title>/)
})

test('a held pane of side by side or swipe emphasizes every change it shows by the host highlighting, unscheduled', async () => {
  const {stepEmphasis} = await import('../dist/index.js')
  const schedule = [{id: 's', entities: ['gone', 'new'], relationships: [], time: 0.5, radius: 0.2, hold: 0.1, travel: 1}]
  const gone = {id: 'gone', status: 'removed'}
  const fresh = {id: 'new', status: 'added'}
  // Animated: at either endpoint a step's change shows no emphasis before (or after) its window.
  assert.equal(stepEmphasis(schedule, 0, 1)(gone), 0)
  // Side by side: Before marks its removals and After its additions, as the host's highlighting says.
  assert.equal(stepEmphasis(schedule, 0, 1, 'before')(gone), 1)
  assert.equal(stepEmphasis(schedule, 1, 1, 'after')(fresh), 1)
  assert.equal(stepEmphasis(schedule, 0, 0, 'before')(gone), 0)
})
