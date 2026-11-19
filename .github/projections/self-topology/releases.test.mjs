// node --test .github/projections/self-topology/
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {releaseChannels, tomlList} from './releases.mjs'

const crate = {id: 'crate:tool', kind: 'rust-crate', root: '', directory: 'tool', data: {package: 'tool', targets: ['bin']}}
const extension = {id: 'npm:ext', kind: 'npm-package', root: '', directory: 'ext', meta: {vscode: true}, data: {}}
const sdk = {id: 'npm:sdk', kind: 'npm-package', root: '', directory: 'sdk', data: {}}
const units = new Map([crate, extension, sdk].map(unit => [unit.id, unit]))
const owner = (root, target) => [...units.values()].find(unit => target === unit.directory || target.startsWith(`${unit.directory}/`))

function channels(repository) {
  const files = Object.keys(repository)
  const found = releaseChannels({roots: [{path: ''}], read: file => repository[file] ?? '', files, units, owner})
  return Object.fromEntries([...found].map(([id, list]) => [id, list.map(entry => entry.channel)]))
}

const dist = '[dist]\npackages = ["tool"]\nglobal-artifacts-jobs = ["./proof"]\n'
const proof = `jobs:
  pack:
    steps:
      - run: node ext/scripts/release-asset.mjs out && node tool/scripts/release-asset.mjs out
      - uses: actions/upload-artifact@abc
`

test('what the release attaches ships as a release asset, whatever the manifests allow', () => {
  assert.deepEqual(channels({'dist-workspace.toml': dist, '.github/workflows/proof.yml': proof}), {
    'crate:tool': ['release asset'],
    'npm:ext': ['release asset'],
  })
})

test('a unit whose scripts the root action runs ships as the GitHub Action', () => {
  const action = 'runs:\n  using: composite\n  steps:\n    - run: node "$GITHUB_ACTION_PATH/sdk/src/collect.mjs"\n'
  assert.deepEqual(channels({'action.yml': action}), {'npm:sdk': ['GitHub Action']})
})

test('a registry counts only when a workflow publishes to it without waiting for repository configuration', () => {
  const publish = (condition = '') => `jobs:
  configured:
    steps:
      - env:
          METHOD: \${{ vars.NPM_PUBLISHING }}
  publish:
    needs: configured
${condition}    steps:
      - run: npm publish --workspace sdk --access public
      - run: npx @vscode/vsce publish
`
  const inert = channels({'.github/workflows/publish.yml': publish("    if: needs.configured.outputs.ready == 'true'\n")})
  assert.deepEqual(inert, {})
  assert.deepEqual(channels({'.github/workflows/publish.yml': publish()}), {'npm:sdk': ['npm'], 'npm:ext': ['Marketplace']})
})

test('a TOML list is found by its literal key', () => {
  const text = 'a.b = ["dot"]\naxb = ["any"]\npublish-jobs = ["./npm", \'homebrew\']\n'
  assert.deepEqual(tomlList(text, 'a.b'), ['dot'])
  assert.deepEqual(tomlList('axb = ["any"]', 'a.b'), undefined)
  assert.deepEqual(tomlList(text, 'publish-jobs'), ['./npm', 'homebrew'])
  assert.equal(tomlList(text, 'a\\'), undefined)
})
