// `projections serve --stdio`: the Inspector API as JSON-RPC over standard input and output, in a fixture repository.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {access, readFile, realpath, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {createInterface} from 'node:readline'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {executionEnvironment, runBounded} from './process.mjs'
import {commit, fixture, legacyDefinition} from './repository.mjs'

const executable = fileURLToPath(new URL('../dist/projections', import.meta.url))

/** Starts `serve --stdio` in `root` with a JSON-RPC client. Every stdout line must be a JSON-RPC 2.0 message. */
function serve(t, root, args = []) {
  const child = spawn(executable, ['serve', '--stdio', ...args], {
    cwd: root,
    env: executionEnvironment(process.env),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', bytes => (stderr += String(bytes)))
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})))
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  })
  const pending = new Map()
  const notifications = []
  const waiters = new Set()
  const invalid = []
  createInterface({input: child.stdout}).on('line', line => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      invalid.push(line)
      return
    }
    if (message?.jsonrpc !== '2.0') invalid.push(line)
    if (message.method) {
      notifications.push(message)
      for (const waiter of waiters) waiter()
      return
    }
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  })
  let nextId = 1
  const send = message => child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', ...message})}\n`)
  const call = (method, params) => {
    const id = nextId++
    return {
      id,
      reply: new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`No reply to ${method} ${JSON.stringify(params)}\n${stderr}`)), 60_000)
        pending.set(id, message => (clearTimeout(timer), resolve(message)))
        send({id, method, ...(params === undefined ? {} : {params})})
      }),
    }
  }
  /** `request`'s result, `{status, contentType, body}`. */
  const request = async (method, requestPath, body) => {
    const message = await call('request', {method, path: requestPath, ...(body === undefined ? {} : {body})}).reply
    assert.equal(message.error, undefined, JSON.stringify(message.error))
    return message.result
  }
  const notification = (predicate, timeoutMs = 20_000) =>
    new Promise((resolve, reject) => {
      const check = () => {
        const found = notifications.find(predicate)
        if (!found) return
        waiters.delete(check)
        clearTimeout(timer)
        resolve(found)
      }
      const timer = setTimeout(() => {
        waiters.delete(check)
        reject(new Error(`No notification after ${timeoutMs} ms: ${JSON.stringify(notifications)}`))
      }, timeoutMs)
      waiters.add(check)
      check()
    })
  return {child, exited, call, send, request, notification, invalid, stderr: () => stderr}
}

async function poll(read, done, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) assert.fail(`Timed out polling: ${JSON.stringify(value).slice(0, 2000)}`)
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}

