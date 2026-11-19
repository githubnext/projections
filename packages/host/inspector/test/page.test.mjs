import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mentionsPath} from '../dist/ui/app/page.js'

test('a message mentions a path when it names a rooted or nested path or a file with a known extension', () => {
  for (const text of [
    'Read /etc/hosts',
    'see ~/notes',
    '(./run.sh)',
    'C:\\repo',
    'in src/app/ now',
    'package.json is missing',
    'edit my-file.tsx',
  ])
    assert.ok(mentionsPath(text), text)
  for (const text of ['and/or', 'Version 1.2 is out', '--.json', 'a.jsonx', 'path/only', 'No changes']) assert.ok(!mentionsPath(text), text)
})

test('a long run of hyphens, dots or word characters is read in linear time', () => {
  const started = performance.now()
  for (const text of ['-'.repeat(200_000), 'a-'.repeat(100_000), 'a.'.repeat(100_000), '.-'.repeat(100_000)]) mentionsPath(text)
  assert.ok(performance.now() - started < 1000, `took ${Math.round(performance.now() - started)} ms`)
})
