import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clip,
  describe,
  firstParagraph,
  headings,
  listItems,
  parseFrontMatter,
  section,
  stripFrontMatter,
  title,
} from '../src/lib/markdown.ts'

test('front matter: plain, quoted and folded values, and the body after it', () => {
  const parsed = parseFrontMatter("---\ndescription: The core crate\nname: \"Quoted: with colon\"\nother: 'it''s'\n---\n\n# Core\n")
  assert.equal(parsed.present, true)
  assert.deepEqual(parsed.data, {description: 'The core crate', name: 'Quoted: with colon', other: "it's"})
  assert.equal(parsed.body, '\n# Core\n')
  const folded = parseFrontMatter('---\ndescription: >-\n  A long description\n  over two lines\n---\n# T\n')
  assert.equal(folded.data['description'], 'A long description over two lines')
  assert.equal(parseFrontMatter('---\r\ndescription: CRLF\r\n---\r\n# T').data['description'], 'CRLF')
})

test('no front matter: a horizontal rule later on is not front matter', () => {
  const parsed = parseFrontMatter('# Title\n\n---\n\ntext\n')
  assert.equal(parsed.present, false)
  assert.deepEqual(parsed.data, {})
  assert.equal(stripFrontMatter('# Title\n'), '# Title\n')
  assert.equal(stripFrontMatter('---\ndescription: x\n---\n\n# Title\n'), '# Title\n')
})

test('the first paragraph skips the title, badges, HTML, lists and fences, and flattens inline Markdown', () => {
  const text =
    '---\ndescription: d\n---\n# T\n\n[![b](x.svg)](y)\n<img src="x">\n\n```sh\nnot this\n```\n\nThe **first** paragraph, with `code` and a [link](a.md),\nover two lines.\n\nSecond.\n'
  assert.equal(firstParagraph(text), 'The first paragraph, with code and a link, over two lines.')
  assert.equal(firstParagraph('# Only a title\n'), undefined)
  assert.equal(firstParagraph('# T\n\n- a list\n\nProse.\n'), 'Prose.')
})

test('describe prefers front matter and flags the first-paragraph fallback', () => {
  assert.deepEqual(describe('---\ndescription: From front matter\n---\n# T\n\nParagraph.\n'), {
    description: 'From front matter',
    source: 'front-matter',
  })
  assert.deepEqual(describe('# T\n\nParagraph.\n'), {description: 'Paragraph.', source: 'first-paragraph'})
  assert.deepEqual(describe('# T\n'), {description: undefined, source: 'missing'})
  assert.deepEqual(describe(undefined), {description: undefined, source: 'missing'})
})

test('titles, headings outside fences, sections and list items', () => {
  const text =
    '---\nx: y\n---\n# Guide\n\n## Install\n\nRun it.\n\n```sh\n# comment, not a heading\n```\n\n### Detail\n\nMore.\n\n## Invariants\n\n- One `rule`.\n- Two, wrapped\n  onto a second line.\n\n## After\n'
  assert.equal(title(text), 'Guide')
  assert.deepEqual(
    headings(text).map(heading => `${heading.level}:${heading.text}`),
    ['1:Guide', '2:Install', '3:Detail', '2:Invariants', '2:After'],
  )
  assert.equal(section(text, 'install'), 'Run it.\n\n```sh\n# comment, not a heading\n```\n\n### Detail\n\nMore.')
  assert.deepEqual(listItems(section(text, 'Invariants') ?? ''), ['One rule.', 'Two, wrapped onto a second line.'])
  assert.equal(section(text, 'Missing'), undefined)
})

test('clip cuts at a word boundary', () => {
  assert.equal(clip('short', 10), 'short')
  assert.equal(clip('one two three four', 12), 'one two…')
})
