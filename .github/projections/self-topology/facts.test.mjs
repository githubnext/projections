// node --test .github/projections/self-topology/
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {firstSentence, frontMatterDescription, frontMatterIcon, rounded, tokens} from './facts.mjs'

test('size in tokens ignores how code is formatted', () => {
  const wrapped = ['fn total(', '    items: &[u32],', ') -> u32 {', '    items.iter().sum()', '}']
  const joined = ['fn total(items: &[u32]) -> u32 { items.iter().sum() }']
  assert.equal(tokens(wrapped, 'rust'), tokens(joined, 'rust'))
  // A trailing comma or a semicolon is no token; a string or a Rust char is one, and a lifetime is a word.
  assert.equal(tokens(["let s = 'a b', t = `c`;"], 'javascript'), tokens(["let s = 'a b', t = `c`,"], 'javascript'))
  assert.equal(tokens(["fn f<'a>(x: &'a str) -> char { 'x' }"], 'rust'), 8)
})

test('sizes move only on steps about a fifth apart', () => {
  assert.deepEqual([12437, 437, 47000, 16000, 17500, 0].map(rounded), [12000, 400, 50000, 15000, 20000, 0])
})

test('a README says what its component is for: front matter first, else its first sentence', () => {
  assert.equal(frontMatterDescription('---\ndescription: "Built-in renderer: graphs"\n---\n# x'), 'Built-in renderer: graphs')
  assert.equal(frontMatterDescription('---\ndescription: >-\n  Folded over\n  two lines\n---\n'), 'Folded over two lines')
  assert.equal(frontMatterDescription('# No front matter'), undefined)
  assert.equal(firstSentence('# Canvas\n\n`extension.mjs` is an [extension](x.md). More.\n'), 'extension.mjs is an extension.')
})

test("a README's front matter names its component's icon", () => {
  const readme = '---\ndescription: The shared Rust core\nicon: cpu\n---\n# Engine'
  assert.equal(frontMatterIcon(readme), 'cpu')
  assert.equal(frontMatterDescription(readme), 'The shared Rust core')
  assert.equal(frontMatterIcon("---\nicon: 'git-compare'\n---\n"), 'git-compare')
  assert.equal(frontMatterIcon('---\ndescription: No icon\n---\n'), undefined)
  // Only the front matter counts: an `icon:` line in the body is prose.
  assert.equal(frontMatterIcon('# Title\n\nicon: cpu\n'), undefined)
})
