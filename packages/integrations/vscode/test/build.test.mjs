// The build's schema bundling and the packaging script, without VS Code.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {bundleSchemas, localize, schemaBase} from '../scripts/schemas.mjs'
import {packageManifest, stage, targets} from '../scripts/package.mjs'
import {anchors, bundledName, bundleProblems, planDocs, referenceSections, rewriteLinks} from '../scripts/docs.mjs'

const schemas = fileURLToPath(new URL('../../../schemas/schemas/', import.meta.url))
const manifest = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))

async function temporary(t, prefix) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  t.after(() => rm(directory, {recursive: true, force: true}))
  return directory
}

/** Every `$ref` in a schema. */
function references(value, found = []) {
  if (Array.isArray(value)) value.forEach(item => references(item, found))
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') found.push(child)
      else references(child, found)
    }
  }
  return found
}

test('the bundled schemas reference each other as files, whatever base their $id names', async t => {
  // The retired base is joined so the repository-wide check for it (packages/schemas/test/publication.test.mjs) skips this test.
  const retired = ['https://projections.githubnext.com', 'schemas/'].join('/')
  for (const base of [retired, 'https://schemas.projections.githubnext.com/']) {
    // The repository's schemas, published under `base`.
    const source = await temporary(t, 'projections-schemas-source-')
    const destination = await temporary(t, 'projections-schemas-bundled-')
    const files = []
    const walk = async prefix => {
      for (const entry of await readdir(path.join(schemas, prefix), {withFileTypes: true})) {
        const relative = path.posix.join(prefix, entry.name)
        if (entry.isDirectory()) await walk(relative)
        else if (entry.name.endsWith('.json')) files.push(relative)
      }
    }
    await walk('')
    const current = schemaBase(
      await Promise.all(files.map(async file => ({file, schema: JSON.parse(await readFile(path.join(schemas, file), 'utf8'))}))),
    )
    for (const file of files) {
      await mkdir(path.dirname(path.join(source, file)), {recursive: true})
      await writeFile(path.join(source, file), (await readFile(path.join(schemas, file), 'utf8')).replaceAll(current, base))
    }
    const index = await bundleSchemas(source, destination)
    assert.equal(index.base, base)
    assert.equal(index.schemas[`${base}definition/v0.json`], 'definition/v0.json')
    assert.equal(index.schemas[`${base}comparator/v0.json`], 'comparator/v0.json')
    assert.equal(index.schemas[`${base}vocabularies/infrastructure/v0.json`], 'vocabularies/infrastructure/v0.json')
    for (const file of files) {
      const bundled = JSON.parse(await readFile(path.join(destination, file), 'utf8'))
      assert.equal(bundled.$id, undefined, file)
      for (const reference of references(bundled)) {
        assert.ok(!reference.includes('://'), `${file}: ${reference}`)
        if (reference.startsWith('#')) continue
        // A relative reference names a bundled file.
        await stat(path.join(destination, path.dirname(file), reference.split('#')[0]))
      }
    }
    const definition = JSON.parse(await readFile(path.join(destination, 'definition/v0.json'), 'utf8'))
    assert.ok(references(definition).includes('../extraction/v0.json#/$defs/data'))
  }
})

test('localizing keeps fragments and leaves other URLs alone; mixed bases are refused', () => {
  const base = 'https://example.test/s/'
  assert.deepEqual(
    localize(
      {
        $id: `${base}a/v0.json`,
        properties: {x: {$ref: `${base}b/v0.json#/$defs/y`}, z: {$ref: '#/$defs/z'}, w: {$ref: 'https://other.test/c.json'}},
        items: [{$ref: `${base}a/v0.json`}],
      },
      'a/v0.json',
      base,
    ),
    {
      properties: {x: {$ref: '../b/v0.json#/$defs/y'}, z: {$ref: '#/$defs/z'}, w: {$ref: 'https://other.test/c.json'}},
      items: [{$ref: './v0.json'}],
    },
  )
  assert.throws(
    () =>
      schemaBase([
        {file: 'a/v0.json', schema: {$id: 'https://one.test/a/v0.json'}},
        {file: 'b/v0.json', schema: {$id: 'https://two.test/b/v0.json'}},
      ]),
    /bases differ/u,
  )
  assert.throws(() => schemaBase([{file: 'a/v0.json', schema: {$id: 'https://one.test/b/v0.json'}}]), /no \$id ending/u)
})

