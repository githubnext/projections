import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createNativeEngine} from '@githubnext/projections-engine/native'
import {
  comparisonModel,
  createGraphTransition,
  extractionModel,
  isChanged,
  sampleSpline,
  scheduleSteps,
  stepEnds,
} from '@githubnext/projections-renderer-kit'
import {compareVersions, versionStatus} from '../node_modules/.cache/test/dependencies/versions.js'
import {dependencyView} from '../node_modules/.cache/test/dependencies/model.js'

const engine = createNativeEngine()
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
const compare = async (before, after) => comparisonModel(before, after, await engine.compare(before, after))
const ids = view => view.model.entities.map(row => row.id)
const row = (view, id) => view.model.entities.find(item => item.id === id)
const summaries = view => view.model.entities.filter(item => item.id.startsWith('transitive:'))
const ownerOf = summary => summary.id.slice('transitive:'.length)

test('one revision shows the roots and their direct dependencies, with transitive packages summarized', () => {
  const extraction = fixture('npm-workspace-v2')
  const view = dependencyView(extractionModel(extraction), [], new Set())
  assert.deepEqual([...view.roots].sort(), ['workspace:@shop/api', 'workspace:@shop/web', 'workspace:shop'])
  for (const id of ['package:express', 'package:zod', 'package:react', 'package:react-dom']) assert.ok(view.direct.has(id), id)
  assert.ok(!view.direct.has('workspace:@shop/web'), 'a workspace member stays a root')
  assert.ok(!ids(view).includes('package:body-parser'))
  const express = row(view, 'transitive:package:express')
  assert.match(express.after.label, /^\d+ more packages$/u)
  assert.equal(express.status, 'unchanged')
  // Every installed package is either a card or counted in exactly one summary.
  const external = extraction.entities.filter(entity => entity.kind === 'external-package').length
  assert.equal(
    summaries(view).reduce((sum, item) => sum + item.after.data.count, 0),
    view.collapsed,
  )
  assert.equal(external, view.collapsed + ids(view).filter(id => id.startsWith('package:')).length)
  // Each summary hangs off the package that owns it.
  assert.ok(view.model.relationships.some(edge => edge.after?.from === 'package:express' && edge.after.to === 'transitive:package:express'))
  // Cards name workspaces and packages, not the extractor's kinds.
  assert.equal(row(view, 'workspace:@shop/api').after.kind, 'workspace')
  assert.equal(row(view, 'package:express').after.kind, 'package')
  // The same documents always present the same graph.
  assert.equal(
    JSON.stringify(dependencyView(extractionModel(extraction), [], new Set()).model.entities),
    JSON.stringify(view.model.entities),
  )
})

test('expanding a package shows what it pulls in; all shows every package and no summaries', () => {
  const model = extractionModel(fixture('npm-workspace-v2'))
  const closed = dependencyView(model, [], new Set())
  const expanded = dependencyView(model, [], new Set(['package:express']))
  for (const id of ['package:body-parser', 'package:router', 'package:send']) assert.ok(ids(expanded).includes(id), id)
  // The summary's card stays, with the same ID and edge, to collapse what it counted.
  const summary = row(closed, 'transitive:package:express').after
  const collapse = row(expanded, 'transitive:package:express').after
  assert.equal(collapse.label, `Collapse ${summary.data.count} packages`)
  assert.deepEqual(collapse.data, {count: summary.data.count, expanded: true})
  assert.ok(expanded.model.relationships.some(edge => edge.after?.from === 'package:express' && edge.after.to === collapse.id))
  assert.ok(!summaries(closed).some(item => item.after.data.expanded), 'no collapse card until expanded')
  const all = dependencyView(model, [], 'all')
  assert.equal(all.collapsed, 0)
  assert.equal(all.model.entities.length, model.entities.length)
  assert.equal(summaries(all).length, 0)
})

test('collapsing an expanded package hides what it showed, and expanding it again restores what was open inside', () => {
  const model = extractionModel(fixture('npm-workspace-v2'))
  const closed = dependencyView(model, [], new Set())
  const express = dependencyView(model, [], new Set(['package:express']))
  // body-parser, expanded inside express, shows packages express alone doesn't, whatever the order of their IDs.
  const nested = dependencyView(model, [], new Set(['package:express', 'package:body-parser']))
  const inner = ids(nested).find(id => id.startsWith('package:') && !ids(express).includes(id))
  assert.ok(inner, 'an expanded package inside an expanded one shows its packages')
  assert.match(row(nested, 'transitive:package:body-parser').after.label, /^Collapse \d+ packages?$/u)
  // Collapsing express hides body-parser and everything it showed, back to express's summary.
  const collapsed = dependencyView(model, [], new Set(['package:body-parser']))
  assert.deepEqual(ids(collapsed), ids(closed))
  assert.equal(row(collapsed, 'transitive:package:express').after.label, row(closed, 'transitive:package:express').after.label)
  // Re-expanding express brings body-parser back expanded.
  assert.deepEqual(ids(dependencyView(model, [], new Set(['package:body-parser', 'package:express']))), ids(nested))
})

