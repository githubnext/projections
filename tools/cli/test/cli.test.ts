// The commands through incur, in-process, against the fixture repository: output envelopes, schemas and exit codes.
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import test from 'node:test'

process.env['TOOLS_ROOT'] = fileURLToPath(new URL('fixtures/repo/', import.meta.url))
const {default: cli, exitCodes} = await import('../src/cli.ts')

async function run(argv: string[]): Promise<{output: string; json: any; exit: number}> {
  let output = ''
  let exit = 0
  const before = process.exitCode
  process.exitCode = undefined
  await cli.serve(argv, {stdout: text => (output += text), exit: code => (exit = code)})
  exit ||= Number(process.exitCode ?? 0)
  process.exitCode = before
  let json: any
  try {
    json = JSON.parse(output)
  } catch {
    json = undefined
  }
  return {output, json, exit}
}

test('map: every unit with its description, flag and dependencies', async () => {
  const {json, exit} = await run(['map', '--json'])
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
  assert.equal((await run(['map', 'libs', '--json'])).json.count, 2)
})

test('explain: owner, nearby tests, generated files and checks', async () => {
  const source = (await run(['explain', 'app/src/main.ts', '--json'])).json
  assert.equal(source.owner.path, 'app')
  assert.deepEqual(source.tests, ['app/test/main.test.ts', 'app/test/'])
  assert.equal(source.generated, false)
  assert.ok(source.run.includes('npm run tools -- test app'))
  const generated = (await run(['explain', 'gen/out.ts', '--json'])).json
  assert.equal(generated.owner.kind, 'repository')
  assert.equal(generated.generated.note, "Don't edit by hand.")
})

test('docs search ranks titles and sections; docs read finds by title and prints one section', async () => {
  const search = (await run(['docs', 'search', 'install widgets', '--json'])).json
  assert.equal(search.hits[0].path, 'docs/guide.md')
  assert.equal(search.hits[0].section, 'Installing widgets')
  assert.match(search.next[0], /docs read docs\/guide\.md --section "Installing widgets"/)
  const read = (await run(['docs', 'read', 'guide', '--section', 'Removing', '--json'])).json
  assert.deepEqual(
    {path: read.path, text: read.text, truncated: read.truncated},
    {path: 'docs/guide.md', text: 'Remove things.', truncated: false},
  )
  const truncated = (await run(['docs', 'read', 'docs/guide.md', '--max-lines', '3', '--json'])).json
  assert.equal(truncated.truncated, true)
  assert.deepEqual(truncated.headings, ['Installing widgets', 'Removing'])
})

test('usage errors exit 2 with a hint', async () => {
  const unknownDoc = await run(['docs', 'read', 'nothing-like-this', '--json'])
  assert.equal(unknownDoc.exit, exitCodes.usage)
  assert.equal(unknownDoc.json.code, 'USAGE')
  const unknownGate = await run(['check', '--only', 'nope', '--json'])
  assert.equal(unknownGate.exit, exitCodes.usage)
  assert.match(unknownGate.json.message, /Unknown gate nope/)
})

test('check: a failing gate reports {file, line, message} and next, and exits 1', async () => {
  const {json, exit} = await run(['check', '--only', 'readmes', '--json'])
  assert.equal(exit, exitCodes.failures)
  assert.equal(json.status, 'fail')
  assert.deepEqual(json.gates, [{gate: 'readmes', status: 'fail', seconds: json.gates[0].seconds, note: '2 problems'}])
  assert.deepEqual(
    json.failures[0].problems.map((problem: {file: string; line: number}) => [problem.file, problem.line]),
    [
      ['app/README.md', 1],
      ['libs/b/README.md', 1],
    ],
  )
  assert.ok(json.next.includes('npm run tools -- explain app/README.md'))
})

test('context reads purpose and invariants from the documents', async () => {
  const {json} = await run(['context', '--json'])
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
  const {json, exit} = await run(['generated', '--json'])
  assert.deepEqual(json.unregistered, ['gen/out.ts'])
  assert.equal(exit, exitCodes.failures)
})

test('feedback drafts without submitting: a title, a body and a prefilled URL', async () => {
  const {json, exit} = await run(['feedback', 'map misses a crate', '--error', 'nothing', '--json'])
  assert.equal(exit, 0)
  assert.equal(json.status, 'draft')
  assert.equal(json.draft.title, '[agent feedback] map misses a crate')
  assert.match(json.url, /^https:\/\/github\.com\/githubnext\/projections\/issues\/new\?template=agent-feedback\.yml&/)
})

test('update shadcn: without the updater script it is a missing prerequisite (exit 3)', async () => {
  const {json, exit} = await run(['update', 'shadcn', '--check', '--json'])
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
  ])
    assert.match(output, new RegExp(`\\| \`tools ${command}[\` ]`), command)
})