test('the manifest contributes the bundled schemas for definitions and comparator files', () => {
  assert.deepEqual(manifest.contributes.jsonValidation, [
    {
      fileMatch: [
        '.github/projections/*.json',
        '.projections/*.json',
        '!.github/projections/environment.json',
        '!.projections/environment.json',
      ],
      url: './dist/schemas/definition/v0.json',
    },
    {fileMatch: ['.github/projections/environment.json', '.projections/environment.json'], url: './dist/schemas/environment/v0.json'},
  ])
  assert.deepEqual(manifest.contributes.yamlValidation, [
    {fileMatch: ['*.comparator.yaml', '*.comparator.yml'], url: './dist/schemas/comparator/v0.json'},
    {fileMatch: ['*.comparator.test.yaml', '*.comparator.test.yml'], url: './dist/schemas/comparator-tests/v0.json'},
  ])
  assert.equal(manifest.private, true)
  assert.equal(manifest.icon, 'media/icon.png')
})

test("the mark and the part icons are glyphs of the packaged icon font, and the Definition tree's rows use the parts'", async () => {
  const icons = manifest.contributes.icons
  assert.deepEqual(Object.keys(icons), ['projections-mark', 'projections-extractor', 'projections-comparator', 'projections-renderer'])
  assert.equal(icons['projections-mark'].default.fontCharacter, '\\E000')
  // VS Code rejects every icon an extension contributes if one ID isn't two segments or more (`component-iconname`).
  for (const id of Object.keys(icons)) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)+$/u)
  for (const {default: icon} of Object.values(icons)) {
    const font = await readFile(fileURLToPath(new URL(`../${icon.fontPath}`, import.meta.url)))
    assert.equal(font.toString('latin1', 0, 4), 'wOFF')
    // The cmap's format 4 subtable (tables are stored uncompressed): the code point maps to a glyph with an outline.
    const table = name => {
      for (let i = 0; i < font.readUInt16BE(12); i++) {
        const entry = 44 + 20 * i
        if (font.toString('latin1', entry, entry + 4) === name) return font.subarray(font.readUInt32BE(entry + 4))
      }
      throw new Error(`No ${name} table`)
    }
    const cmap = table('cmap')
    const subtable = cmap.subarray(cmap.readUInt32BE(8))
    const segments = subtable.readUInt16BE(6) / 2
    const code = Number.parseInt(icon.fontCharacter.slice(1), 16)
    let glyph = 0
    for (let i = 0; i < segments; i++) {
      const [end, start] = [subtable.readUInt16BE(14 + 2 * i), subtable.readUInt16BE(16 + 2 * segments + 2 * i)]
      if (code >= start && code <= end) glyph = (code + subtable.readUInt16BE(16 + 4 * segments + 2 * i)) & 0xffff
    }
    assert.ok(glyph > 0, `${icon.fontCharacter} has a glyph`)
    const [loca, glyf] = [table('loca'), table('glyf')]
    const offset = loca.readUInt32BE(4 * glyph)
    assert.ok(loca.readUInt32BE(4 * glyph + 4) > offset, `${icon.fontCharacter} draws something`)
    assert.ok(glyf.readInt16BE(offset) > 0)
  }
  // The Definition view and its rows (definition/tree-item.ts).
  const definition = (
    await Promise.all(
      ['../src/definition.ts', '../src/definition/tree-item.ts'].map(source =>
        readFile(fileURLToPath(new URL(source, import.meta.url)), 'utf8'),
      ),
    )
  ).join('\n')
  for (const name of Object.keys(icons).filter(candidate => candidate !== 'projections-mark')) {
    assert.ok(definition.includes(`'${name}'`), name)
  }
  assert.doesNotMatch(definition, /ThemeIcon\('(inspect|git-compare|eye)'\)|'inspect' :|'git-compare' :/u)
})

