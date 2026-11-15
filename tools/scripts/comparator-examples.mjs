#!/usr/bin/env node
// Draws the images in docs/images/comparators/ with the CLI and the real renderers: each example's before and after
// extractions, compared by the default comparator and by the custom rules, exactly as `projections compare` would in a
// repository that defines them. Run it after changing a comparator, its fixtures or a renderer it uses:
//
//   node tools/scripts/comparator-examples.mjs     (needs `npm run build`, Cargo, and Chrome, Chromium or Edge)
//
// The images are committed. Unlike docs/reference, they aren't checked in CI: drawing them needs a browser.
import {spawnSync} from 'node:child_process'
import {copyFile, mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const out = join(root, 'docs/images/comparators')

/** Each example: its extractions, renderer, comparator and how to draw it. */
const examples = [
  {
    name: 'runtime-policy',
    renderer: 'runtime-policy',
    before: 'packages/extractors/tetragon-policies/tests/fixtures/credentials/before.expected.json',
    after: 'packages/extractors/tetragon-policies/tests/fixtures/credentials/after.expected.json',
    comparator: 'packages/comparators/runtime-policy/runtime-policy.comparator.yaml',
    image: {mode: 'diff', width: 1100, height: 600},
  },
  {
    name: 'api-compatibility',
    renderer: 'api',
    before: 'packages/renderers/api/fixtures/typescript-before.json',
    after: 'packages/renderers/api/fixtures/typescript-after.json',
    comparator: 'packages/comparators/api-compatibility/api-compatibility.comparator.yaml',
    image: {mode: 'diff', width: 1100, height: 700},
  },
  {
    name: 'moved-components',
    renderer: 'architecture',
    before: 'examples/comparators/moved-components/fixtures/before.json',
    after: 'examples/comparators/moved-components/fixtures/after.json',
    comparator: 'examples/comparators/moved-components/moved-components.comparator.yaml',
    image: {mode: 'side-by-side', width: 900, height: 600},
  },
]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options})
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}:\n${result.stderr.trim()}`)
  return result.stdout
}

let binary = process.env.PROJECTIONS_BIN
if (!binary) {
  run('cargo', ['build', '--quiet', '--locked', '-p', 'projections-cli'], {cwd: root, stdio: ['ignore', 'ignore', 'pipe']})
  binary = join(root, 'target', 'debug', process.platform === 'win32' ? 'projections.exe' : 'projections')
}

// A scratch repository defining each example twice: with the default comparator, and with the custom one.
const repo = await realpath(await mkdtemp(join(tmpdir(), 'projections-comparator-examples-')))
try {
  const git = (...args) => run('git', ['-c', 'user.name=Projections', '-c', 'user.email=projections@example.com', ...args], {cwd: repo})
  git('init', '--quiet')
  await mkdir(join(repo, '.github/projections'), {recursive: true})
  await mkdir(join(repo, 'tools'), {recursive: true})
  for (const example of examples) {
    const rules = `tools/${example.name}.comparator.yaml`
    await copyFile(join(root, example.comparator), join(repo, rules))
    const definition = (id, comparator) => ({
      id,
      title: example.name,
      extractor: {command: ['true']},
      renderer: example.renderer,
      ...(comparator ? {comparator: rules} : {}),
    })
    await writeFile(join(repo, `.github/projections/${example.name}.json`), `${JSON.stringify(definition(example.name, true), null, 2)}\n`)
    await writeFile(
      join(repo, `.github/projections/${example.name}-default.json`),
      `${JSON.stringify(definition(`${example.name}-default`, false), null, 2)}\n`,
    )
  }
  git('add', '--all')
  git('commit', '--quiet', '--message', 'Comparator examples')

  await mkdir(out, {recursive: true})
  const projections = (...args) => run(binary, ['-C', repo, ...args], {cwd: repo})
  for (const example of examples) {
    for (const [id, comparator] of [
      [example.name, `tools/${example.name}.comparator.yaml`],
      [`${example.name}-default`, undefined],
    ]) {
      // The working tree's definition normalizes and digests the raw extractions, running nothing.
      for (const side of ['before', 'after'])
        projections('show', '-p', id, '--from', join(root, example[side]), '--output', join(repo, `${id}.${side}.json`))
      const comparison = join(repo, `${id}.comparison.json`)
      projections(
        'compare',
        '--before-extraction',
        join(repo, `${id}.before.json`),
        '--after-extraction',
        join(repo, `${id}.after.json`),
        ...(comparator ? ['--comparator', join(repo, comparator)] : []),
        '--output',
        comparison,
      )
      const image = join(out, `${id}.png`)
      await rm(image, {force: true})
      const {mode, width, height} = example.image
      projections(
        'show',
        '--from',
        comparison,
        '--png',
        image,
        '--mode',
        mode,
        '--width',
        `${width}`,
        '--height',
        `${height}`,
        '--scale',
        '2',
      )
      console.log(`Wrote docs/images/comparators/${id}.png`)
    }
  }
} finally {
  await rm(repo, {recursive: true, force: true})
}
