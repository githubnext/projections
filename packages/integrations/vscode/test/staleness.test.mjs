// Unit tests of when a projection result is out of date (`staleness.ts`): the changes rule today, the identity rule
// once the backend reports identities (local execution M2), and both together; loaded from source with Node's type
// stripping.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {scopeDigest, scopedTreeOf} from '../src/scope.ts'
import {provenanceBadge} from '../src/environment-model.ts'
import {observation, relevantFiles, staleness} from '../src/staleness.ts'
import {changesSince, staleByChanges} from '../src/staleness/changes.ts'
import {resultBadge, staleNotice, staleText, staleTitle, stampTree} from '../src/staleness/notices.ts'
import {staleByIdentity} from '../src/staleness/identity.ts'

const head = 'a'.repeat(40)
const moved = 'b'.repeat(40)
const base = 'c'.repeat(40)
const treeThen = 'd'.repeat(40)
const treeNow = 'e'.repeat(40)
const digest = 'sha256:1'

/** My branch: the merge base → the working tree, taken at generation 4. */
const branch = {
  projection: 'packages',
  pair: {before: base, after: 'working-tree'},
  generation: 4,
  head,
  sides: [{ref: base}, {ref: 'working-tree'}],
}
/** Now: the working tree alone. */
const now = {projection: 'packages', pair: {after: 'working-tree'}, generation: 4, head, sides: [{ref: 'working-tree'}]}
/** Last commit: HEAD~1 → HEAD, symbolic refs. */
const lastCommit = {
  projection: 'packages',
  pair: {before: 'HEAD~1', after: 'HEAD'},
  generation: 4,
  head,
  sides: [{ref: 'HEAD~1'}, {ref: 'HEAD'}],
}
/** A custom pair of commits. */
const commits = {projection: 'packages', pair: {before: base, after: head}, generation: 4, head, sides: [{ref: base}, {ref: head}]}
const record = (generation, changes, complete = true) => ({generation, changes, complete})

test('changes since a generation, and whether they are known', () => {
  const records = [record(4, ['working-tree']), record(5, ['renderer:packages']), record(6, ['comparator:packages'])]
  assert.deepEqual(changesSince(records, 4), {kinds: new Set(['renderer:packages', 'comparator:packages']), complete: true})
  assert.deepEqual(changesSince(records, 6), {kinds: new Set(), complete: true})
  // A gap (generation 5 missing) or an incomplete record: anything may have changed.
  assert.equal(changesSince([record(4, []), record(6, ['renderer:packages'])], 4).complete, false)
  assert.equal(changesSince([record(5, ['working-tree'], false)], 4).complete, false)
})

test('the changes rule: what touched the projection after the result', () => {
  const input = records => ({records, head})
  // Nothing since: current.
  assert.equal(staleByChanges(branch, input([record(3, ['working-tree'])])), undefined)
  // The working tree: My branch and Now are out of date; a pair of commits isn't.
  assert.deepEqual(staleByChanges(branch, input([record(5, ['working-tree'])])), {tier: 'extraction', why: 'working tree'})
  assert.deepEqual(staleByChanges(now, input([record(5, ['working-tree'])])), {tier: 'extraction', why: 'working tree'})
  assert.equal(staleByChanges(commits, input([record(5, ['working-tree'])])), undefined)
  // Symbolic refs are out of date only when HEAD moved.
  assert.equal(staleByChanges(lastCommit, input([record(5, ['working-tree'])])), undefined)
  assert.deepEqual(staleByChanges(lastCommit, {records: [record(5, ['working-tree'])], head: moved}), {
    tier: 'extraction',
    why: 'refs moved',
  })
  // The projection's code: every result, any pair.
  assert.deepEqual(staleByChanges(commits, input([record(5, ['definitions'])])), {tier: 'extraction', why: 'definition'})
  assert.deepEqual(staleByChanges(commits, input([record(5, ['extractor:packages'])])), {tier: 'extraction', why: 'extractor'})
  assert.equal(staleByChanges(commits, input([record(5, ['extractor:other'])])), undefined)
  // The comparator: only a comparison, and only its comparison.
  assert.deepEqual(staleByChanges(commits, input([record(5, ['comparator:packages'])])), {tier: 'comparison', why: 'comparator'})
  assert.equal(staleByChanges(now, input([record(5, ['comparator:packages'])])), undefined)
  // A tab that compares again on its own (refresh: 'compare') isn't out of date for a comparator edit.
  assert.equal(staleByChanges(commits, {...input([record(5, ['comparator:packages'])]), recompares: true}), undefined)
  // A renderer change reloads the view; the result stands.
  assert.equal(staleByChanges(branch, input([record(5, ['renderer:packages'])])), undefined)
  // Unknown changes: out of date.
  assert.deepEqual(staleByChanges(commits, input([record(6, ['renderer:packages'])])), {tier: 'extraction', why: 'working tree'})
})

