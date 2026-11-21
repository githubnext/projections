import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {failureMessage, missingInputNotice, missingInputNotices, reported} from '../dist/ui/notices.js'
import {FailureCard} from '../dist/ui/app/cards.js'

const noop = () => undefined

const before = '07f32353aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const after = 'd9ac67b0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const schema = 'packages/api/prisma/schema.prisma'
const document = (commit, entities, missingInputs) => ({
  projection: {id: 'database', title: 'API database schema', renderer: 'database'},
  extraction: {protocolVersion: 0, schema: 'database/v0', entities, relationships: [], ...(missingInputs ? {missingInputs} : {})},
  provenance: {revision: {kind: 'commit', ref: commit, commit, dirty: false}},
})
const table = {id: 'table:/User', kind: 'table', label: 'User', data: {}}

test('a declared input missing before shows as added, missing after as removed, as the CLI words it', () => {
  assert.deepEqual(missingInputNotices(document(before, [], [schema]), document(after, [table])), [
    "`packages/api/prisma/schema.prisma` doesn't exist at `07f32353`, so its contents show as added.",
  ])
  assert.deepEqual(missingInputNotices(document(after, [table]), document(before, [], [schema])), [
    "`packages/api/prisma/schema.prisma` doesn't exist at `07f32353`, so its contents show as removed.",
  ])
  assert.deepEqual(missingInputNotices(document(before, [], ['a', 'b']), document(after, [], ['b'])), [
    "`a` doesn't exist at `07f32353`, so its contents show as added.",
    "`b` doesn't exist at `07f32353` or `d9ac67b0`, so there is nothing of it to compare.",
  ])
  assert.deepEqual(missingInputNotices(document(before, [table]), document(after, [table])), [])
})

test('one revision without its declared inputs says the projection has nothing to show there', () => {
  assert.equal(
    missingInputNotice(document(before, [], ['b', 'c', schema])),
    "Projection `database` has nothing to show at `07f32353`: `b`, `c` and `packages/api/prisma/schema.prisma` don't exist there.",
  )
  assert.equal(missingInputNotice(document(before, [table], ['x'])), "`x` doesn't exist at `07f32353`, so its contents aren't shown.")
  assert.equal(missingInputNotice(document(before, [table])), undefined)
})

test("the failure panel shows the extractor's message once, never the runner executable's absolute path", () => {
  const binary = '/opt/checkouts/projections/opensource/packages/cli/dist/projections'
  const reported = `Extractor prisma-schema: ${schema} is not a file of the examined revision`
  assert.equal(failureMessage(`${binary} exited with exit status: 1: ${reported}\n${reported}\n`), reported)
  assert.equal(failureMessage(`${binary} exited with exit status: 1`), 'projections exited with exit status: 1')
  assert.equal(failureMessage(reported), reported)
  const job = {
    id: 'job',
    status: 'failed',
    diagnostics: [{severity: 'error', code: 'RUNNER_ERROR', path: '', message: `${binary} exited with exit status: 1: ${reported}\n`}],
    outputs: [{stdout: '', stderr: `${reported}\n`}],
  }
  const html = renderToStaticMarkup(
    createElement(FailureCard, {
      side: 'Before',
      reference: before,
      job,
      previous: false,
      other: 'after (main)',
      onDiagnostics: noop,
      onRawOutput: noop,
    }),
  )
  assert.ok(!html.includes(binary), html)
  assert.ok(!html.includes('/opt/'), html)
  assert.equal(html.split('is not a file of the examined revision').length - 1, 2, 'the message and its tooltip, once each')
  assert.ok(html.includes('Raw output'), html)
})

test('a failure reports the line that says what went wrong: Node, Python and Rust, never a location', () => {
  const node = [
    'node:internal/modules/cjs/loader:1607',
    '  throw err;',
    '  ^',
    '',
    "Error: Cannot find module '/repo/tools/missing-extractor.js'",
    '    at Module._resolveFilename (node:internal/modules/cjs/loader:1604:15)',
    'Require stack:',
    '- /repo/tools/run.js',
    '',
    'Node.js v26.12.1',
  ].join('\n')
  assert.equal(reported(node), "Error: Cannot find module '/repo/tools/missing-extractor.js'")
  assert.equal(
    failureMessage(`/opt/checkouts/projections exited with exit status: 1: ${node}`),
    "Error: Cannot find module '/repo/tools/missing-extractor.js'",
  )
  const python = [
    'Traceback (most recent call last):',
    '  File "/repo/tools/extract-flags.py", line 4, in <module>',
    '    import yaml',
    '    ^^^^^^^^^^^',
    "ModuleNotFoundError: No module named 'yaml'",
  ].join('\n')
  assert.equal(reported(python), "ModuleNotFoundError: No module named 'yaml'")
  const panic = [
    "thread 'main' panicked at src/main.rs:12:5:",
    'called `Option::unwrap()` on a `None` value',
    'note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace',
  ].join('\n')
  assert.equal(reported(panic), 'called `Option::unwrap()` on a `None` value')
  assert.equal(reported("thread 'main' panicked at 'no flags file', src/main.rs:12:5"), 'no flags file')
  assert.equal(
    reported('Extractor prisma-schema: Invalid Prisma schema at schema.prisma:89\nerror: could not compile'),
    'Extractor prisma-schema: Invalid Prisma schema at schema.prisma:89',
  )
  assert.equal(reported('src/main.rs:3:5\n\n'), undefined)
})