test('every change and the path that pulls it in stays visible; summaries change only with their owner', async () => {
  for (const [from, to] of [
    ['npm-workspace-v2', 'npm-workspace-v3'],
    ['npm-workspace-v1', 'npm-workspace-v2'],
  ]) {
    const model = await compare(fixture(from), fixture(to))
    const view = dependencyView(model, [], new Set())
    const shown = new Set(ids(view))
    for (const change of model.entities.filter(isChanged)) assert.ok(shown.has(change.id), `${from}: ${change.id}`)
    for (const change of model.relationships.filter(isChanged)) {
      assert.ok(
        view.model.relationships.some(edge => edge.id === change.id),
        `${from}: relationship ${change.id}`,
      )
    }
    for (const summary of summaries(view)) {
      if (summary.status === 'unchanged') continue
      assert.equal(summary.status, model.entities.find(item => item.id === ownerOf(summary)).status, summary.id)
    }
  }
  // React DOM's scheduler is transitive, so the path that pulls it in is shown.
  const small = dependencyView(await compare(fixture('npm-workspace-v2'), fixture('npm-workspace-v3')), [], new Set())
  for (const id of ['workspace:@shop/web', 'package:react-dom', 'package:scheduler', 'package:clsx']) assert.ok(ids(small).includes(id), id)
  assert.ok(ids(small).includes('transitive:package:express'), 'unchanged subgraphs stay collapsed')
})

test('summary cards arrive and leave in the step of the package that owns them', async () => {
  const model = await compare(fixture('npm-workspace-v1'), fixture('npm-workspace-v2'))
  const view = dependencyView(model, [], new Set())
  for (const summary of summaries(view).filter(item => item.status !== 'unchanged')) {
    const step = view.model.steps.find(item => item.entities.includes(ownerOf(summary)))
    assert.ok(step?.entities.includes(summary.id), summary.id)
  }
})

test('NuGet projects and target frameworks are roots; membership relationships are not dependencies', () => {
  const view = dependencyView(extractionModel(fixture('nuget-after')), [], 'all')
  assert.ok(
    [...view.roots].every(id => id.startsWith('nuget-project') || id.startsWith('nuget-target')),
    [...view.roots].join(),
  )
  assert.ok(!view.model.relationships.some(edge => edge.after.kind === 'resolved'))
  assert.ok(view.direct.size > 0)
  assert.ok(
    [...view.direct].every(id => id.startsWith('nuget-library')),
    [...view.direct].join(),
  )
})

test('Swift package targets and products are roots; the packages they use are direct dependencies', () => {
  const entity = (id, kind) => ({id, kind, label: id, data: {}})
  const edge = (kind, from, to) => ({id: `${kind}:${from}:${to}`, kind, from, to})
  const extraction = {
    protocolVersion: 0,
    schema: 'graph/v0',
    entities: [
      entity('product:Harbor', 'product'),
      entity('target:Harbor', 'target'),
      entity('target:HarborCore', 'target'),
      entity('package:swift-log', 'external-package'),
      entity('package:swift-atomics', 'external-package'),
    ],
    relationships: [
      edge('includes', 'product:Harbor', 'target:Harbor'),
      edge('depends-on', 'target:Harbor', 'target:HarborCore'),
      edge('depends-on', 'target:HarborCore', 'package:swift-log'),
    ],
  }
  const view = dependencyView(extractionModel(extraction), [], new Set())
  assert.deepEqual([...view.roots].sort(), ['product:Harbor', 'target:Harbor', 'target:HarborCore'])
  assert.ok(view.direct.has('package:swift-log'))
})

test('version changes read as upgrades and downgrades in icon and word', () => {
  assert.equal(compareVersions('19.1.0', '19.2.0'), 'upgraded')
  assert.equal(compareVersions('^18.3.0', '^17.0.2'), 'downgraded')
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), 'upgraded')
  assert.equal(compareVersions('github:acme/kit#abc', 'github:acme/kit#def'), 'changed')
  const change = (before, after, extra = {}) => ({
    id: 'p',
    status: 'modified',
    before: {id: 'p', kind: 'package', label: 'p', data: {version: before}},
    after: {id: 'p', kind: 'package', label: 'p', data: {version: after}},
    ...extra,
  })
  assert.deepEqual(versionStatus(change('1.0.0', '2.0.0')), [{status: 'modified', glyph: '↑', icon: 'upgraded', label: 'Upgraded'}])
  assert.deepEqual(versionStatus(change('2.0.0', '1.0.0')), [{status: 'modified', glyph: '↓', icon: 'downgraded', label: 'Downgraded'}])
  assert.equal(versionStatus(change('1.0.0', '1.0.0')), undefined)
  assert.equal(versionStatus(change('1.0.0', '2.0.0', {renamed: true})), undefined)
})

