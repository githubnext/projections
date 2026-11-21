// Unit tests of the comparator test view's mapping and the shared backends, loaded from source with Node's type
// stripping; one test runs them against the real CLI.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {copyFile, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {BackendPool} from '../src/backends.ts'
import {diagnosticsText, failureMessages, outcomes, runBodies} from '../src/comparator-tests/outcomes.ts'
import {listPath, repositoryPath, runPath} from '../src/comparator-tests/wire.ts'
import {parseListing, parseResults, refusalMessage} from '../src/comparator-tests/parse.ts'
import {startRunner} from '../src/runner.ts'

const noop = () => undefined

const cli = fileURLToPath(new URL(`../../../cli/dist/projections${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
const at = (line, column = 11) => ({path: 'tools/order.comparator.test.yaml', line, column})

test('a listing maps to files and located cases, dropping what is malformed', () => {
  const files = parseListing({
    files: [
      {
        path: 'tools/order.comparator.test.yaml',
        comparator: 'tools/order.comparator.yaml',
        projections: ['deps', 7],
        cases: [{id: 'core leads', name: 'core leads', location: at(4)}, {name: 'no id'}, {id: 'unlocated'}],
        diagnostics: [],
      },
      {path: '../outside.comparator.test.yaml', cases: []},
      {path: '/absolute.comparator.test.yaml', cases: []},
      {
        path: 'broken.comparator.test.yaml',
        comparator: 'broken.comparator.yaml',
        projections: [],
        cases: [],
        diagnostics: [
          {pointer: '/cases/0', message: 'A case asserts nothing', location: {path: 'broken.comparator.test.yaml', line: 4, column: 5}},
        ],
      },
    ],
  })
  assert.deepEqual(files, [
    {
      path: 'tools/order.comparator.test.yaml',
      comparator: 'tools/order.comparator.yaml',
      projections: ['deps'],
      cases: [
        {id: 'core leads', name: 'core leads', location: at(4)},
        {id: 'unlocated', name: 'unlocated'},
      ],
      diagnostics: [],
    },
    {
      path: 'broken.comparator.test.yaml',
      comparator: 'broken.comparator.yaml',
      projections: [],
      cases: [],
      diagnostics: [
        {pointer: '/cases/0', message: 'A case asserts nothing', location: {path: 'broken.comparator.test.yaml', line: 4, column: 5}},
      ],
    },
  ])
  assert.equal(diagnosticsText(files[1].diagnostics), 'A case asserts nothing (line 4)')
  assert.equal(diagnosticsText([]), undefined)
  assert.throws(() => parseListing({}), /unexpected shape/)
  for (const bad of ['', '/a', 'a/../b', 'a\\b', 'C:/a', 'a//b', './a', 'a\nb']) assert.equal(repositoryPath(bad), false, bad)
  assert.equal(repositoryPath('.github/projections/deps/compare.comparator.test.yaml'), true)
})

test('results map to outcomes: located failures with expected and actual, skips, file errors and snapshots', () => {
  const results = parseResults({
    results: [
      {
        path: 'tools/order.comparator.test.yaml',
        comparator: 'tools/order.comparator.yaml',
        projection: null,
        written: ['tools/snapshots/order.json'],
        cases: [
          {id: 'core leads', name: 'core leads', status: 'pass', location: at(4), durationMs: 12, failures: []},
          {
            id: 'billing leads',
            name: 'billing leads',
            status: 'fail',
            location: at(9),
            durationMs: 5,
            message: 'billing is not first',
            failures: [
              {
                expectation: '/cases/1/expect/order/1',
                message: 'billing is not first',
                location: at(13, 38),
                expected: ['package:billing', 'package:core'],
                actual: [3, 1],
              },
              {expectation: '/cases/1/snapshot', message: 'The snapshot differs', diff: '- a\n+ b'},
            ],
          },
          {id: 'revision', name: 'revision', status: 'skip', message: 'Needs --trust', failures: []},
          {id: 'bad status', status: 'maybe'},
        ],
      },
      {
        path: 'broken.comparator.test.yaml',
        projection: null,
        cases: [],
        diagnostics: [{message: 'Not YAML', location: {path: 'broken.comparator.test.yaml', line: 2}}],
      },
    ],
  })
  const files = outcomes(results)
  const order = files.get('tools/order.comparator.test.yaml')
  assert.deepEqual(order.written, ['tools/snapshots/order.json'])
  assert.deepEqual(order.cases.get('core leads'), {status: 'passed', durationMs: 12, messages: []})
  assert.deepEqual(order.cases.get('billing leads'), {
    status: 'failed',
    durationMs: 5,
    messages: [
      {
        message: 'billing is not first',
        location: at(13, 38),
        expected: '[\n  "package:billing",\n  "package:core"\n]',
        actual: '[\n  3,\n  1\n]',
      },
      // Without a location of its own, a failure is at its case.
      {message: 'The snapshot differs\n\n- a\n+ b', location: at(9)},
    ],
  })
  assert.deepEqual(order.cases.get('revision'), {status: 'skipped', messages: [{message: 'Needs --trust'}]})
  assert.equal(order.cases.has('bad status'), false)
  assert.deepEqual(files.get('broken.comparator.test.yaml').errors, [
    {message: 'Not YAML', location: {path: 'broken.comparator.test.yaml', line: 2, column: 1}},
  ])
  assert.deepEqual(failureMessages({id: 'x', name: 'x', status: 'fail', failures: [], message: 'Failed'}), [{message: 'Failed'}])
  assert.throws(() => parseResults({files: []}), /unexpected shape/)
})

test("several projections' runs of one file merge: a failure in any fails the case, and messages name the run", () => {
  const run = (projection, status, message) => ({
    path: 'compare.comparator.test.yaml',
    projection,
    cases: [{id: 'one', name: 'one', status, durationMs: 2, failures: message ? [{message}] : []}],
  })
  const merged = outcomes(parseResults({results: [run('a', 'pass'), run('b', 'fail', 'wrong order'), run('c', 'skip')]}))
  assert.deepEqual(merged.get('compare.comparator.test.yaml').cases.get('one'), {
    status: 'failed',
    durationMs: 6,
    messages: [{message: '[b] wrong order'}],
  })
})

test('run bodies: everything, whole files, or chosen cases merged per file, with update', () => {
  assert.deepEqual(runBodies('all', false), [{}])
  assert.deepEqual(runBodies('all', true), [{update: true}])
  assert.deepEqual(
    runBodies(
      [
        {path: 'a.comparator.test.yaml', cases: ['one']},
        {path: 'a.comparator.test.yaml', cases: ['two', 'one']},
        {path: 'b.comparator.test.yaml'},
        {path: 'b.comparator.test.yaml', cases: ['x']},
        {path: 'c.comparator.test.yaml', cases: ['y']},
        {path: 'c.comparator.test.yaml'},
      ],
      false,
    ),
    [{path: 'a.comparator.test.yaml', cases: ['one', 'two']}, {path: 'b.comparator.test.yaml'}, {path: 'c.comparator.test.yaml'}],
  )
  assert.deepEqual(runBodies([{path: 'a.comparator.test.yaml'}], true), [{path: 'a.comparator.test.yaml', update: true}])
  assert.equal(
    refusalMessage(403, {diagnostics: [{code: 'RUNNER_ERROR', message: 'Updating snapshots writes repository files: start with --trust'}]}),
    'Updating snapshots writes repository files: start with --trust',
  )
  assert.equal(refusalMessage(500, ''), 'The backend refused the run (500)')
})

/** A runner that records its stops and can be made to exit. */
function fakeRunner(name) {
  let exit
  const runner = {
    name,
    stopped: 0,
    exited: new Promise(resolve => {
      exit = resolve
    }),
    stop() {
      runner.stopped++
      exit(0)
    },
    exit: () => exit(1),
  }
  return runner
}

test('backends are shared per source, replaced on restart or exit with holders told, and stopped by the last holder', async () => {
  const started = []
  const pool = new BackendPool(
    async source => {
      const runner = fakeRunner(`${source}#${started.length}`)
      started.push(runner)
      return runner
    },
    source => source,
  )
  const panel = pool.lease('repo')
  const tests = pool.lease('repo')
  const [a, b] = await Promise.all([panel.current(), tests.current()])
  assert.equal(a, b)
  assert.equal(started.length, 1)

  const told = []
  tests.onDidChange(runner => told.push(runner.name))
  await pool.restart(source => source === 'repo', 'Trusted')
  assert.equal(a.stopped, 1)
  assert.equal(started.length, 2)
  assert.deepEqual(told, ['repo#1'])
  assert.equal(await panel.current(), started[1])
  // Other sources aren't restarted.
  const other = pool.lease('elsewhere')
  await other.current()
  await pool.restart(source => source === 'repo', 'Trusted')
  assert.equal(started.length, 4)
  assert.equal(started[2].stopped, 0)

  // A backend that exits is started again on next use, and holders hear of it.
  started[3].exit()
  await new Promise(resolve => {
    setTimeout(resolve, 0)
  })
  assert.equal((await tests.current()).name, 'repo#4')
  assert.deepEqual(told, ['repo#1', 'repo#3', 'repo#4'])

  panel.dispose()
  panel.dispose()
  assert.equal(started[4].stopped, 0)
  tests.dispose()
  await new Promise(resolve => {
    setTimeout(resolve, 0)
  })
  assert.equal(started[4].stopped, 1)
  assert.equal(pool.held('repo'), false)
  await assert.rejects(tests.current(), /released/)
  other.dispose()
  await new Promise(resolve => {
    setTimeout(resolve, 0)
  })
  assert.equal(started[2].stopped, 1)
})

