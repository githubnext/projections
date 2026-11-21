import {test} from 'node:test'
import assert from 'node:assert/strict'
import {diffLines, splitLines} from '../node_modules/.cache/test/diff.js'

/** Applies a diff to its before lines, so every result can be checked for correctness, not just shape. */
function check(before, after, diff = diffLines(before, after)) {
  const join = lines => lines.map(line => line.text + line.eol).join('')
  const old = [],
    next = []
  let expectOld = 0,
    expectNew = 0
  for (const op of diff.ops) {
    if (op.kind !== 'insert') {
      assert.equal(op.old, expectOld++)
      old.push(diff.before[op.old])
    }
    if (op.kind !== 'delete') {
      assert.equal(op.new, expectNew++)
      next.push(diff.after[op.new])
    }
    if (op.kind === 'equal') assert.deepEqual(diff.before[op.old], diff.after[op.new])
  }
  assert.equal(join(old), before)
  assert.equal(join(next), after)
  return diff
}
const kinds = diff => diff.ops.map(op => op.kind[0]).join('')
const edits = diff => diff.ops.filter(op => op.kind !== 'equal').length

test('lines keep their terminators; a trailing newline ends the last line', () => {
  assert.deepEqual(splitLines(''), [])
  assert.deepEqual(splitLines('a'), [{text: 'a', eol: ''}])
  assert.deepEqual(splitLines('a\n'), [{text: 'a', eol: '\n'}])
  assert.deepEqual(splitLines('a\r\nb\rc\n\n'), [
    {text: 'a', eol: '\r\n'},
    {text: 'b', eol: '\r'},
    {text: 'c', eol: '\n'},
    {text: '', eol: '\n'},
  ])
})

test('identical texts are all equal lines', () => {
  const diff = check('a\nb\nc\n', 'a\nb\nc\n')
  assert.equal(kinds(diff), 'eee')
  assert.equal(diff.minimal, true)
})

test('insertions, deletions and replacements are minimal, deletions first within a change', () => {
  assert.equal(kinds(check('a\nc\n', 'a\nb\nc\n')), 'eie')
  assert.equal(kinds(check('a\nb\nc\n', 'a\nc\n')), 'ede')
  assert.equal(kinds(check('a\nb\nc\n', 'a\nx\ny\nc\n')), 'ediie')
  assert.equal(kinds(check('x\na\nb\n', 'a\nb\ny\n')), 'deei')
  assert.equal(edits(check('a\nb\nc\na\nb\nb\na\n', 'c\nb\na\nb\na\nc\n')), 5, 'the classic Myers example needs five edits')
})

test('empty sides diff to pure insertions or deletions', () => {
  assert.equal(kinds(check('', '')), '')
  assert.equal(kinds(check('', 'a\nb')), 'ii')
  assert.equal(kinds(check('a\nb\n', '')), 'dd')
})

test('line endings and the final newline are part of a line', () => {
  assert.equal(kinds(check('a\nb\n', 'a\r\nb\r\n')), 'ddii')
  assert.equal(kinds(check('a\nb', 'a\nb\n')), 'edi')
  assert.equal(kinds(check('a\nb\n', 'a\nb')), 'edi')
  assert.equal(kinds(check('a\r\nb\r\nc', 'a\r\nB\r\nc')), 'edie')
})

test('random edits always reconstruct both texts', () => {
  let seed = 7
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let round = 0; round < 200; round++) {
    const lines = Array.from({length: Math.floor(random() * 30)}, () => 'abcde'[Math.floor(random() * 5)])
    const changed = lines.flatMap(line => (random() < 0.2 ? [] : random() < 0.2 ? [line, 'xyz'[Math.floor(random() * 3)]] : [line]))
    const text = list => list.map(line => `${line}\n`).join('')
    const diff = check(text(lines), text(changed))
    assert.ok(edits(diff) <= lines.length + changed.length)
  }
})

test('large inputs are trimmed in linear time and guarded beyond the work budget', () => {
  const big = Array.from({length: 200_000}, (_, index) => `line ${index}`)
  const changed = [...big]
  changed[100_000] = 'changed'
  const trimmed = check(big.join('\n'), changed.join('\n'))
  assert.equal(edits(trimmed), 2)

  const left = Array.from({length: 30_000}, (_, index) => `a${index}`).join('\n')
  const right = Array.from({length: 30_000}, (_, index) => `b${index}`).join('\n')
  const guarded = check(left, right)
  assert.equal(guarded.minimal, false)
  assert.equal(kinds(guarded), 'd'.repeat(30_000) + 'i'.repeat(30_000))

  const small = check('a\nb\nc\nd\n', 'w\nx\ny\nz\n', diffLines('a\nb\nc\nd\n', 'w\nx\ny\nz\n', {maxDistance: 3}))
  assert.equal(small.minimal, false)
  assert.equal(diffLines('a\nb\nc\nd\n', 'w\nx\ny\nz\n', {maxDistance: 8}).minimal, true)
})
