import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createNativeEngine} from '@githubnext/projections-engine/native'
import {comparisonModel, extractionModel} from '@githubnext/projections-renderer-kit'
import {summaryCountText, summaryItems} from '@githubnext/projections-renderer-sdk/presentation'
import {badgeIconNames} from '@githubnext/projections-renderer-sdk/protocol'
import {dependencyFacts, dependencyNouns} from '../node_modules/.cache/test/dependencies/facts.js'
import {versionBump, versionStatus} from '../node_modules/.cache/test/dependencies/versions.js'
import {actionPart, attributeChanges, infrastructureStatus} from '../node_modules/.cache/test/infrastructure/resources.js'
import {planFacts} from '../node_modules/.cache/test/infrastructure/facts.js'
import {graphNouns} from '../node_modules/.cache/test/nouns.js'

const engine = createNativeEngine()
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
const compare = async (before, after) => comparisonModel(before, after, await engine.compare(before, after))
/** Facts as the host's summary bar words them. */
const words = facts => facts.map(fact => summaryCountText(fact.count, fact.noun))

test('a version change names the part that moved', () => {
  assert.equal(versionBump('4.21.2', '5.1.0'), 'major')
  assert.equal(versionBump('^18.2.0', '^18.3.1'), 'minor')
  assert.equal(versionBump('1.2.3', '1.2.4'), 'patch')
  assert.equal(versionBump('1.0.0.0', '1.0.0.1'), 'patch')
  assert.equal(versionBump('2.0.0-rc.1', '2.0.0'), 'prerelease')
  assert.equal(versionBump('main', 'next'), undefined)
  const change = (before, after) => ({
    id: 'p',
    status: 'modified',
    before: {id: 'p', kind: 'package', label: 'p', data: {version: before}},
    after: {id: 'p', kind: 'package', label: 'p', data: {version: after}},
  })
  assert.deepEqual(
    versionStatus(change('4.21.2', '5.1.0'), {bump: true})?.map(part => part.label),
    ['Major upgrade'],
  )
  assert.deepEqual(
    versionStatus(change('1.2.4', '1.2.3'), {bump: true})?.map(part => part.label),
    ['Patch downgrade'],
  )
  assert.deepEqual(
    versionStatus(change('4.21.2', '5.1.0'))?.map(part => part.label),
    ['Upgraded'],
    'other modes keep the direction only',
  )
})

test("the express 5 facts count packages upgraded by bump, in the cards' words, and the direct dependencies changed", async () => {
  const model = await compare(fixture('npm-workspace-v1'), fixture('npm-workspace-v2'))
  const facts = dependencyFacts(model)
  assert.deepEqual(words(facts), ['18 major upgrades', '6 minor upgrades', '4 patch upgrades', '5 direct dependencies changed'])
  assert.deepEqual(
    facts.map(fact => fact.icon),
    ['upgraded', 'upgraded', 'upgraded', undefined],
  )
  // Each fact filters to its packages, the comparison's own changed rows, and the bumps match the cards' words.
  for (const fact of facts.slice(0, 3)) {
    for (const id of fact.ids) {
      const row = model.entities.find(item => item.id === id)
      assert.equal(versionStatus(row, {bump: true})[0].label.toLowerCase(), fact.noun.singular)
    }
  }
  // Packages added and removed are the bar's kind counts, not facts.
  const packages = model.entities.filter(row => row.status === 'modified' && !(row.after ?? row.before).data?.workspaceMember)
  assert.equal(
    packages.length,
    facts.slice(0, 3).reduce((sum, fact) => sum + fact.count, 0),
  )
})

test('workspaces added and dependencies rewired between existing workspaces are kind counts; nothing else is a fact', async () => {
  const workspace = (name, version = '1.0.0') => ({
    id: `workspace:@demo/${name}`,
    kind: 'package',
    label: `@demo/${name}`,
    data: {path: `packages/${name}`, version, workspaceMember: true},
  })
  const dependency = (from, to) => ({
    id: `dependency:["@demo/${from}","dependencies","@demo/${to}"]`,
    kind: 'dependencies',
    label: '1.0.0',
    from: `workspace:@demo/${from}`,
    to: `workspace:@demo/${to}`,
    data: {type: 'dependencies', version: '1.0.0'},
  })
  const extraction = (entities, relationships) => ({protocolVersion: 0, schema: 'graph/v0', entities, relationships})
  const before = extraction(
    [workspace('shared'), workspace('api'), workspace('web')],
    [dependency('api', 'shared'), dependency('web', 'api'), dependency('web', 'shared')],
  )
  const after = extraction(
    [workspace('shared'), workspace('api'), workspace('web'), workspace('auth'), workspace('billing')],
    [
      dependency('api', 'shared'),
      dependency('api', 'auth'),
      dependency('auth', 'shared'),
      dependency('web', 'api'),
      dependency('web', 'billing'),
      dependency('billing', 'api'),
    ],
  )
  const model = await compare(before, after)
  assert.deepEqual(dependencyFacts(model), [])
  const comparison = await engine.compare(before, after)
  const items = summaryItems({mode: 'comparison', before, after, comparison}, dependencyNouns(model))
  assert.deepEqual(
    items.map(item => [item.noun.plural, item.count, item.added ?? 0, item.removed ?? 0]),
    [
      ['workspaces', 5, 2, 0],
      ['dependencies', 6, 4, 1],
    ],
  )
  assert.deepEqual(dependencyFacts(await compare(before, before)), [])
})