test('a backend that fails to start is tried again on next use', async () => {
  let attempts = 0
  const pool = new BackendPool(
    async () => {
      if (++attempts === 1) throw new Error('no CLI')
      return fakeRunner('ok')
    },
    source => source,
  )
  const lease = pool.lease('repo')
  await assert.rejects(lease.current(), /no CLI/)
  assert.equal((await lease.current()).name, 'ok')
  lease.dispose()
})

test('the real backend lists comparator tests and runs them: a pass, and a failure at its line', {skip: !existsSync(cli)}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'projections-vscode-tests-'))
  try {
    const example = fileURLToPath(new URL('../../../../examples/comparators/priority-order/', import.meta.url))
    await mkdir(path.join(root, 'tools/fixtures'), {recursive: true})
    await copyFile(path.join(example, 'priority-order.comparator.yaml'), path.join(root, 'tools/order.comparator.yaml'))
    for (const name of ['before.json', 'after.json']) {
      await copyFile(path.join(example, 'fixtures', name), path.join(root, 'tools/fixtures', name))
    }
    await writeFile(
      path.join(root, 'tools/order.comparator.test.yaml'),
      [
        'format: projections.comparator-tests',
        'version: 0',
        'options:',
        '  priority: [package:@acme/core]',
        'cases:',
        '  - name: core leads',
        '    before: fixtures/before.json',
        '    after: fixtures/after.json',
        '    expect:',
        '      order: [package:@acme/core, package:@acme/docs-site]',
        '  - name: billing leads',
        '    before: fixtures/before.json',
        '    after: fixtures/after.json',
        '    expect:',
        '      order: [package:@acme/billing, package:@acme/core]',
        '',
      ].join('\n'),
    )
    execFileSync('git', ['init', '--quiet'], {cwd: root})
    const runner = await startRunner({executable: cli, repository: root, trust: false, log: noop})
    try {
      const listed = parseListing((await runner.request({method: 'GET', path: listPath})).body)
      assert.deepEqual(
        listed.map(file => [file.path, file.cases.map(item => [item.id, item.location.line])]),
        [
          [
            'tools/order.comparator.test.yaml',
            [
              ['core leads', 6],
              ['billing leads', 11],
            ],
          ],
        ],
      )
      const ran = outcomes(parseResults((await runner.request({method: 'POST', path: runPath, body: runBodies('all', false)[0]})).body))
      const cases = ran.get('tools/order.comparator.test.yaml').cases
      assert.equal(cases.get('core leads').status, 'passed')
      const failed = cases.get('billing leads')
      assert.equal(failed.status, 'failed')
      assert.equal(failed.messages[0].location.line, 15)
      assert.match(failed.messages[0].message, /package:@acme\/billing/)
      assert.ok(failed.messages[0].expected.includes('package:@acme/billing'))
      // Writing snapshots needs --trust.
      const update = await runner.request({method: 'POST', path: runPath, body: runBodies('all', true)[0]})
      assert.equal(update.status, 403)
      assert.match(refusalMessage(update.status, update.body), /--trust/)
    } finally {
      runner.stop()
      await runner.exited
    }
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})