test(
  'packaging stages the built extension and one platform executable of the matching version',
  {
    skip:
      process.platform === 'win32' &&
      'The stand-in executable is a /bin/sh script, and execute bits are POSIX; release-proof packages and installs every target',
  },
  async t => {
    const root = await temporary(t, 'projections-vscode-package-')
    for (const [file, text] of [
      ['dist/extension.cjs', 'module.exports = {}\n'],
      ['dist/docs/index.json', '{}\n'],
      ['media/icon.png', 'png'],
      ['README.md', '---\ndescription: The extension\n---\n\n# Projections\n'],
      ['LICENSE', 'MIT\n'],
    ]) {
      await mkdir(path.dirname(path.join(root, file)), {recursive: true})
      await writeFile(path.join(root, file), text)
    }
    await writeFile(path.join(root, 'package.json'), JSON.stringify({...manifest, version: '1.2.3'}))
    const binary = path.join(root, 'projections-fake')
    await writeFile(binary, '#!/bin/sh\necho "projections 1.2.3"\n')
    await chmod(binary, 0o755)
    const staged = await stage({root, target: 'linux-armhf', binary, out: path.join(root, '.package')})
    const executable = path.join(staged, 'bin', 'linux-arm', 'projections')
    assert.equal((await stat(executable)).mode & 0o111, 0o111)
    const shipped = JSON.parse(await readFile(path.join(staged, 'package.json'), 'utf8'))
    assert.equal(shipped.scripts, undefined)
    assert.equal(shipped.devDependencies, undefined)
    assert.equal(shipped.dependencies, undefined)
    assert.deepEqual(shipped.contributes, manifest.contributes)
    await stat(path.join(staged, 'dist', 'extension.cjs'))
    // The bundled documentation ships with it: rows open it in VS Code.
    await stat(path.join(staged, 'dist', 'docs', 'index.json'))
    // The front matter describes the package for this repository's tools; the Marketplace would show it as text.
    assert.equal(await readFile(path.join(staged, 'README.md'), 'utf8'), '# Projections\n')
    // A universal package ships no executable.
    const universal = await stage({root, out: path.join(root, '.package')})
    await assert.rejects(stat(path.join(universal, 'bin')))
    // The executable must be the extension's version.
    await writeFile(binary, '#!/bin/sh\necho "projections 1.2.4"\n')
    await assert.rejects(
      stage({root, target: 'darwin-arm64', binary, out: path.join(root, '.package')}),
      /is projections 1\.2\.4; this extension \(1\.2\.3\)/u,
    )
    await assert.rejects(stage({root, target: 'beos-x64', binary, out: path.join(root, '.package')}), /Unknown target/u)
    assert.equal(targets['alpine-x64'], 'linux-x64')
    assert.deepEqual(packageManifest({name: 'x', scripts: {}, devDependencies: {}, dependencies: {}}), {name: 'x'})
  },
)

test('the bundled docs rewrite relative links: bundled pages stay in the bundle, anything else goes to GitHub', () => {
  const base = 'https://github.com/githubnext/projections/blob/main/'
  const bundled = new Map(
    ['extractors/graph-x/README.md', 'docs/guides/how-it-works.md', 'docs/reference/renderers.md'].map(file => [file, bundledName(file)]),
  )
  assert.equal(bundledName('extractors/graph-x/README.md'), 'extractors/graph-x.md')
  // A built-in's page keeps its place under docs/builtins; their index is index.md.
  assert.equal(bundledName('docs/builtins/extractors/graph-x.md'), 'extractors/graph-x.md')
  assert.equal(bundledName('docs/builtins/README.md'), 'index.md')
  assert.equal(bundledName('docs/guides/how-it-works.md'), 'docs/guides/how-it-works.md')
  const text = [
    'See the [guide](../../docs/guides/how-it-works.md#tutorial "The guide") and [the\nrenderers](../../docs/reference/renderers.md).',
    'Its [code](src/lib.rs), [fixtures](tests/fixtures/), [contracts](../../docs/contracts.md#x) and [above\n](#usage).',
    '![A diagram](images/diagram.png) and [Node](https://nodejs.org/api/) stay.',
    '```md',
    '[unchanged](src/lib.rs)',
    '```',
    '[ref]: ../../docs/guides/how-it-works.md',
  ].join('\n')
  assert.equal(
    rewriteLinks(text, 'extractors/graph-x/README.md', bundled),
    [
      'See the [guide](../docs/guides/how-it-works.md#tutorial "The guide") and [the\nrenderers](../docs/reference/renderers.md).',
      `Its [code](${base}extractors/graph-x/src/lib.rs), [fixtures](${base}extractors/graph-x/tests/fixtures/), [contracts](${base}docs/contracts.md#x) and [above\n](#usage).`,
      // An image isn't bundled: it becomes a link to it, named by its text.
      `[A diagram](${base}extractors/graph-x/images/diagram.png) and [Node](https://nodejs.org/api/) stay.`,
      '```md',
      '[unchanged](src/lib.rs)',
      '```',
      '[ref]: ../docs/guides/how-it-works.md',
    ].join('\n'),
  )
  // From a page in a deeper directory, and a link out of the repository is left alone.
  assert.equal(
    rewriteLinks('[x](../../extractors/graph-x/README.md) [out](../../../elsewhere.md)', 'docs/reference/renderers.md', bundled),
    '[x](../../extractors/graph-x.md) [out](../../../elsewhere.md)',
  )
})

