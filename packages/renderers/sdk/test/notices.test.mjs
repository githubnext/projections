import {test} from 'node:test'
import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {mkdtemp, readFile, readdir, rm, writeFile, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {build, loadConfigFromFile} from 'vite'
import {bundleNotices, bundledPackages, mergeNotices, noticeSections, packageNotice} from '../build/notices.mjs'
import {rendererConfig} from '../dist/vite.js'

const workspace = fileURLToPath(new URL('../../../../', import.meta.url))

/** Package name and version of each npm package a module graph includes, derived independently of `bundledPackages`. */
async function packagesOf(moduleIds) {
  const found = new Set()
  for (const id of moduleIds) {
    const path = id.replace(/^\0/u, '').replace(/\?.*$/u, '')
    const at = path.lastIndexOf('/node_modules/')
    if (at < 0) continue
    const parts = path.slice(at + '/node_modules/'.length).split('/')
    const root = path.slice(0, at + '/node_modules/'.length) + parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/')
    if (!existsSync(join(root, 'package.json'))) continue
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    if (!manifest.name.startsWith('@githubnext/')) found.add(`${manifest.name} ${manifest.version}`)
  }
  return [...found].sort()
}

/** Builds a renderer package in memory without the bundle plugin, so the script chunk keeps its module graph. */
async function rendererModules(directory) {
  const {config} = await loadConfigFromFile({command: 'build', mode: 'production'}, join(directory, 'vite.config.ts'), directory, 'silent')
  const output = await build({
    ...config,
    root: directory,
    configFile: false,
    logLevel: 'silent',
    plugins: config.plugins.flat().filter(plugin => plugin?.name !== 'projections-renderer-bundle'),
    build: {...config.build, write: false},
  })
  const chunk = [output]
    .flat()
    .flatMap(result => result.output)
    .find(item => item.type === 'chunk')
  return Object.entries(chunk.modules)
    .filter(([, module]) => module.renderedLength > 0)
    .map(([id]) => id)
}

const headings = text => [...noticeSections(text).keys()].map(heading => heading.slice(6).split(' ').slice(0, 2).join(' '))

test('every built-in renderer bundle lists every npm package its script includes', {timeout: 300_000}, async () => {
  const directories = (await readdir(join(workspace, 'packages/renderers'), {withFileTypes: true}))
    .filter(entry => entry.isDirectory() && existsSync(join(workspace, 'packages/renderers', entry.name, 'vite.config.ts')))
    .map(entry => join(workspace, 'packages/renderers', entry.name))
  assert.ok(directories.length > 5)
  for (const directory of directories) {
    const notices = join(directory, 'dist', 'THIRD_PARTY_NOTICES.txt')
    assert.ok(existsSync(notices), `${directory} ships THIRD_PARTY_NOTICES.txt beside index.html (build it first)`)
    const listed = headings(await readFile(notices, 'utf8'))
    const bundled = await packagesOf(await rendererModules(directory))
    assert.ok(
      bundled.some(name => name.startsWith('react ')),
      `${directory}: the probe build found its packages`,
    )
    if (/[\\/](?:graph|dag|architecture)$/u.test(directory)) {
      assert.ok(
        bundled.some(name => name.startsWith('elkjs ')),
        `${directory} bundles ELK`,
      )
    }
    assert.deepEqual(
      bundled.filter(name => !listed.includes(name)),
      [],
      `${directory}: packages without notices`,
    )
  }
})

test("the graph renderer bundle carries ELK's full EPL-2.0 license, copyrights and source", async () => {
  const text = await readFile(join(workspace, 'packages/renderers/graph/dist/THIRD_PARTY_NOTICES.txt'), 'utf8')
  const section = [...noticeSections(text)].find(([heading]) => heading.startsWith('===== elkjs '))?.[1]
  assert.ok(section, 'elkjs is listed')
  assert.match(section, /Distributed under EPL-2\.0\. Source: https:\/\/github\.com\/kieler\/elkjs\/tree\/\d+\.\d+\.\d+, unmodified\./u)
  assert.match(section, /Copyright \(c\) \d{4} Kiel University and others/u)
  assert.match(section, /# Eclipse Public License - v 2\.0/u)
  assert.match(section, /Exhibit A/u)
})

test('a renderer build fails when it bundles a package that declares no license', {timeout: 60_000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'projections-notices-'))
  try {
    await mkdir(join(directory, 'node_modules', 'unlicensed'), {recursive: true})
    await writeFile(
      join(directory, 'node_modules', 'unlicensed', 'package.json'),
      JSON.stringify({name: 'unlicensed', version: '1.0.0', main: 'index.js'}),
    )
    await writeFile(join(directory, 'node_modules', 'unlicensed', 'index.js'), 'export const value = 42\n')
    await writeFile(join(directory, 'main.js'), "import {value} from 'unlicensed'\ndocument.body.textContent = String(value)\n")
    await assert.rejects(
      build({
        root: directory,
        configFile: false,
        logLevel: 'silent',
        ...rendererConfig({entry: join(directory, 'main.js'), name: 'probe', title: 'Probe', outDir: join(directory, 'dist')}),
      }),
      /unlicensed@1\.0\.0 has no license file or license field/u,
    )
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test('merged notices list each package version once', () => {
  const react = `===== react 19.0.0 (MIT) =====\nMIT text\n`
  const a = `${bundleNotices('A', [])}\n${react}`,
    b = `B\n\n${react}\n===== elkjs 0.12.1 (EPL-2.0) =====\nEPL text\n`
  const merged = mergeNotices('Renderers', [a, b])
  assert.equal(merged.match(/===== react /gu).length, 1)
  assert.deepEqual(headings(merged), ['elkjs 0.12.1', 'react 19.0.0'])
  assert.deepEqual(headings(mergeNotices('Renderers', [a, b], new Set(['react']))), ['elkjs 0.12.1'])
})

test('vendored data is attributed inside an installed package too, and @githubnext packages are not', async () => {
  const root = await mkdtemp(join(tmpdir(), 'projections-notices-'))
  try {
    const installed = join(root, 'node_modules/@githubnext/projections')
    await mkdir(join(installed, 'vendor/linguist'), {recursive: true})
    await mkdir(join(installed, 'dist'), {recursive: true})
    await writeFile(join(installed, 'package.json'), JSON.stringify({name: '@githubnext/projections', version: '1.0.0', license: 'MIT'}))
    await writeFile(join(installed, 'vendor/linguist/vendor.json'), JSON.stringify({name: 'linguist', version: 'v9', license: 'MIT'}))
    await writeFile(join(installed, 'vendor/linguist/languages.js'), 'export {}')
    const found = bundledPackages([join(installed, 'vendor/linguist/languages.js'), join(installed, 'dist/kit.js')])
    assert.deepEqual(
      found.map(entry => [entry.name, entry.version, entry.license]),
      [['linguist', 'v9', 'MIT']],
    )
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

test('module ID queries and SPDX alternatives are read in linear time', async () => {
  const root = await mkdtemp(join(tmpdir(), 'projections-notices-'))
  try {
    const directory = join(root, 'node_modules/elected')
    await mkdir(directory, {recursive: true})
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({name: 'elected', version: '1.0.0', license: 'MPL-2.0', repository: 'git+https://example.com/elected.git'}),
    )
    await writeFile(join(directory, 'LICENSE'), 'MPL text')
    assert.deepEqual(
      bundledPackages([`\0${join(directory, 'index.js')}?commonjs-proxy?x`]).map(entry => entry.name),
      ['elected'],
    )
    const entry = license => ({name: 'elected', version: '1.0.0', license, directory, files: []})
    assert.match(packageNotice(entry('(MPL-2.0 OR Apache-2.0)')), /Distributed under MPL-2\.0\. Source/u)
    const started = performance.now()
    assert.deepEqual(bundledPackages([`${'?'.repeat(100_000)}\n`]), [])
    assert.match(packageNotice(entry(`MPL-2.0${' '.repeat(100_000)}x`)), /Distributed under MPL-2\.0 x\. Source/u)
    assert.ok(performance.now() - started < 1000, `took ${Math.round(performance.now() - started)} ms`)
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})