test('serve --stdio answers the Inspector API as JSON-RPC, notifies changes and exits when stdin closes', async t => {
  const {root, before} = await fixture(t)
  // No projections of its own: an explore session, whose candidates are trial definitions.
  for (const directory of ['.projections', '.github']) await rm(path.join(root, directory), {recursive: true})
  const services = JSON.parse(await readFile(path.join(root, 'services.json'), 'utf8'))
  services.services.push({name: 'queue', language: 'Go', dependencies: []})
  await writeFile(path.join(root, 'services.json'), JSON.stringify(services))
  await writeFile(path.join(root, 'queue.go'), 'package queue\n')
  const after = commit(root)
  const backend = serve(t, root)

  const initialized = await backend.call('initialize').reply
  assert.deepEqual(initialized.result, {
    protocol: 1,
    version: initialized.result.version,
    repository: await realpath(root),
    trusted: false,
    explore: true,
    mode: 'repository',
  })

  const definitions = await backend.request('GET', '/api/definitions?ref=working-tree')
  assert.equal(definitions.status, 200)
  assert.match(definitions.contentType, /^application\/json/)
  const ids = definitions.body.definitions.map(definition => definition.id)
  assert.ok(ids.includes('repository-map') && !ids.includes('services-node'), ids.join())
  assert.equal(definitions.body.executionAuthorized, false)
  const revisions = await backend.request('GET', '/api/revisions?limit=5')
  assert.deepEqual(
    revisions.body.revisions.map(revision => revision.commit),
    [after, after, before],
  )
  const pairs = await backend.request('GET', '/api/pairs?projection=repository-map')
  assert.equal(pairs.body.head.commit, after)
  // HTTP-level refusals are results, not JSON-RPC errors.
  const missing = await backend.request('GET', '/api/nothing')
  assert.equal(missing.status, 404)
  assert.match(missing.body.diagnostics[0].message, /Unknown Inspector API route/)
  const undefinedProjection = await backend.request('POST', '/api/jobs', {projectionId: 'nothing', before: 'HEAD'})
  assert.equal(undefinedProjection.status, 202)
  const failed = await poll(
    () => backend.request('GET', `/api/jobs/${undefinedProjection.body.id}`),
    job => job.body.status !== 'running',
  )
  assert.equal(failed.body.status, 'failed')

  // A built-in projection's extraction job, polled to completion.
  const started = await backend.request('POST', '/api/jobs', {projectionId: 'repository-map', before: 'working-tree'})
  assert.equal(started.status, 202)
  const job = await poll(
    () => backend.request('GET', `/api/jobs/${started.body.id}`),
    job => job.body.status !== 'running',
  )
  assert.equal(job.body.status, 'completed', JSON.stringify(job.body.diagnostics))
  assert.equal(job.body.extraction.format, 'projections.extraction')
  assert.ok(job.body.extraction.extraction.entities.some(entity => entity.label === 'queue.go'))

  const explore = await backend.request('GET', '/api/explore')
  assert.equal(explore.body.session, true)
  assert.ok(explore.body.candidates.some(candidate => candidate.id === 'repository-map'))

  // A sweep of the last change, and its Diff thumbnail as PNG base64.
  const sweep = await backend.request('POST', '/api/sweep', {projections: ['repository-map'], last: 1})
  assert.equal(sweep.status, 202)
  const swept = await poll(
    () => backend.request('GET', '/api/sweep'),
    result => result.body.sweep.status !== 'running',
  )
  assert.equal(swept.body.sweep.status, 'completed', swept.body.sweep.error)
  const cell = swept.body.sweep.cells.find(cell => cell.projection === 'repository-map' && cell.before === before)
  assert.ok(cell, JSON.stringify(swept.body.sweep.cells))
  const query = new URLSearchParams({projection: 'repository-map', before: cell.before, after: cell.after})
  const thumbnail = await backend.request('GET', `/api/sweep/thumbnail?${query}`)
  if (thumbnail.status === 400 && /browser/i.test(JSON.stringify(thumbnail.body)))
    t.diagnostic(`No browser for thumbnails: ${JSON.stringify(thumbnail.body)}`)
  else {
    assert.equal(thumbnail.status, 200, JSON.stringify(thumbnail.body))
    assert.equal(thumbnail.contentType, 'image/png')
    assert.deepEqual([...Buffer.from(thumbnail.body.base64, 'base64').subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  }

  // Adopting previews without writing; writing needs the preview's digest.
  const preview = await backend.request('POST', '/api/adopt', {projections: ['repository-map'], dryRun: true, bookmarks: 0})
  assert.equal(preview.status, 200, JSON.stringify(preview.body))
  assert.match(preview.body.digest, /^sha256:/)
  await assert.rejects(access(path.join(root, '.github/projections/repository-map.json')))
  const stale = await backend.request('POST', '/api/adopt', {projections: ['repository-map'], digest: 'sha256:0', bookmarks: 0})
  assert.equal(stale.status, 409)
  // Saving a definition still needs --trust.
  const save = await backend.request('POST', '/api/definition', {projectionId: 'repository-map', parts: {}, digest: 'x'})
  assert.equal(save.status, 403)

  // A long poll of /api/changes is cancelled at once.
  const generation = (await backend.request('GET', '/api/changes?since=0')).body.generation
  const poll1 = backend.call('request', {method: 'GET', path: `/api/changes?since=${generation}`})
  await new Promise(resolve => setTimeout(resolve, 200))
  const cancelledAt = Date.now()
  backend.send({method: '$/cancelRequest', params: {id: poll1.id}})
  const cancelled = await poll1.reply
  assert.equal(cancelled.error.code, -32800)
  assert.ok(Date.now() - cancelledAt < 5000)

  // Writing a file sends a `changes` notification.
  await writeFile(path.join(root, 'notes.txt'), 'changed\n')
  const changed = await backend.notification(
    message => message.method === 'changes' && message.params.generation > generation && message.params.changes.includes('working-tree'),
  )
  assert.equal(changed.params.complete, true)

  // Invalid messages are JSON-RPC errors; requests outside the API are refused.
  const outside = await backend.call('request', {method: 'GET', path: '/index.html'}).reply
  assert.equal(outside.error.code, -32602)
  const unknown = await backend.call('nothing').reply
  assert.equal(unknown.error.code, -32601)

  backend.child.stdin.end()
  const exit = await Promise.race([backend.exited, new Promise(resolve => setTimeout(() => resolve('timeout'), 15_000).unref())])
  assert.deepEqual(exit, {code: 0, signal: null}, backend.stderr())
  assert.deepEqual(backend.invalid, [])
})

test('serve --stdio stops on shutdown and exit, honors --trust, and requires --stdio', async t => {
  const {root} = await fixture(t)
  const backend = serve(t, root, ['--trust'])
  // The repository defines projections: not an explore session, and only they are listed.
  assert.deepEqual((await backend.call('initialize').reply).result, {
    protocol: 1,
    version: (await backend.call('initialize').reply).result.version,
    repository: await realpath(root),
    trusted: true,
    explore: false,
    mode: 'repository',
  })
  const definitions = (await backend.request('GET', '/api/definitions')).body
  assert.equal(definitions.executionAuthorized, true)
  assert.deepEqual(
    definitions.definitions.map(definition => definition.id),
    ['services-node', 'services-python'],
  )
  const explore = (await backend.request('GET', '/api/explore')).body
  assert.equal(explore.session, false)
  assert.ok(explore.candidates.some(candidate => candidate.id === 'repository-map'))
  // The Explore view opens a candidate: listed when asked for, and it extracts.
  const included = (await backend.request('GET', '/api/definitions?ref=working-tree&include=repository-map')).body
  assert.deepEqual(
    included.definitions.map(definition => definition.id),
    ['services-node', 'services-python', 'repository-map'],
  )
  assert.equal(included.policies.length, 3)
  assert.equal((await backend.request('GET', '/api/definitions?include=..')).status, 400)
  const candidate = await backend.request('POST', '/api/jobs', {projectionId: 'repository-map', before: 'working-tree'})
  const candidateJob = await poll(
    () => backend.request('GET', `/api/jobs/${candidate.body.id}`),
    job => job.body.status !== 'running',
  )
  assert.equal(candidateJob.body.status, 'completed', JSON.stringify(candidateJob.body.diagnostics))
  const job = await backend.request('POST', '/api/jobs', {projectionId: 'services-node', before: 'HEAD'})
  const extracted = await poll(
    () => backend.request('GET', `/api/jobs/${job.body.id}`),
    job => job.body.status !== 'running',
  )
  assert.equal(extracted.body.status, 'completed', JSON.stringify(extracted.body.diagnostics))
  assert.equal((await backend.call('shutdown').reply).result, null)
  const refused = await backend.call('request', {method: 'GET', path: '/api/revisions'}).reply
  assert.equal(refused.error.code, -32600)
  backend.send({method: 'exit'})
  assert.deepEqual(await backend.exited, {code: 0, signal: null})
  assert.deepEqual(backend.invalid, [])
  const failure = await runBounded(executable, ['serve'], {label: 'serve', cwd: root, env: executionEnvironment(process.env)}).then(
    () => assert.fail('serve without --stdio must fail'),
    error => error,
  )
  assert.match(failure.output.stderr, /needs --stdio/)
  assert.equal(failure.output.stdout, '')
})

test(
  'without --trust or an explore session, writes and repository code are refused; SIGTERM stops it',
  {skip: process.platform === 'win32'},
  async t => {
    const {root} = await fixture(t)
    const backend = serve(t, root)
    assert.equal((await backend.call('initialize').reply).result.explore, false)
    const adopt = await backend.request('POST', '/api/adopt', {projections: ['repository-map'], digest: 'sha256:0'})
    assert.equal(adopt.status, 403)
    assert.match(JSON.stringify(adopt.body), /explore session/)
    const job = await backend.request('POST', '/api/jobs', {projectionId: 'services-node', before: 'HEAD'})
    const refused = await poll(
      () => backend.request('GET', `/api/jobs/${job.body.id}`),
      job => job.body.status !== 'running',
    )
    assert.equal(refused.body.diagnostics[0].code, 'TRUST_REQUIRED')
    backend.child.kill('SIGTERM')
    const [code] = await once(backend.child, 'exit')
    assert.equal(code, 0)
  },
)

test('serve --stdio lists every valid definition beside an invalid one, with its diagnostic and line', async t => {
  const {root} = await fixture(t)
  await writeFile(path.join(root, '.github/projections/legacy.json'), legacyDefinition)
  const backend = serve(t, root)
  await backend.call('initialize').reply
  const definitions = await backend.request('GET', '/api/definitions?ref=working-tree')
  assert.equal(definitions.status, 200)
  assert.deepEqual(definitions.body.definitions.map(item => item.id).sort(), ['services-node', 'services-python'])
  assert.deepEqual(
    definitions.body.invalid.map(item => [item.id, item.path, item.diagnostics[0].location.line, item.diagnostics[0].pointer]),
    [['legacy', '.github/projections/legacy.json', 7, '/comparator/module']],
  )
  // A good projection still extracts; the bad one's job reports its diagnostic.
  const good = await backend.request('POST', '/api/jobs', {projectionId: 'services-node', before: 'HEAD'})
  assert.equal(good.status, 202)
  await poll(
    () => backend.request('GET', `/api/jobs/${good.body.id}`),
    job => job.body.status !== 'running',
  )
  const bad = await backend.request('POST', '/api/jobs', {projectionId: 'legacy', before: 'working-tree'})
  const finished =
    bad.status === 202
      ? await poll(
          () => backend.request('GET', `/api/jobs/${bad.body.id}`),
          job => job.body.status !== 'running',
        )
      : bad
  assert.match(JSON.stringify(finished.body), /Module comparators were removed/)
})

test('serve --stdio presents a saved document, or renderer scenarios with their custom comparators, running nothing', async t => {
  const {root, before} = await fixture(t)
  const saved = path.join(root, 'saved.json')
  await writeFile(
    saved,
    (
      await runBounded(executable, ['show', before, '-p', 'services-node', '--trust', '--json'], {
        label: 'show',
        cwd: root,
        env: executionEnvironment(process.env),
      })
    ).stdout,
  )
  const document = serve(t, root, ['--document', saved])
  assert.equal((await document.call('initialize').reply).result.mode, 'document')
  assert.equal((await document.request('GET', '/api/document')).body.document.format, 'projections.extraction')
  assert.equal((await document.request('POST', '/api/jobs', {projectionId: 'services-node', before: 'HEAD'})).status, 403)
  document.child.stdin.end()
  assert.equal((await document.exited).code, 0)

  const scenarios = fileURLToPath(new URL('../../renderers/api/', import.meta.url))
  const fixtures = serve(t, root, [
    '--fixtures',
    scenarios,
    '--renderer',
    fileURLToPath(new URL('../../renderers/api/dist/', import.meta.url)),
  ])
  assert.equal((await fixtures.call('initialize').reply).result.mode, 'fixtures')
  const catalog = (await fixtures.request('GET', '/api/fixtures')).body
  const rules = catalog.scenarios.find(scenario => scenario.comparator?.rules && !scenario.error)
  assert.ok(rules, JSON.stringify(catalog.scenarios.map(scenario => scenario.comparator)).slice(0, 500))
  const renderer = catalog.renderers.find(item => item.url)
  assert.ok(renderer, JSON.stringify(catalog.renderers).slice(0, 500))
  const bundle = await fixtures.request('GET', new URL(renderer.url, 'http://stdio.invalid').pathname)
  assert.equal(bundle.status, 200)
  assert.match(bundle.contentType, /^text\/html/)
  fixtures.child.stdin.end()
  assert.equal((await fixtures.exited).code, 0)
  assert.deepEqual([...document.invalid, ...fixtures.invalid], [])
  await assert.rejects(
    runBounded(executable, ['serve', '--stdio', '--trust', '--document', saved], {
      label: 'serve',
      cwd: root,
      env: executionEnvironment(process.env),
    }),
    /cannot be used with/,
  )
})
