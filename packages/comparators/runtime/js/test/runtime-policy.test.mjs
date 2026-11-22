// The runtime policy comparator (packages/comparators/runtime-policy), a realistic rules file: its CEL functions evaluated in
// the rules interpreter's Worker, as browser hosts run them.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import {createRulesRuntime} from '@githubnext/projections-comparator-runtime'
import {createNativeEngine} from '@githubnext/projections-engine/native'

const engine = createNativeEngine()
const runtime = createRulesRuntime()
const text = readFileSync(new URL('../../../runtime-policy/runtime-policy.comparator.yaml', import.meta.url), 'utf8')
const rules = new TextEncoder().encode(text)
const fixtures = new URL('../../../../extractors/tetragon-policies/tests/fixtures/credentials/', import.meta.url)
const load = name => JSON.parse(readFileSync(new URL(name, fixtures), 'utf8'))
const before = load('before.expected.json')
const after = load('after.expected.json')
const empty = {protocolVersion: 0, schema: 'graph/v0', entities: [], relationships: []}

/** Runs the rules in the interpreter's Worker, as the Inspector and other browser hosts do, and has the Engine validate the comparison. */
async function run(before, after, options = {}) {
  const baseline = await engine.compare(before, after)
  const comparison = await runtime.compare(rules, {protocolVersion: 0, before, after, baseline, options})
  await engine.validateComparison(before, after, comparison)
  return {baseline, comparison}
}

/** The value of a CEL expression over the rules' functions, evaluated as a metadata value of the rules. */
async function evaluate(expression) {
  const probe = new TextEncoder().encode(`${text.trimEnd()}\n    probe: ${JSON.stringify(expression)}\n`)
  const comparison = await runtime.compare(probe, {
    protocolVersion: 0,
    before: empty,
    after: empty,
    baseline: {protocolVersion: 0, changes: [], steps: []},
    options: {},
  })
  return comparison.metadata.probe
}

const policy = 'policy:tetragon:TracingPolicy:protect-credentials'
const guard = 'selector:tetragon:TracingPolicy:protect-credentials/kprobe:security_file_permission/token-read-by-downloader'

test('interprets the credentials pull request: enforcement first, then scope, then coverage', async () => {
  const {baseline, comparison} = await run(before, after)
  const {interpretations} = comparison.metadata.runtimePolicy
  assert.deepEqual(interpretations[guard], ['newly-enforced'])
  assert.deepEqual(interpretations[policy], ['scope-broadened'])
  assert.deepEqual(interpretations['hook:kprobe:security_mmap_file'], ['coverage-lost'])
  assert.ok(comparison.steps[0].changes.includes(guard), 'the newly enforced rule is presented first')
  assert.equal(
    comparison.changes.find(change => change.id === guard).summary,
    '`protect-credentials` rule `token-read-by-downloader` at `security_file_permission` now enforces: Kill (`Sigkill`) for `/usr/bin/curl` or `/usr/bin/wget` when `arg0` (`file`) starts with `/var/run/secrets/kubernetes.io/serviceaccount` and `arg1` (`int`) = `4`.',
  )
  assert.equal(
    comparison.changes.find(change => change.id === policy).summary,
    'Policy `protect-credentials` now applies to more workloads: pods where `app.kubernetes.io/part-of in (checkout, payments)`.',
  )
  // Correspondence and statuses are the baseline's.
  assert.deepEqual(
    comparison.changes.map(({summary, ...change}) => change),
    baseline.changes.map(({summary, ...change}) => change),
  )
  assert.deepEqual(new Set(comparison.steps.flatMap(step => step.changes)), new Set(baseline.steps.flatMap(step => step.changes)))
})

test('the reverse comparison narrows scope and removes enforcement', async () => {
  const {comparison} = await run(after, before)
  const {interpretations} = comparison.metadata.runtimePolicy
  assert.deepEqual(interpretations[guard], ['enforcement-removed'])
  assert.deepEqual(interpretations[policy], ['scope-narrowed'])
  assert.deepEqual(interpretations['hook:kprobe:security_mmap_file'], ['newly-covered'])
})

test('a switch to monitor mode reports the policy mode and the elided enforcement', async () => {
  const monitored = structuredClone(after)
  for (const entity of monitored.entities) {
    if (entity.id === policy) entity.data.mode = 'monitor'
    if (entity.id === guard) entity.data.enforcement = 'elided'
  }
  const {comparison} = await run(after, monitored)
  const {interpretations} = comparison.metadata.runtimePolicy
  assert.deepEqual(interpretations[policy], ['mode-changed'])
  assert.deepEqual(interpretations[guard], ['enforcement-elided'])
})

