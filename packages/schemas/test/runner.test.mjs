import assert from 'node:assert/strict'
import {test} from 'node:test'
import {decodeRunnerResponse, RunnerResponseError} from '../dist/runner/index.js'

const rejects = (name, value, request, pointer) =>
  assert.throws(
    () => decodeRunnerResponse(name, value),
    error =>
      error instanceof RunnerResponseError && error.request === request && error.pointer === pointer && error.message.includes(pointer),
  )

const change = {before: 'a', after: 'b', title: 'Change', number: null, kind: 'commit', date: '2026-01-01T00:00:00Z'}
const candidate = {
  id: 'repository-map',
  title: 'Repository map',
  description: 'Files',
  extractor: 'repository-map',
  schema: 'treemap/v0',
  renderer: 'treemap',
  requiresTrust: false,
  basis: {pattern: '**/*', count: 2, examples: ['a.ts']},
  adopted: null,
  definition: {id: 'repository-map', extractor: 'repository-map', renderer: 'treemap'},
}
const sweep = {id: 's', status: 'completed', error: null, changes: [change], projections: [{projection: 'map', status: 'ready'}], cells: []}
const cell = {projection: 'map', before: 'a', after: 'b', status: 'changed', changes: 1, steps: 1, counts: {added: 1}}

test('a well-formed response decodes as itself, with opaque documents passed through', () => {
  const explore = {session: true, candidates: [candidate]}
  assert.equal(decodeRunnerResponse('explore', explore), explore)
  assert.equal(decodeRunnerResponse('sweep', {sweep: {...sweep, cells: [cell]}}).sweep.cells[0], cell)
  const document = {format: 'projections.extraction', version: 0, extraction: {anything: true}}
  assert.equal(decodeRunnerResponse('document', {document}).document, document)
})

test('a malformed nested entry is a boundary error naming the request and its JSON pointer', () => {
  rejects('adopt', {files: [null], digest: 'sha256:00', written: false}, 'POST /api/adopt', '/files/0')
  const {basis: _, ...unexplained} = candidate
  rejects('explore', {session: false, candidates: [candidate, unexplained]}, 'GET /api/explore', '/candidates/1')
  rejects('sweep', {sweep: {...sweep, cells: [{...cell, changes: 'one'}]}}, 'GET /api/sweep', '/sweep/cells/0/changes')
  rejects('document', {document: {format: 'projections.snapshot', version: 0}}, 'GET /api/document', '/document/format')
  assert.throws(() => decodeRunnerResponse('sweep', {sweep: {...sweep, cells: [{...cell, status: 'skipped'}]}}), {
    message: `The local runner's response to GET /api/sweep is invalid at /sweep/cells/0/status: must be one of "changed", "unchanged", "failed"`,
  })
  assert.throws(() => decodeRunnerResponse('pairs', null), {message: /GET \/api\/pairs is invalid at its root: must be object/})
})
