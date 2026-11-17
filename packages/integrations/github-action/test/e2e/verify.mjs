// Checks what the Action produced for fixture.mjs's pull request: both projections compared and changed as the pull
// request changes them, and, when snapshots were rendered, a light and a dark PNG of each side of the one asked for.
//
//   node packages/integrations/github-action/test/e2e/verify.mjs MANIFEST [SNAPSHOTS_DIRECTORY]
import assert from 'node:assert/strict'
import {readFileSync, readdirSync} from 'node:fs'
import path from 'node:path'

const [manifestPath, snapshots] = process.argv.slice(2)
if (!manifestPath) throw new Error('Usage: verify.mjs MANIFEST [SNAPSHOTS_DIRECTORY]')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
assert.equal(manifest.subject.kind, 'pull-request')
assert.deepEqual(
  manifest.projections.map(({id, status}) => ({id, status})),
  [
    {id: 'services', status: 'changed'},
    {id: 'teams', status: 'changed'},
  ],
  JSON.stringify(manifest.projections),
)
const document = id => readFileSync(path.join(path.dirname(manifestPath), 'projections', `${id}.json`), 'utf8')
assert.match(document('teams'), /team:zeta/, 'the Python extractor saw the added team')
assert.match(document('services'), /service:payments/, 'the Node extractor saw the retired service')
if (snapshots) {
  const images = readdirSync(snapshots).filter(file => file.endsWith('.png'))
  assert.ok(images.length >= 2 && images.every(file => file.startsWith('teams')), images.join(', '))
  for (const scheme of ['light', 'dark'])
    assert.ok(
      images.some(file => file.includes(scheme)),
      `a ${scheme} snapshot: ${images.join(', ')}`,
    )
}
console.log(`The Action compared ${manifest.projections.length} projections${snapshots ? ' and rendered their snapshots' : ''}`)
