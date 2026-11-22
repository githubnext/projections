// The extractor helpers agree: each case of packages/schemas/fixtures/extractor-helpers.json runs through the Python
// module, as the runner gives it (on PYTHONPATH), and through @githubnext/projections/extractor, as the runner gives it
// (preloaded into `node`), and both give the expected values, extraction or message.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {test} from 'node:test'

const path = relative => fileURLToPath(new URL(relative, import.meta.url))
const {cases} = JSON.parse(readFileSync(path('../../schemas/fixtures/extractor-helpers.json'), 'utf8'))
const environment = {PATH: process.env.PATH, ...(process.env.SystemRoot ? {SystemRoot: process.env.SystemRoot} : {})}

const python = ['python3', 'python'].find(
  name => spawnSync(name, ['-c', 'import sys; assert sys.version_info >= (3, 9)'], {env: environment}).status === 0,
)

const helpers = {
  javascript: testCase => [
    process.execPath,
    ['--require', path('../node/register.cjs'), path('extractor-helpers/driver.mjs'), testCase],
    {},
  ],
  python: testCase => [
    python,
    [path('extractor-helpers/driver.py'), testCase],
    {PYTHONPATH: path('../python'), PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf8'},
  ],
}

/** What a helper did with a case: `{value}`, its output, or `{error}`, its message. */
function run(helper, testCase) {
  const [program, argv, variables] = helpers[helper](JSON.stringify(testCase))
  const input = testCase.stdinText ?? JSON.stringify(testCase.stdin)
  const outcome = spawnSync(program, argv, {input, encoding: 'utf8', env: {...environment, ...variables}})
  if (outcome.status === 0) return {value: JSON.parse(outcome.stdout)}
  const error = /^error: (.*)$/m.exec(outcome.stderr)
  assert.ok(error, `${helper} failed without a message: ${outcome.stderr}`)
  assert.equal(outcome.stdout, '', `${helper} wrote output and failed`)
  return {error: error[1]}
}

// Paths joined on Windows use its separator.
const portable = value => JSON.parse(JSON.stringify(value).replaceAll('\\\\', '/'))

for (const testCase of cases) {
  test(testCase.id, {skip: python ? false : 'no Python 3.9 or later'}, () => {
    const outcomes = Object.fromEntries(Object.keys(helpers).map(helper => [helper, run(helper, testCase)]))
    for (const [helper, outcome] of Object.entries(outcomes)) {
      if ('expected' in testCase) assert.deepEqual(portable(outcome), {value: testCase.expected}, helper)
      else if ('error' in testCase) assert.deepEqual(outcome, {error: testCase.error}, helper)
      else assert.ok(outcome.error?.startsWith(testCase.errorStartsWith), `${helper}: ${JSON.stringify(outcome)}`)
    }
  })
}
