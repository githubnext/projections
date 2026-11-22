import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import vm from 'node:vm'
import {executionEnvironment, runBounded} from './process.mjs'

// The README's and the gallery's images come from small projects in docs/images/sources/, drawn by
// tools/scripts/readme-images.mjs, which needs a browser and isn't run in CI. This runs each example as the script does,
// without drawing, so an example or its definition can't go stale unnoticed.

const root = fileURLToPath(new URL('../../../', import.meta.url))
const executable = fileURLToPath(new URL(`../dist/projections${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
// Built-in extractors that run Node keep their helpers in a cache.
const cache = await mkdtemp(path.join(tmpdir(), 'projections-gallery-cache-'))
test.after(() => rm(cache, {recursive: true, force: true}))
const cli = (cwd, args) =>
  runBounded(executable, args, {
    label: 'Projections CLI',
    cwd,
    env: {...executionEnvironment(process.env), PROJECTIONS_CACHE_DIR: cache},
    timeoutMs: 120_000,
  })

/** The script's `images` list: a plain literal, evaluated without running the script. */
async function images() {
  const source = await readFile(path.join(root, 'tools/scripts/readme-images.mjs'), 'utf8')
  const literal = source.match(/^const images = (\[[\s\S]+?^\])$/mu)
  assert.ok(literal, 'readme-images.mjs declares `const images = [...]`')
  return vm.runInNewContext(`(${literal[1]})`)
}

/** A repository whose two commits are the example's `before` and `after` as `app/`, set up as the script does. */
async function repository(t, item) {
  const directory = await mkdtemp(path.join(tmpdir(), `projections-gallery-${item.name}-`))
  t.after(() => rm(directory, {recursive: true, force: true}))
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Gallery', '-c', 'user.email=gallery@example.invalid', ...args],
      {
        cwd: directory,
      },
    )
  git('init', '--quiet')
  await writeFile(path.join(directory, '.gitignore'), 'node_modules\n')
  for (const side of ['before', 'after']) {
    await rm(path.join(directory, 'app'), {recursive: true, force: true})
    await cp(path.join(root, item.example, side), path.join(directory, 'app'), {recursive: true})
    git('add', '--all')
    git('commit', '--quiet', '--message', side)
  }
  if (item.typescript) {
    const typescript = path.dirname(fileURLToPath(import.meta.resolve('typescript/package.json')))
    await cp(typescript, path.join(directory, 'node_modules/typescript'), {recursive: true})
  }
  for (const [to, from] of Object.entries(item.tools ?? {})) await cp(path.join(root, from), path.join(directory, to), {recursive: true})
  const definition = {id: item.name, title: item.name, ...item.definition}
  if (item.comparator) {
    await cp(path.join(root, item.comparator), path.join(directory, `${item.name}.comparator.yaml`))
    definition.comparator = `${item.name}.comparator.yaml`
  }
  await mkdir(path.join(directory, '.projections'))
  await writeFile(path.join(directory, '.projections', `${item.name}.json`), `${JSON.stringify(definition, null, 2)}\n`)
  return directory
}

test('every before-and-after project in docs/images/sources/ is drawn by readme-images.mjs, and exists', async () => {
  const used = new Set((await images()).filter(item => item.example).map(item => item.example))
  const examples = []
  for (const entry of await readdir(path.join(root, 'docs/images/sources'), {withFileTypes: true})) {
    const directory = `docs/images/sources/${entry.name}`
    if (entry.isDirectory() && existsSync(path.join(root, directory, 'before'))) examples.push(directory)
  }
  assert.deepEqual([...used].toSorted(), examples.toSorted())
  for (const example of used) assert.ok(existsSync(path.join(root, example, 'after')), `${example}/after`)
})

// Images that draw one comparison twice (`side`) share a test.
const distinct = new Map()
for (const item of (await images()).filter(image => image.example)) {
  const {example, definition, comparator, tools, typescript} = item
  const key = JSON.stringify({example, definition, comparator, tools, typescript})
  if (!distinct.has(key)) distinct.set(key, item)
}
for (const item of distinct.values()) {
  test(`gallery example ${item.name} (${item.example}) compares with its definition`, async t => {
    const directory = await repository(t, item)
    if (item.definition.extractor === 'dotnet-di') {
      // Extracting builds the project with the .NET SDK, too slow here: check only that the definition is valid.
      const listed = JSON.parse((await cli(directory, ['list', '--json'])).stdout)
      assert.deepEqual(listed.invalid ?? [], [])
      assert.deepEqual(
        listed.projections.map(projection => projection.id),
        [item.name],
      )
      return
    }
    const args = ['compare', 'HEAD~1..HEAD', '-p', item.name, '--definition-revision', 'working-tree', '--json']
    const document = JSON.parse((await cli(directory, item.trust ? [...args, '--trust'] : args)).stdout)
    assert.ok(
      document.comparison.changes.some(change => change.status !== 'unchanged'),
      'the example changes something',
    )
  })
}