test('the identity rule: trees and definition digests', () => {
  const withIdentity = {
    ...branch,
    sides: [
      {ref: base, definitionDigest: digest, execution: {source: 'local-git-objects', fidelity: 'exact'}},
      {ref: 'working-tree', definitionDigest: digest, execution: {source: 'local-in-place', fidelity: 'exact', tree: treeThen}},
    ],
  }
  assert.equal(staleByIdentity(withIdentity, {tree: treeThen, definitionDigest: digest}), undefined)
  assert.deepEqual(staleByIdentity(withIdentity, {tree: treeNow, definitionDigest: digest}), {tier: 'extraction', why: 'working tree'})
  assert.deepEqual(staleByIdentity(withIdentity, {tree: treeThen, definitionDigest: 'sha256:2'}), {tier: 'extraction', why: 'definition'})
  // A working-tree result without a tree can't be shown current.
  assert.deepEqual(staleByIdentity(now, {tree: treeThen}), {tier: 'extraction', why: 'working tree'})
})

test('both modes together', () => {
  const inPlace = {
    ...now,
    sides: [{ref: 'working-tree', definitionDigest: digest, execution: {source: 'local-in-place', fidelity: 'exact', tree: treeThen}}],
  }
  const changed = [record(5, ['working-tree'])]
  // Without an identity: the changes rule.
  assert.deepEqual(staleness(inPlace, {records: changed, head}), {tier: 'extraction', why: 'working tree'})
  // With one: the tree decides (an edit undone leaves the tree as it was) ...
  assert.equal(staleness(inPlace, {records: changed, head, identity: {tree: treeThen, definitionDigest: digest}}), undefined)
  assert.deepEqual(staleness(inPlace, {records: [], head, identity: {tree: treeNow, definitionDigest: digest}}), {
    tier: 'extraction',
    why: 'working tree',
  })
  // ... except a toolchain extractor run in place, which also read ignored files the tree doesn't see.
  assert.deepEqual(staleness(inPlace, {records: changed, head, identity: {tree: treeThen, definitionDigest: digest}, toolchain: true}), {
    tier: 'extraction',
    why: 'working tree',
  })
  // The comparator and moved refs still come from the changes.
  const comparison = {
    ...commits,
    sides: commits.sides.map(side => ({...side, definitionDigest: digest})),
  }
  assert.deepEqual(
    staleness(comparison, {records: [record(5, ['comparator:packages'])], head, identity: {tree: treeNow, definitionDigest: digest}}),
    {
      tier: 'comparison',
      why: 'comparator',
    },
  )
  // An identity without a digest leaves the definition to the changes.
  assert.deepEqual(staleness(comparison, {records: [record(5, ['definitions'])], head, identity: {tree: treeNow}}), {
    tier: 'extraction',
    why: 'definition',
  })
  // fidelity "stale": the tree changed while it ran, so out of date at once, in either mode.
  const raced = {...now, sides: [{ref: 'working-tree', execution: {fidelity: 'stale', tree: treeThen}}]}
  assert.deepEqual(staleness(raced, {records: [], head}), {tier: 'extraction', why: 'changed while extracting'})
  assert.deepEqual(staleness(raced, {records: [], head, identity: {tree: treeThen}}), {tier: 'extraction', why: 'changed while extracting'})
})

test('"N files changed" counts from the result’s own tree, else the stamped one; the notice reads as one line', () => {
  assert.equal(stampTree({...now, sides: [{ref: 'working-tree', execution: {tree: treeThen}}], tree: treeNow}), treeThen)
  assert.equal(stampTree({...commits, tree: treeNow}), treeNow)
  assert.equal(staleText(3), 'Out of date · 3 files changed')
  assert.equal(staleText(1), 'Out of date · 1 file changed')
  assert.equal(staleText(0), 'Out of date')
  assert.equal(staleText(undefined), 'Out of date')
  // The pill's parts: the label stays whole, the count truncates first.
  assert.deepEqual(staleNotice(19), {label: 'Out of date', detail: '19 files changed'})
  assert.deepEqual(staleNotice(1), {label: 'Out of date', detail: '1 file changed'})
  assert.deepEqual(staleNotice(0), {label: 'Out of date'})
  assert.equal(staleTitle({tier: 'comparison', why: 'comparator'}), "The projection's comparator changed since this comparison")
})

