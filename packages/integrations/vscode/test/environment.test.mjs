// Unit tests of the environment's VS Code side, loaded from source with Node's type stripping: preparing through a
// backend, the output channel's lines, the workspace setting's arguments and provenance badges.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {eventLine, prepareEnvironment, provenanceBadge, workspaceArguments} from '../src/environment-model.ts'

const noop = () => undefined

test('preparing starts a run, reports each new event once and returns the finished run', async () => {
  const requests = []
  const states = [
    {id: 'r1', status: 'running', events: [{step: 'install', event: 'start', run: ['npm', 'ci'], log: '/l/install.log'}]},
    {
      id: 'r1',
      status: 'succeeded',
      events: [
        {step: 'install', event: 'start', run: ['npm', 'ci'], log: '/l/install.log'},
        {step: 'install', event: 'succeeded', durationMs: 1500},
      ],
      report: {target: 'working-tree', root: '/repo', steps: [{id: 'install', status: 'succeeded', durationMs: 1500}]},
    },
  ]
  const runner = {
    async request(request) {
      requests.push(request)
      if (request.method === 'POST') {
        return {status: 202, contentType: 'application/json', body: {id: 'r1', status: 'running', events: []}, size: 1}
      }
      return {status: 200, contentType: 'application/json', body: states.shift(), size: 1}
    },
  }
  const lines = []
  const run = await prepareEnvironment(runner, {revision: 'main', force: true}, line => lines.push(line), undefined, 1)
  assert.equal(run.status, 'succeeded')
  assert.deepEqual(requests[0], {method: 'POST', path: '/api/prepare', body: {revision: 'main', force: true}})
  assert.deepEqual(lines, ['▶ install: npm ci (log: /l/install.log)', '✓ install: done in 1.5 s'])
})

test("a refused preparation fails with the backend's reason, and aborting cancels it in the backend", async () => {
  const refused = {request: async () => ({status: 403, contentType: 'application/json', body: {error: 'trust the workspace'}, size: 1})}
  await assert.rejects(prepareEnvironment(refused, {}, noop), /trust the workspace/u)
  const requests = []
  const abort = new AbortController()
  const slow = {
    async request(request) {
      requests.push(request)
      if (request.path === '/api/prepare') return {status: 202, contentType: 'application/json', body: {id: 'r2'}, size: 1}
      if (request.path.endsWith('/cancel')) return {status: 200, contentType: 'application/json', body: {}, size: 1}
      abort.abort()
      return {
        status: 200,
        contentType: 'application/json',
        body: {id: 'r2', status: requests.some(r => r.path.endsWith('/cancel')) ? 'cancelled' : 'running', events: []},
        size: 1,
      }
    },
  }
  const run = await prepareEnvironment(slow, {}, noop, abort.signal, 1)
  assert.equal(run.status, 'cancelled')
  assert.ok(requests.some(request => request.method === 'POST' && request.path === '/api/prepare/r2/cancel'))
})

test('event lines, workspace arguments and provenance badges', () => {
  assert.equal(
    eventLine({step: 'install', event: 'skip', reason: 'its key files are unchanged'}),
    '✓ install: up to date (its key files are unchanged)',
  )
  assert.equal(eventLine({step: 'install', event: 'failed', error: 'exited with 3'}), '✗ install: exited with 3')
  assert.deepEqual(workspaceArguments('clone'), ['--workspace', 'clone'])
  assert.deepEqual(workspaceArguments(''), [])
  assert.deepEqual(workspaceArguments('magic'), [])
  const document = execution => ({provenance: {execution}})
  assert.equal(
    provenanceBadge(document({source: 'ci', fidelity: 'exact', official: true, ci: {repository: 'o/r', run: 4}})).label,
    'From CI',
  )
  // An artifact nothing authenticated (an imported directory) is labelled imported, never official.
  const imported = provenanceBadge(document({source: 'ci', fidelity: 'exact', official: false, ci: {repository: 'o/r', run: 4}}))
  assert.equal(imported.label, 'Imported')
  assert.match(imported.detail, /^Imported from an artifact that names CI run 4 of o\/r; unauthenticated/u)
  assert.equal(provenanceBadge(document({source: 'ci', fidelity: 'exact', ci: {repository: 'o/r', run: 4}})).label, 'Imported')
  assert.equal(provenanceBadge(document({source: 'local-in-place', fidelity: 'stale'})).label, 'Stale')
  assert.equal(provenanceBadge(document({source: 'local-workspace', fidelity: 'approximate'})).label, 'Approximate')
  assert.equal(
    provenanceBadge(document({source: 'local-in-place', fidelity: 'exact', determinism: 'observed', at: '2026-01-01T00:00:00Z'})).label,
    'Observed',
  )
  const local = provenanceBadge(document({source: 'local-workspace', strategy: 'worktree', fidelity: 'exact', at: '2026-01-01T00:00:00Z'}))
  assert.equal(local.label, 'Local')
  assert.equal(local.detail, 'Extracted on this machine in a worktree workspace at 2026-01-01T00:00:00Z.')
  assert.equal(provenanceBadge({provenance: {}}), undefined)
})