test("the reference pages' sections name each built-in's page, and renderers' handles", () => {
  const text = [
    '# Built-in renderers',
    '## `graph`',
    'Graphs. See [its page](../builtins/renderers/graph.md).',
    '- Handles: `graph`, `dag`',
    '## `orphan`',
    'No page.',
  ].join('\n')
  assert.deepEqual(referenceSections(text, 'docs/reference/renderers.md'), [
    {name: 'graph', handles: ['graph', 'dag'], page: 'docs/builtins/renderers/graph.md'},
  ])
})

test('every link in the bundle must open in the preview: a bundled page and its heading, or https', () => {
  const pages = new Map([
    ['index.md', '# Built-ins\n\n## Extractors\n\n[ok](extractors/x.md#the-x-extractor) [here](#extractors) [web](https://github.com/x)\n'],
    [
      'extractors/x.md',
      '# The `x` extractor\n\n[up](../index.md) [gone](../renderers/y.md) [no heading](../index.md#renderers) [file](../../x/README.md)\n\n```md\n[in code](nowhere.md)\n```\n\n[ref]: vscode-resource:/x.md\n',
    ],
  ])
  assert.deepEqual([...anchors(pages.get('extractors/x.md'))], ['the-x-extractor'])
  assert.deepEqual(bundleProblems(pages), [
    'extractors/x.md: ../renderers/y.md: not a bundled page',
    'extractors/x.md: ../index.md#renderers: index.md has no heading #renderers',
    'extractors/x.md: ../../x/README.md: not a bundled page',
    'extractors/x.md: vscode-resource:/x.md: not a link the preview can open',
  ])
})

test('heading anchors drop HTML tags but keep a lone `<`, in linear time', () => {
  assert.deepEqual([...anchors('# The <code>x</code> extractor\n\n## a < b\n')], ['the-x-extractor', 'a--b'])
  const started = performance.now()
  anchors(`# ${'<'.repeat(100_000)}\n`)
  assert.ok(performance.now() - started < 1000, `took ${Math.round(performance.now() - started)} ms`)
})

test("the repository's bundle: every built-in extractor and renderer handle has a page, and every page links within it or to GitHub", async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const {pages, index} = await planDocs(root)
  assert.equal(index.extractors['workspace-dependencies'], 'extractors/workspace-dependencies.md')
  assert.equal(index.renderers.dependencies, 'renderers/graph.md')
  assert.equal(index.renderers.graph, 'renderers/graph.md')
  assert.equal(index.comparator, 'comparators/default.md')
  assert.equal(index.sources['comparators/default.md'], 'docs/builtins/comparators/default.md')
  // The welcome's catalog of built-ins.
  assert.ok(pages.has('index.md'))
  for (const page of [...Object.values(index.extractors), ...Object.values(index.renderers)]) assert.ok(pages.has(page), page)
  for (const [page, file] of Object.entries(index.sources)) {
    assert.ok(pages.has(page), page)
    await stat(path.join(root, file))
  }
  // Every link opens in the preview (a bundled page and its heading) or on GitHub; no image is left to load.
  assert.deepEqual(bundleProblems(pages), [])
  for (const [page, text] of pages) assert.doesNotMatch(text, /!\[[^\]]*\]\((?!https:)/u, `${page} loads an image`)
  for (const [page, text] of pages) assert.doesNotMatch(text, /^---\n/u, `${page} keeps its front matter`)
  const size = [...pages.values()].reduce((total, text) => total + text.length, 0)
  // Guards against accidentally bundling generated or binary-like content, not against ordinary doc growth.
  assert.ok(size < 2_000_000, `${size} characters`)
})