// Local execution M2's provenance, exactly as `serve --stdio` reports it.
const m2Local = {
  source: 'local-in-place',
  fidelity: 'exact',
  tree: treeThen,
  determinism: 'pure',
  environment: 'sha256:9f2c',
  at: '2026-11-09T22:38:33Z',
}
const m2Ci = {
  source: 'ci',
  fidelity: 'exact',
  official: true,
  ci: {repository: 'acme/service', run: 4242},
  tree: base,
  determinism: 'pure',
  environment: 'sha256:9f2c',
  at: '2026-11-08T10:00:00Z',
}

test('M2: GET /api/identity and changes with a tree decide by identity', () => {
  const since = changesSince
  const result = {...now, sides: [{ref: 'working-tree', definitionDigest: digest, execution: m2Local}]}
  // `{tree, definitionDigest}`, as GET /api/identity?projection=ID answers.
  assert.equal(
    staleness(result, {
      records: [{generation: 5, changes: ['working-tree'], complete: true, tree: treeThen}],
      head,
      identity: {tree: treeThen, definitionDigest: digest},
    }),
    undefined,
  )
  assert.deepEqual(
    staleness(result, {
      records: [{generation: 5, changes: ['working-tree'], complete: true, tree: treeNow}],
      head,
      identity: {tree: treeNow, definitionDigest: digest},
    }),
    {
      tier: 'extraction',
      why: 'working tree',
    },
  )
  assert.equal(since([{generation: 5, changes: ['working-tree'], complete: true, tree: treeNow}], 4).complete, true)
})

test('M2: an observation says when it ran instead of whether it is out of date', () => {
  const observed = {
    ...now,
    sides: [{ref: 'working-tree', definitionDigest: digest, execution: {...m2Local, determinism: 'observed', at: '2026-11-09T22:30:00Z'}}],
  }
  assert.deepEqual(observation(observed), {at: '2026-11-09T22:30:00Z'})
  assert.equal(
    staleness(observed, {records: [record(5, ['working-tree'])], head, identity: {tree: treeNow, definitionDigest: digest}}),
    undefined,
  )
  // The earliest side's time.
  const both = {
    ...branch,
    sides: [
      {ref: base, execution: {...m2Local, determinism: 'observed', at: '2026-11-09T21:00:00Z'}},
      {ref: 'working-tree', execution: {...m2Local, determinism: 'observed', at: '2026-11-09T22:00:00Z'}},
    ],
  }
  assert.deepEqual(observation(both), {at: '2026-11-09T21:00:00Z'})
  assert.equal(observation({...now, sides: [{ref: 'working-tree', execution: m2Local}]}), undefined)
  // fidelity "stale" stays out of date at once, observed or not.
  const raced = {...now, sides: [{ref: 'working-tree', execution: {...m2Local, determinism: 'observed', fidelity: 'stale'}}]}
  assert.deepEqual(staleness(raced, {records: [], head}), {tier: 'extraction', why: 'changed while extracting'})
})

test('M2: the badge beside the choice, from provenanceBadge', () => {
  const fromCi = {
    ...commits,
    sides: [
      {ref: base, definitionDigest: digest, execution: m2Ci},
      {ref: head, execution: m2Local},
    ],
  }
  const ci = resultBadge(fromCi, provenanceBadge)
  assert.equal(ci.label, 'From CI')
  assert.match(ci.detail, /^Before: The official extraction, published by CI run 4242 of acme\/service/u)
  assert.match(ci.detail, /\nAfter: Extracted on this machine in your checkout/u)
  assert.equal(resultBadge({...now, sides: [{ref: 'working-tree', execution: m2Local}]}, provenanceBadge).label, 'Local')
  // The one that most qualifies the result wins.
  const stale = {...fromCi, sides: [fromCi.sides[0], {ref: head, execution: {...m2Local, fidelity: 'stale'}}]}
  assert.equal(resultBadge(stale, provenanceBadge).label, 'Stale')
  const observed = {...fromCi, sides: [fromCi.sides[0], {ref: head, execution: {...m2Local, determinism: 'observed'}}]}
  assert.equal(resultBadge(observed, provenanceBadge).label, 'Observed')
  assert.equal(resultBadge(now, provenanceBadge), undefined)
})

