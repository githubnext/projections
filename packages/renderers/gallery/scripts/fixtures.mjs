#!/usr/bin/env node
// Writes this package's scenario fixtures: renderer-scenarios extractions of a small made-up set of scenarios
// documents, before and after a change, produced by this workspace's CLI exactly as `projections show` produces them.
//
//   node scripts/fixtures.mjs
//
// Needs the native CLI (npm run build at the workspace root). The documents and their tiny extractions are below; the
// comparisons inside the fixtures are the CLI's own, computed in its comparator sandbox.
import {execFileSync} from 'node:child_process'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, '..', 'fixtures')
const cli = join(here, '../../../cli/dist', process.platform === 'win32' ? 'projections.exe' : 'projections')

const extraction = (schema, entities, relationships = []) => ({protocolVersion: 0, schema, entities, relationships})
const service = (id, label) => ({id, kind: 'service', label})
const calls = (from, to) => ({id: `${from}->${to}`, kind: 'calls', from, to})
const job = id => ({id: `job:${id}`, kind: 'job', label: id})
const precedes = (from, to) => ({id: `job:${from}->job:${to}`, kind: 'precedes', from: `job:${from}`, to: `job:${to}`})
const output = text => extraction('graph/v0', [{id: 'out', kind: 'output', label: '$ shipit status', data: {text}}])

const shop = extraction(
  'graph/v0',
  [service('web', 'Web'), service('orders', 'Orders'), service('billing', 'Billing')],
  [calls('web', 'orders'), calls('orders', 'billing')],
)
const split = extraction(
  'graph/v0',
  [service('web', 'Web'), service('orders', 'Orders'), service('payments', 'Payments'), service('fraud', 'Fraud checks')],
  [calls('web', 'orders'), calls('orders', 'payments'), calls('payments', 'fraud')],
)
const pipeline = jobs =>
  extraction(
    'dag/v0',
    [...new Set(jobs.flat())].map(job),
    jobs.map(([from, to]) => precedes(from, to)),
  )

/** The made-up repository at each revision: its scenarios documents. */
const before = {
  'graph/scenarios.json': {
    format: 'projections.scenarios',
    version: 0,
    title: 'Graph',
    renderer: 'graph',
    scenarios: [
      {id: 'shop', title: 'A small shop', description: 'Three services, one call each.', extraction: shop},
      {
        id: 'payments-split',
        title: 'Payments split out',
        description: 'Billing gives way to payments and fraud checks.',
        before: shop,
        after: split,
      },
      {
        id: 'release-pipeline',
        title: 'Release pipeline',
        group: 'Pipelines',
        renderer: 'dag',
        before: pipeline([
          ['build', 'test'],
          ['test', 'deploy'],
        ]),
        after: pipeline([
          ['build', 'test'],
          ['build', 'lint'],
          ['test', 'deploy'],
          ['lint', 'deploy'],
        ]),
      },
    ],
  },
  'text-diff/scenarios.json': {
    format: 'projections.scenarios',
    version: 0,
    title: 'Text diff',
    renderer: 'text-diff',
    scenarios: [
      {
        id: 'status',
        title: 'Status output',
        description: 'A release adds a warning line.',
        before: output('shipit 1.4\nall checks passed\n'),
        after: output('shipit 1.5\nall checks passed\n2 warnings\n'),
      },
      {id: 'banner', title: 'One banner', extraction: output('shipit 1.4\n')},
    ],
  },
}
// The change: one scenario redrawn (its description and fixture), one removed, and a custom renderer's scenario added.
const after = structuredClone(before)
after['text-diff/scenarios.json'].scenarios.pop()
after['graph/scenarios.json'].scenarios[0].description = 'Three services, one call each, and a cache in front.'
after['graph/scenarios.json'].scenarios[0].extraction = extraction(
  'graph/v0',
  [...shop.entities, service('cache', 'Cache')],
  [...shop.relationships, calls('web', 'cache')],
)
after['cards/scenarios.json'] = {
  format: 'projections.scenarios',
  version: 0,
  title: 'Package cards',
  scenarios: [{id: 'cards', title: 'Packages as cards', renderer: {bundle: 'dist'}, extraction: shop}],
}

function extract(files) {
  const root = mkdtempSync(join(tmpdir(), 'projections-gallery-fixtures-'))
  try {
    for (const [path, document] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), {recursive: true})
      writeFileSync(join(root, path), `${JSON.stringify(document, null, 2)}\n`)
    }
    const definition = {id: 'gallery', title: 'Renderer gallery', extractor: 'renderer-scenarios', renderer: 'gallery'}
    mkdirSync(join(root, '.github/projections'), {recursive: true})
    writeFileSync(join(root, '.github/projections/gallery.json'), JSON.stringify(definition))
    const git = (...args) =>
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {cwd: root, stdio: 'pipe'})
    git('init', '--quiet')
    git('add', '.')
    git('-c', 'user.name=Gallery fixtures', '-c', 'user.email=fixtures@example.invalid', 'commit', '--quiet', '-m', 'Scenarios')
    const shown = execFileSync(cli, ['-C', root, 'show', '-p', 'gallery', '--json'], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})
    return JSON.parse(shown).extraction
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

for (const [name, files] of Object.entries({before, after}))
  writeFileSync(join(fixtures, `gallery-${name}.json`), `${JSON.stringify(extract(files), null, 2)}\n`)
