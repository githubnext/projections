// Runs inside VS Code's extension host (see run.mjs): each workflow in ./workflows, in this order, in the one window.
// Each carries on from the state the ones before it left (the choice picked, the tabs open, the files changed).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const vscode = require('vscode')
const {session} = require('./helpers.cjs')

const workflows = [
  require('./workflows/testing.cjs'),
  require('./workflows/rules-language.cjs'),
  require('./workflows/explore.cjs'),
  require('./workflows/inspector.cjs'),
  require('./workflows/documents.cjs'),
  require('./workflows/schemas.cjs'),
  require('./workflows/sidebar.cjs'),
  require('./workflows/projection-tab.cjs'),
  require('./workflows/choices.cjs'),
  require('./workflows/switching.cjs'),
  require('./workflows/staleness.cjs'),
  require('./workflows/definition-edits.cjs'),
  require('./workflows/invalid-definition.cjs'),
  require('./workflows/framing.cjs'),
  require('./workflows/definition-view.cjs'),
  require('./workflows/revisions.cjs'),
  require('./workflows/parts.cjs'),
  require('./workflows/recent-changes.cjs'),
  require('./workflows/agent-tools.cjs'),
  require('./workflows/custom-renderer.cjs'),
  require('./workflows/nested-renderers.cjs'),
  require('./workflows/new-projection.cjs'),
  require('./workflows/current-view.cjs'),
]

exports.run = async function run() {
  assert.equal(vscode.workspace.getConfiguration('json').get('schemaDownload.enable'), false)
  const shared = await session()
  for (const workflow of workflows) await workflow(shared)
}