test('M5: a verified scope compares the scope identity, so edits outside it leave the result current', () => {
  const scopedThen = `sha256:${'1'.repeat(64)}`
  const scopedNow = `sha256:${'2'.repeat(64)}`
  // provenance.execution.scope as an extraction records it, with the scope identity the host computed from its tree.
  const scoped = {
    ...now,
    sides: [
      {
        ref: 'working-tree',
        definitionDigest: digest,
        execution: {...m2Local, tree: treeThen, scope: ['api']},
        scopedTree: scopedThen,
      },
    ],
  }
  // GET /api/identity?projection=ID for a projection with a scope.
  const identity = (tree, scopedTree, scopeVerified) => ({tree, definitionDigest: digest, scope: ['api'], scopedTree, scopeVerified})
  // Verified: an edit outside the scope (a new tree, the same scope identity) leaves it current; one inside doesn't.
  assert.equal(staleByIdentity(scoped, identity(treeNow, scopedThen, true)), undefined)
  assert.deepEqual(staleByIdentity(scoped, identity(treeNow, scopedNow, true)), {tier: 'extraction', why: 'working tree'})
  assert.equal(staleness(scoped, {records: [record(5, ['working-tree'])], head, identity: identity(treeNow, scopedThen, true)}), undefined)
  // Not verified: the whole tree decides.
  assert.deepEqual(staleByIdentity(scoped, identity(treeNow, scopedThen, false)), {tier: 'extraction', why: 'working tree'})
  assert.equal(staleByIdentity(scoped, identity(treeThen, scopedNow, false)), undefined)
  // A result taken over another scope, or without its scope identity, is compared by tree.
  const otherScope = {...scoped, sides: [{...scoped.sides[0], execution: {...scoped.sides[0].execution, scope: ['src']}}]}
  assert.deepEqual(staleByIdentity(otherScope, identity(treeNow, scopedThen, true)), {tier: 'extraction', why: 'working tree'})
  const unknown = {...scoped, sides: [{...scoped.sides[0], scopedTree: undefined}]}
  assert.deepEqual(staleByIdentity(unknown, identity(treeNow, scopedThen, true)), {tier: 'extraction', why: 'working tree'})
})

test('M5: the scope identity is each scope path’s Git object, hashed as local execution does', async () => {
  const root = await mkdtemp(join(tmpdir(), 'projections-scope-'))
  try {
    const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim()
    git('init', '--quiet')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    await mkdir(join(root, 'api'))
    await writeFile(join(root, 'api', 'index.ts'), 'export const a = 1\n')
    await writeFile(join(root, 'README.md'), 'readme\n')
    git('add', '-A')
    git('commit', '--quiet', '-m', 'one')
    const first = git('rev-parse', 'HEAD^{tree}')
    const digest1 = await scopedTreeOf(root, first, ['api', 'missing'])
    assert.equal(
      digest1,
      scopeDigest([
        ['api', git('rev-parse', `${first}:api`)],
        ['missing', undefined],
      ]),
    )
    assert.match(digest1, /^sha256:[0-9a-f]{64}$/u)
    // Outside the scope: the same identity. Inside: another.
    await writeFile(join(root, 'README.md'), 'changed\n')
    git('commit', '--quiet', '-am', 'two')
    assert.equal(await scopedTreeOf(root, git('rev-parse', 'HEAD^{tree}'), ['api', 'missing']), digest1)
    await writeFile(join(root, 'api', 'index.ts'), 'export const a = 2\n')
    git('commit', '--quiet', '-am', 'three')
    assert.notEqual(await scopedTreeOf(root, git('rev-parse', 'HEAD^{tree}'), ['api', 'missing']), digest1)
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

test('Show committed: only definition files changed is no change for a result applying the committed definition', () => {
  const files = ['.github/projections/packages.json', '.projections/other.json', 'packages/web/package.json']
  assert.deepEqual(relevantFiles({...branch, definition: 'HEAD'}, files), ['packages/web/package.json'])
  assert.deepEqual(relevantFiles({...branch, definition: 'HEAD'}, files.slice(0, 2)), [])
  // A result applying your edits read them: every file counts.
  assert.deepEqual(relevantFiles({...branch, definition: 'working-tree'}, files), files)
  assert.deepEqual(relevantFiles(branch, files), files)
})