test('the react update and NuGet facts', async () => {
  assert.deepEqual(words(dependencyFacts(await compare(fixture('npm-workspace-v2'), fixture('npm-workspace-v3')))), [
    '3 minor upgrades',
    '3 direct dependencies changed',
  ])
  const nuget = dependencyFacts(await compare(fixture('nuget-before'), fixture('nuget-after')))
  assert.deepEqual(words(nuget), ['4 major upgrades', '1 minor upgrade', '1 minor downgrade', '8 direct dependencies changed'])
  assert.deepEqual(
    nuget.map(fact => fact.icon),
    ['upgraded', 'upgraded', 'downgraded', undefined],
  )
})

test('the terraform plan facts are the planned actions of each resource, filtering to them', async () => {
  const model = await compare(fixture('terraform-before'), fixture('terraform-after'))
  const plan = planFacts(model)
  assert.deepEqual(words(plan), ['2 to add', '3 to change', '1 to replace', '1 to destroy', '1 to move'])
  assert.deepEqual(
    plan.map(fact => fact.icon),
    ['added', 'modified', 'replace', 'removed', 'moved'],
  )
  // Each word is the card's own status word for that resource.
  const statuses = model.entities.flatMap(row => infrastructureStatus(row).map(part => part.label))
  assert.equal(statuses.filter(label => label === 'Create').length, 2)
  assert.equal(statuses.filter(label => label === 'Destroy').length, 1)
  assert.equal(statuses.filter(label => label === 'Replace').length, 1)
  assert.deepEqual(
    plan.find(fact => fact.id === 'to-destroy').ids,
    model.entities
      .filter(row => row.status === 'removed' && (row.before.kind === 'resource' || row.before.kind === 'data-source'))
      .map(row => row.id),
  )
  // One revision's plan counts each resource's own pending action, as the plan's summary line does.
  const after = fixture('terraform-after')
  const single = planFacts(extractionModel(after))
  const pending = after.entities.filter(entity => entity.data?.action && entity.data.action !== 'no-op' && entity.kind !== 'module')
  assert.ok(single.length > 0)
  assert.equal(
    single.reduce((sum, fact) => sum + fact.count, 0),
    pending.length,
  )
})

test('every planned action is a badge and a word, as the change kinds are', () => {
  const actions = ['create', 'delete', 'replace', 'update', 'deploy', 'read', 'import', 'forget']
  const parts = actions.map(action => actionPart(action))
  assert.deepEqual(
    parts.map(part => part.label),
    ['Create', 'Destroy', 'Replace', 'Update in place', 'Redeploy', 'Read', 'Import', 'Forget'],
  )
  for (const part of parts) assert.ok(badgeIconNames.includes(part.icon), `${part.label}: ${part.icon}`)
})

test('a changed resource shows its attribute changes, what forces a replacement first', async () => {
  const model = await compare(fixture('terraform-before'), fixture('terraform-after'))
  const main = model.entities.find(row => row.id === 'module.database.aws_db_instance.main')
  const lines = attributeChanges(main)
  assert.equal(lines[0].key, 'storage_encrypted')
  assert.deepEqual(lines[0], {key: 'storage_encrypted', before: 'false', after: 'true'})
  assert.ok(lines.findIndex(line => line.after === '(known after apply)') > lines.findIndex(line => line.after !== '(known after apply)'))
  const replica = model.entities.find(row => row.id === 'module.database.aws_db_instance.replica')
  assert.deepEqual(attributeChanges(replica), [{key: 'replicate_source_db', before: 'shop-prod', after: '(known after apply)'}])
})

test('the bicep plan facts', async () => {
  assert.deepEqual(words(planFacts(await compare(fixture('azure-before'), fixture('azure-after')))), ['3 to add', '2 to change'])
})

test('the dependency graph names its kinds for the summary bar: workspaces, packages, then dependencies', async () => {
  const before = fixture('npm-workspace-v1'),
    after = fixture('npm-workspace-v2')
  const model = await compare(before, after)
  const nouns = dependencyNouns(model)
  assert.deepEqual(nouns['package'], {singular: 'workspace', plural: 'workspaces'})
  assert.deepEqual(nouns['external-package'], {singular: 'package', plural: 'packages'})
  assert.deepEqual(nouns['dependencies'], {singular: 'dependency', plural: 'dependencies'})
  assert.deepEqual(nouns['devDependencies'], {singular: 'dev dependency', plural: 'dev dependencies'})
  assert.equal(nouns['resolved'], false)
  const items = summaryItems({mode: 'comparison', before, after, comparison: await engine.compare(before, after)}, nouns)
  assert.deepEqual(
    items.map(item => item.noun.plural),
    ['workspaces', 'packages', 'dependencies'].filter(plural => items.some(item => item.noun.plural === plural)),
  )
  assert.equal(items[0].kind, 'package')
  assert.equal(items[0].count, after.entities.filter(entity => entity.kind === 'package').length)
})

test("a DAG's summary bar counts its precedes relationships as dependencies, not as a verb", () => {
  const job = id => ({id, kind: 'job', label: id})
  const precedes = (from, to) => ({id: `${from}->${to}`, kind: 'precedes', from, to})
  const extraction = {
    protocolVersion: 0,
    schema: 'dag/v0',
    entities: [job('build'), job('test'), job('deploy')],
    relationships: [precedes('build', 'test'), precedes('test', 'deploy')],
  }
  const items = summaryItems({mode: 'extraction', extraction}, graphNouns)
  assert.deepEqual(
    items.map(item => summaryCountText(item.count, item.noun)),
    ['3 jobs', '2 dependencies'],
  )
  const one = summaryItems({mode: 'extraction', extraction: {...extraction, relationships: [precedes('build', 'test')]}}, graphNouns)
  assert.equal(summaryCountText(one[1].count, one[1].noun), '1 dependency')
})
