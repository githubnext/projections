// The commands through incur, in-process, against the fixture repository: output envelopes, schemas and exit codes.
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import type {docsRead, docsSearch} from '../src/commands/docs.ts'
import type {feedbackReport} from '../src/commands/feedback.ts'
import type {contextReport, explainReport, mapReport} from '../src/commands/info.ts'
import type {checkReport} from '../src/commands/work/check.ts'
import type {generatedList} from '../src/commands/work/generated.ts'

// The CLI reads the root when it loads, so it is imported after setting it.
process.env.TOOLS_ROOT = fileURLToPath(new URL('fixtures/repo/', import.meta.url))
const {default: cli, exitCodes} = await import('../src/cli.ts')

async function run(argv: string[]): Promise<{output: string; exit: number}> {
  let output = ''
  let exit = 0
  const before = process.exitCode
  process.exitCode = undefined
  await cli.serve(argv, {
    stdout: text => {
      output += text
    },
    exit: code => {
      exit = code
    },
  })
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unnecessary-type-conversion -- serve sets it during the await
  exit ||= Number(process.exitCode ?? 0)
  process.exitCode = before
  return {output, exit}
}

// What a command prints with --json: its report, or the envelope of the error that stopped it.
type Report<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>
interface Failure {
  code: string
  message: string
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- Callers name the command's report type, as `JSON.parse(output) as T` would.
async function runJson<T>(argv: string[]): Promise<{json: T; exit: number}> {
  const {output, exit} = await run(argv)
  return {json: JSON.parse(output) as T, exit}
}

test('map: every unit with its description, flag and dependencies', async () => {
  const {json, exit} = await runJson<Report<typeof mapReport>>(['map', '--json'])
  assert.equal(exit, 0)
  assert.equal(json.count, 4)
  assert.deepEqual(json.units[0], {
    path: 'app',
    kind: 'npm+crate',
    name: '@fixture/app, fixture-app',
    description: 'The app, with code and a link.',
    flag: 'description from first paragraph; add front matter',
    dependsOn: ['core', 'libs/a'],
  })
  assert.equal((await runJson<Report<typeof mapReport>>(['map', 'libs', '--json'])).json.count, 2)
})

test('explain: owner, nearby tests, generated files and checks', async () => {
  const source = (await runJson<Report<typeof explainReport>>(['explain', 'app/src/main.ts', '--json'])).json
  assert.equal(source.owner.path, 'app')
  assert.deepEqual(source.tests, ['app/test/main.test.ts', 'app/test/'])
  assert.equal(source.generated, false)
  assert.ok(source.run.includes('npm run tools -- test app'))
  const generated = (await runJson<Report<typeof explainReport>>(['explain', 'gen/out.ts', '--json'])).json
  assert.equal(generated.owner.kind, 'repository')
  assert.ok(generated.generated !== false)
  assert.equal(generated.generated.note, "Don't edit by hand.")
})

test('docs search ranks titles and sections; docs read finds by title and prints one section', async () => {
  const search = (await runJson<Report<typeof docsSearch>>(['docs', 'search', 'install widgets', '--json'])).json
  const [hit] = search.hits
  const [next] = search.next
  assert.ok(hit && next)
  assert.equal(hit.path, 'docs/guide.md')
  assert.equal(hit.section, 'Installing widgets')
  assert.match(next, /docs read docs\/guide\.md --section "Installing widgets"/u)
  const read = (await runJson<Report<typeof docsRead>>(['docs', 'read', 'guide', '--section', 'Removing', '--json'])).json
  assert.deepEqual(
    {path: read.path, text: read.text, truncated: read.truncated},
    {path: 'docs/guide.md', text: 'Remove things.', truncated: false},
  )
  const truncated = (await runJson<Report<typeof docsRead>>(['docs', 'read', 'docs/guide.md', '--max-lines', '3', '--json'])).json
  assert.equal(truncated.truncated, true)
  assert.deepEqual(truncated.headings, ['Installing widgets', 'Removing'])
})

test('usage errors exit 2 with a hint', async () => {
  const unknownDoc = await runJson<Failure>(['docs', 'read', 'nothing-like-this', '--json'])
  assert.equal(unknownDoc.exit, exitCodes.usage)
  assert.equal(unknownDoc.json.code, 'USAGE')
  const unknownGate = await runJson<Failure>(['check', '--only', 'nope', '--json'])
  assert.equal(unknownGate.exit, exitCodes.usage)
  assert.match(unknownGate.json.message, /Unknown gate nope/u)
})

test('check: a failing gate reports {file, line, message} and next, and exits 1', async () => {
  const {json, exit} = await runJson<Report<typeof checkReport>>(['check', '--only', 'readmes', '--json'])
  assert.equal(exit, exitCodes.failures)
  assert.equal(json.status, 'fail')
  const [gate] = json.gates
  const [failure] = json.failures
  assert.ok(gate && failure)
  assert.deepEqual(json.gates, [{gate: 'readmes', status: 'fail', seconds: gate.seconds, note: '2 problems'}])
  assert.deepEqual(
    failure.problems.map(problem => [problem.file, problem.line]),
    [
      ['app/README.md', 1],
      ['libs/b/README.md', 1],
    ],
  )
  assert.equal(json.next.includes('npm run tools -- explain app/README.md'), true)
})

test('context reads purpose and invariants from the documents', async () => {
  const {json} = await runJson<Report<typeof contextReport>>(['context', '--json'])
  assert.equal(json.purpose, 'A fixture repository for the tools tests. It has two lines.')
  assert.deepEqual(json.invariants, ['Keep the core pure.', 'Never edit generated files by hand.'])
  assert.deepEqual(
    json.areas.map((area: {path: string; packages: number}) => [area.path, area.packages]),
    [
      ['app', 1],
      ['core', 1],
      ['libs', 2],
    ],
  )
})

test('generated: the fixture marker is unregistered, which fails the listing', async () => {
  const {json, exit} = await runJson<Report<typeof generatedList>>(['generated', '--json'])
  assert.deepEqual(json.unregistered, ['gen/out.ts'])
  assert.equal(exit, exitCodes.failures)
})

test('feedback drafts without submitting: a title, a body and a prefilled URL', async () => {
  const {json, exit} = await runJson<Report<typeof feedbackReport>>(['feedback', 'map misses a crate', '--error', 'nothing', '--json'])
  assert.equal(exit, 0)
  assert.equal(json.status, 'draft')
  assert.equal(json.draft.title, '[agent feedback] map misses a crate')
  assert.match(json.url, /^https:\/\/github\.com\/githubnext\/projections\/issues\/new\?template=agent-feedback\.yml&/u)
})

test('update shadcn: without the updater script it is a missing prerequisite (exit 3)', async () => {
  const {json, exit} = await runJson<Failure>(['update', 'shadcn', '--check', '--json'])
  assert.equal(exit, exitCodes.prerequisite)
  assert.equal(json.code, 'PREREQUISITE')
})

test('the manifest lists every command', async () => {
  const {output} = await run(['--llms'])
  for (const command of [
    'context',
    'map',
    'explain',
    'docs search',
    'docs read',
    'doctor',
    'affected',
    'check',
    'test',
    'generated',
    'fix',
    'feedback',
    'update shadcn',
  ]) {
    assert.match(output, new RegExp(`\\| \`tools ${command}[\` ]`), command)
  }
})
