import {test} from 'node:test'
import assert from 'node:assert/strict'
import {balancedWrap, greedyWrap} from '../dist/index.js'

const topHeavy = widths => widths.every((width, index) => index === 0 || widths[index - 1] >= width)
const order = lines => lines.flat()

test('a row that fits stays one line', () => {
  const wrap = balancedWrap([40, 50, 60], 8, 500)
  assert.deepEqual(wrap.lines, [[0, 1, 2]])
  assert.deepEqual(wrap.widths, [166])
})

test('two lines balance instead of leaving orphans, the top line never shorter', () => {
  // Greedy at 600 takes eleven 50s and leaves two orphans; balanced keeps two lines, seven over six.
  const widths = Array(13).fill(50)
  assert.deepEqual(
    greedyWrap(widths, 4, 600).map(line => line.length),
    [11, 2],
  )
  const wrap = balancedWrap(widths, 4, 600)
  assert.deepEqual(
    wrap.lines.map(line => line.length),
    [7, 6],
  )
  assert.ok(topHeavy(wrap.widths))
  assert.deepEqual(
    order(wrap.lines),
    widths.map((_, index) => index),
  )
})

test('three lines stay three, top-heavy and as even as greedy order allows', () => {
  const widths = [110, 100, 105, 95, 100, 90, 95, 100, 90, 85, 95, 80]
  const greedy = greedyWrap(widths, 8, 560)
  assert.deepEqual(
    greedy.map(line => line.length),
    [5, 5, 2],
  )
  const wrap = balancedWrap(widths, 8, 560)
  assert.equal(wrap.lines.length, greedy.length)
  assert.equal(wrap.lines.length, 3)
  assert.ok(topHeavy(wrap.widths), `top-heavy: ${wrap.widths}`)
  assert.ok(
    Math.max(...wrap.widths) <=
      Math.max(...greedy.map(line => line.reduce((sum, index) => sum + widths[index], 0) + 8 * (line.length - 1))),
  )
  assert.deepEqual(
    wrap.lines.map(line => line.length),
    [4, 4, 4],
  )
  assert.deepEqual(
    order(wrap.lines),
    widths.map((_, index) => index),
  )
})

test('a single item wider than the room gets a line of its own', () => {
  const wrap = balancedWrap([40, 900, 40], 8, 300)
  assert.deepEqual(wrap.lines, [[0], [1], [2]])
  const alone = balancedWrap([900], 8, 300)
  assert.deepEqual(alone.lines, [[0]])
})

test('when greedy order forces a longer later line, a top-heavy break set wins if one exists, else the narrowest', () => {
  // Every top-heavy break set into the same number of lines, by brute force, to compare against.
  const lineWidths = (widths, gap, lines) =>
    lines.map(line => line.reduce((sum, index) => sum + widths[index], 0) + gap * (line.length - 1))
  const splits = (n, count, start = 0) =>
    count === 1
      ? [[Array.from({length: n - start}, (_, index) => start + index)]]
      : Array.from({length: n - start - count + 1}, (_, offset) => start + offset + 1).flatMap(end =>
          splits(n, count - 1, end).map(rest => [Array.from({length: end - start}, (_, index) => start + index), ...rest]),
        )
  let checked = 0
  for (let seed = 1; seed < 400; seed++) {
    let state = seed
    const random = () => (state = (state * 48271) % 2147483647) / 2147483647
    const widths = Array.from({length: 4 + (seed % 6)}, () => Math.round(20 + random() * 160))
    const room = Math.max(...widths) + Math.round(random() * 300)
    const wrap = balancedWrap(widths, 8, room)
    assert.deepEqual(
      order(wrap.lines),
      widths.map((_, index) => index),
    )
    const fitting = splits(widths.length, wrap.lines.length).filter(lines =>
      lineWidths(widths, 8, lines).every((width, index) => width <= room || lines[index].length === 1),
    )
    const heavy = fitting.filter(lines => topHeavy(lineWidths(widths, 8, lines)))
    if (heavy.length) {
      assert.ok(topHeavy(wrap.widths), `seed ${seed}: ${widths} in ${room} gave ${wrap.widths}`)
      const narrowest = Math.min(...heavy.map(lines => Math.max(...lineWidths(widths, 8, lines))))
      assert.ok(Math.max(...wrap.widths) <= narrowest + 1e-6, `seed ${seed}: widest line ${Math.max(...wrap.widths)} > ${narrowest}`)
      checked++
    }
  }
  assert.ok(checked > 100)
  // [30, 30, 30, 200] can't be top-heavy in two lines: the narrowest break set is used.
  assert.deepEqual(balancedWrap([30, 30, 30, 200], 10, 260).widths, [110, 200])
})

test('narrowing the room adds a line only when the items no longer fit, and the result stays balanced', () => {
  const widths = Array(9).fill(60)
  const wide = balancedWrap(widths, 8, 700)
  const narrow = balancedWrap(widths, 8, 400)
  assert.equal(wide.lines.length, 1)
  assert.equal(narrow.lines.length, 2)
  assert.deepEqual(
    narrow.lines.map(line => line.length),
    [5, 4],
  )
  const narrower = balancedWrap(widths, 8, 200)
  assert.equal(narrower.lines.length, 3)
  assert.deepEqual(
    narrower.lines.map(line => line.length),
    [3, 3, 3],
  )
})
