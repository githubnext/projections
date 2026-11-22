import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import test from 'node:test'
import {anchors, linkProblems, links, slug} from '../src/lib/links.ts'

function repository(files: Record<string, string>): {root: string; paths: string[]; [Symbol.dispose]: () => void} {
  const root = mkdtempSync(join(tmpdir(), 'tools-links-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), {recursive: true})
    writeFileSync(join(root, path), text)
  }
  return {root, paths: Object.keys(files).toSorted(), [Symbol.dispose]: () => rmSync(root, {recursive: true, force: true})}
}

test('slugs follow GitHub: lowercase, punctuation dropped, each space a hyphen', () => {
  assert.equal(slug('Guide: develop a renderer'), 'guide-develop-a-renderer')
  assert.equal(slug('Identity (renames, moves, splits and merges)'), 'identity-renames-moves-splits-and-merges')
  assert.equal(slug('A & B'), 'a--b')
  assert.equal(slug('snake_case and kebab-case'), 'snake_case-and-kebab-case')
})

test('anchors: headings outside fences, numbered repeats, inline Markdown flattened and HTML ids', () => {
  const page =
    '---\ndescription: d\n---\n# Title\n\n## `run` the [CLI](x.md)\n\n```sh\n# not a heading\n```\n\n## Usage\n\n## Usage\n\n<a id="custom"></a>\n'
  assert.deepEqual([...anchors(page)].toSorted(), ['custom', 'run-the-cli', 'title', 'usage', 'usage-1'])
})

test('links: inline, images, references and HTML, never inside code', () => {
  const page =
    'See [a](a.md#x) and ![b](img/b.png "title").\n\n`[not](code.md)`\n\n```md\n[not](fenced.md)\n```\n\n[ref]: <docs/c d.md>\n\n<img src="e.png" alt="">\n'
  assert.deepEqual(links(page), [
    {target: 'a.md#x', line: 1},
    {target: 'img/b.png', line: 1},
    {target: 'docs/c d.md', line: 9},
    {target: 'e.png', line: 11},
  ])
})

test('link problems: missing files and anchors, links outside the repository and root-relative links', () => {
  using repo = repository({
    'README.md': [
      '# Home',
      '',
      '[ok](docs/guide.md#usage) [dir](docs) [self](#home) [line](src/a.ts#L3) [web](https://example.com/x.md)',
      '[gone](docs/missing.md) [anchor](docs/guide.md#nowhere) [up](../outside.md) [root](/docs/guide.md)',
      '[spaced](docs/a%20b.md)',
    ].join('\n'),
    'docs/README.md': '# Docs\n',
    'docs/guide.md': '# Guide\n\n## Usage\n',
    'docs/a b.md': '# Spaced\n',
    'src/a.ts': '// see docs/guide.md#usage and docs/gone.md and docs/guide.md#nope, not my-docs/x.md or https://example.com/docs/x.md\n',
    'test/a.test.ts': '// docs/fixture-only.md\n',
  })
  assert.deepEqual(
    linkProblems(repo.root, repo.paths).map(problem => `${problem.file}:${problem.line} ${problem.message}`),
    [
      'README.md:4 Broken link: docs/missing.md: docs/missing.md does not exist',
      'README.md:4 Broken link: docs/guide.md#nowhere: docs/guide.md has no heading or anchor #nowhere',
      'README.md:4 Broken link: ../outside.md points outside the repository',
      'README.md:4 Broken link: /docs/guide.md: a root-relative link breaks when the repository moves; use a relative path',
      'src/a.ts:1 Missing documentation page: docs/gone.md: docs/gone.md does not exist',
      'src/a.ts:1 Missing documentation page: docs/guide.md#nope: docs/guide.md has no heading or anchor #nope',
    ],
  )
})