/** Relationships drawn through a card other than their own endpoints, at each progress. */
function crossings(transition, progresses) {
  const failures = new Set()
  for (const progress of progresses) {
    const frame = transition(progress)
    const cards = frame.nodes.filter(node => !node.group && node.opacity > 0.5)
    for (const edge of frame.edges.filter(edge => !edge.containment && edge.opacity > 0.5)) {
      const points = sampleSpline(edge.points, 3)
      for (const card of cards) {
        if (card.id === edge.fromId || card.id === edge.toId) continue
        const [left, right, top, bottom] = [
          card.x - card.width / 2 + 2,
          card.x + card.width / 2 - 2,
          card.y - card.height / 2 + 2,
          card.y + card.height / 2 - 2,
        ]
        if (points.some(point => point.x > left && point.x < right && point.y > top && point.y < bottom)) {
          failures.add(`${edge.key} through ${card.id} at ${progress}`)
        }
      }
    }
  }
  return [...failures]
}

async function dependencyTransition(from, to) {
  const model = await compare(fixture(from), fixture(to))
  const schedule = scheduleSteps(model)
  const view = dependencyView(model, schedule, new Set())
  return {schedule: view.schedule, transition: await createGraphTransition(view.model, view.schedule, {orientation: 'horizontal'})}
}

test('while scrubbing a dependency graph, no visible relationship passes through a visible card', async () => {
  const frames = Array.from({length: 201}, (_, index) => index / 200)
  for (const [from, to] of [
    ['npm-workspace-v2', 'npm-workspace-v3'],
    ['npm-workspace-v3', 'npm-workspace-v2'],
    ['nuget-before', 'nuget-after'],
  ]) {
    const {transition} = await dependencyTransition(from, to)
    assert.deepEqual(crossings(transition, frames).slice(0, 8), [], `${from} to ${to}`)
  }
  // A major upgrade rewires dozens of packages at once: routes may brush a card while
  // cards make room or close gaps, but never at rest, at either endpoint or a step's hold.
  const {schedule, transition} = await dependencyTransition('npm-workspace-v1', 'npm-workspace-v2')
  assert.deepEqual(crossings(transition, [0, 1, ...stepEnds(schedule, 1)]).slice(0, 8), [])
})

test('primary paths: each package keeps the edge that pulls it in and every added or removed dependency; the rest are counted on its card', async () => {
  for (const [from, to] of [
    ['npm-workspace-v1', 'npm-workspace-v2'],
    ['npm-workspace-v2', 'npm-workspace-v3'],
    ['nuget-before', 'nuget-after'],
  ]) {
    const model = await compare(fixture(from), fixture(to))
    const every = dependencyView(model, scheduleSteps(model), new Set(), 'all')
    const primary = dependencyView(model, scheduleSteps(model), new Set(), 'primary')
    // The same packages: only edges are left out.
    assert.deepEqual(ids(primary), ids(every))
    const kept = new Set(primary.model.relationships.map(row => row.id))
    const dropped = every.model.relationships.filter(row => !kept.has(row.id))
    // Never a structural change: what's left out is unchanged or a version-range update.
    for (const row of dropped) assert.ok(row.status === 'unchanged' || row.status === 'modified', `${row.id} is ${row.status}`)
    // Each left-out edge is counted on its package, and the counts are exactly those left out.
    const pairs = row =>
      ['before', 'after']
        .filter(side => row[side])
        .map(side => ({from: model.entityRow[side].get(row[side].from), to: model.entityRow[side].get(row[side].to)}))
    const drawn = new Set(primary.model.relationships.flatMap(row => pairs(row).map(({from, to}) => `${from}>${to}`)))
    const targets = new Map()
    for (const row of dropped) {
      for (const {from: source, to: id} of pairs(row)) {
        if (!drawn.has(`${source}>${id}`)) targets.set(id, new Set([...(targets.get(id) ?? []), source]))
      }
    }
    for (const [id, sources] of targets) assert.deepEqual(new Set(primary.otherDependents.get(id)), sources, id)
    assert.equal(primary.otherDependents.size, targets.size)
    // Every shown package but the roots still has a drawn edge into it.
    const into = new Set(primary.model.relationships.flatMap(row => pairs(row).map(({to}) => to)))
    for (const row of primary.model.entities) {
      if (!primary.roots.has(row.id) && every.model.relationships.some(edge => pairs(edge).some(({to}) => to === row.id))) {
        assert.ok(into.has(row.id), `${row.id} lost every edge into it`)
      }
    }
  }
  // Express 5 shares many packages: a third of the edges go, all of them range updates.
  const model = await compare(fixture('npm-workspace-v1'), fixture('npm-workspace-v2'))
  const every = dependencyView(model, scheduleSteps(model), new Set(), 'all').model.relationships.length
  const primary = dependencyView(model, scheduleSteps(model), new Set(), 'primary').model.relationships.length
  assert.ok(primary <= every * 0.75, `${primary} of ${every} edges drawn`)
})