test('identical extractions need no interpretation', async () => {
  const {comparison} = await run(after, after)
  assert.deepEqual(comparison.metadata.runtimePolicy.interpretations, {})
})

test('options are rejected', async () => {
  await assert.rejects(run(before, after, {x: 1}), /takes none/u)
})

const requirement = (key, operator, values = []) => ({key, operator, values})
const pods = (...requirements) => ({all: false, host: false, namespace: null, pods: requirements, containers: null})

test('binary filters name the processes they match, as code', async () => {
  const binaries = filters => evaluate(`binaries({'data': {'binaries': ${JSON.stringify(filters)}}})`)
  assert.equal(await binaries([]), '')
  assert.equal(
    await binaries([{operator: 'NotIn', values: ['/usr/local/bin/acme-server']}]),
    'binaries other than `/usr/local/bin/acme-server`',
  )
  assert.equal(
    await binaries([
      {operator: 'Prefix', values: ['/tmp/', '/dev/shm/'], followChildren: true},
      {operator: 'In', values: ['/bin/sh'], parent: true},
      {operator: 'NotPrefix', values: ['/usr/'], parent: true, followChildren: true},
    ]),
    'binaries starting with `/tmp/` or `/dev/shm/` and their children and children of `/bin/sh` and descendants of binaries not starting with `/usr/`',
  )
})

const scopeChange = (old, scope) => evaluate(`scopeChange(${JSON.stringify(old)}, ${JSON.stringify(scope)})`)
const covers = (outer, inner) => evaluate(`covers(${JSON.stringify(outer)}, ${JSON.stringify(inner)})`)

test('scope containment is decided only where it is provable', async () => {
  const payments = pods(requirement('app', 'In', ['payments']))
  const both = pods(requirement('app', 'In', ['checkout', 'payments']))
  assert.equal(await scopeChange(payments, both), 'scope-broadened')
  assert.equal(await scopeChange(both, payments), 'scope-narrowed')
  assert.equal(await scopeChange(payments, pods()), 'scope-broadened', 'every pod includes some pods')
  assert.equal(await scopeChange(payments, {all: true}), 'scope-broadened')
  assert.equal(await scopeChange(payments, pods(requirement('tier', 'In', ['web']))), 'scope-changed')
  assert.equal(
    await scopeChange(pods(requirement('app', 'NotIn', ['a', 'b'])), pods(requirement('app', 'NotIn', ['a']))),
    'scope-broadened',
  )
  assert.equal(await scopeChange(payments, pods(requirement('app', 'Exists'))), 'scope-broadened')
  assert.equal(await scopeChange({...payments, host: true}, payments), 'scope-narrowed')
  const namespaced = namespace => ({...pods(), namespace})
  assert.equal(await scopeChange(namespaced('a'), namespaced('b')), 'scope-changed')
  assert.equal(await scopeChange(namespaced('a'), pods()), 'scope-broadened', 'every pod includes one namespace')
  assert.ok(await covers({...pods(), containers: []}, {...pods(), containers: [requirement('name', 'In', ['web'])]}))
  assert.ok(!(await covers({...pods(), containers: [requirement('name', 'In', ['web'])]}, pods())))
})

test('enrichment changes are interpreted: a new warning and the agent configuration', async () => {
  const deployment = name =>
    JSON.parse(
      readFileSync(
        new URL(`../../../../extractors/tetragon-policies/tests/fixtures/deployment/${name}.expected.json`, import.meta.url),
        'utf8',
      ),
    )
  const {comparison} = await run(deployment('before'), deployment('after'))
  const {interpretations} = comparison.metadata.runtimePolicy
  assert.deepEqual(interpretations['agent:tetragon'], ['agent-changed'])
  assert.deepEqual(interpretations[policy], ['scope-broadened', 'warning-added'])
  assert.ok(interpretations['policy:tetragon:TracingPolicyNamespaced:payments:shell-guard'].includes('warning-added'))
  assert.match(
    comparison.changes.find(change => change.id === 'agent:tetragon').summary,
    /\x60policyFilter\x60: \x60true\x60 → \x60false\x60/u,
  )
})
