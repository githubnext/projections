// Unit tests of the agent tools' VS Code side, loaded from source with Node's type stripping: the contributions made
// from the CLI's catalog, and what a tool shows before it runs.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {existsSync} from 'node:fs'
import {createInterface} from 'node:readline'
import {fileURLToPath} from 'node:url'
import {readFile} from 'node:fs/promises'
import {
  cliArguments,
  cliName,
  confirmation,
  contribution,
  firstSentence,
  invocationMessage,
  onboardingTag,
  writeTag,
} from '../src/agent-tools.ts'
import {parseToolResult, parseTools, toolText} from '../src/runner.ts'
import {cli, contributions} from '../scripts/tools.mjs'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

const adopt = {
  name: 'adopt',
  title: 'Adopt projections',
  description: 'Adopt explore candidates the person chose. Never adopt on your own.',
  inputSchema: {
    type: 'object',
    properties: {projections: {type: 'array', description: 'IDs'}, confirm: {type: 'string', description: 'Token'}},
    required: ['projections'],
    additionalProperties: false,
  },
  annotations: {readOnlyHint: false, destructiveHint: false},
  trust: 'onboarding',
  view: false,
}

test('a CLI tool becomes a language model tool: prefixed, with a folder and no confirm', () => {
  const tool = contribution(adopt)
  assert.equal(tool.name, 'projections_adopt')
  assert.equal(tool.toolReferenceName, 'projections_adopt')
  assert.equal(tool.displayName, 'Adopt projections')
  assert.equal(tool.modelDescription, adopt.description)
  assert.equal(tool.userDescription, 'Adopt explore candidates the person chose.')
  assert.equal(tool.canBeReferencedInPrompt, true)
  assert.equal(tool.icon, '$(add)')
  assert.deepEqual(tool.tags, ['projections', writeTag, onboardingTag])
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ['projections', 'folder'])
  assert.deepEqual(tool.inputSchema.required, ['projections'])
  assert.equal(tool.inputSchema.additionalProperties, false)
  // The catalog itself is left alone.
  assert.ok(adopt.inputSchema.properties.confirm)
  const read = contribution({...adopt, name: 'compare', annotations: {readOnlyHint: true, destructiveHint: false}, trust: 'extract'})
  assert.deepEqual(read.tags, ['projections'])
  assert.equal(cliName('projections_compare'), 'compare')
  assert.equal(cliName('other_compare'), undefined)
  assert.equal(firstSentence('No sentence end'), 'No sentence end')
  assert.equal(firstSentence('Version 1.2 ships. Then more.'), 'Version 1.2 ships.')
})

test("a contribution keeps the catalog's schema and description: only folder is added and confirm dropped", () => {
  const compare = {
    ...adopt,
    name: 'compare',
    description: 'Compare two revisions through one projection. An omitted projection defaults to the current view.',
    inputSchema: {
      type: 'object',
      properties: {projection: {type: 'string', description: "The projection ID; default the current view's"}},
      required: [],
      additionalProperties: false,
    },
    annotations: {readOnlyHint: true, destructiveHint: false},
    trust: 'extract',
  }
  const contributed = contribution(compare)
  assert.equal(contributed.modelDescription, compare.description)
  assert.deepEqual(contributed.inputSchema, {
    ...compare.inputSchema,
    properties: {...compare.inputSchema.properties, folder: contributed.inputSchema.properties.folder},
  })
})

test('arguments drop the folder, and a confirm token the model made up', () => {
  assert.deepEqual(cliArguments({projection: 'map', folder: 'shop', confirm: 'abc'}), {projection: 'map'})
  assert.deepEqual(cliArguments(undefined), {})
  assert.equal(invocationMessage('Compare revisions', {projection: 'map'}), 'Compare revisions: map')
  assert.equal(invocationMessage('Adopt projections', {projections: ['a', 'b']}), 'Adopt projections: a, b')
  assert.equal(invocationMessage('Explore projections', {}), 'Explore projections')
})

test('a write asks the person with its preview, and only when there is something to write', () => {
  const preview = {
    content: [{type: 'text', text: 'Adopt would write:\nWould create .github/projections/map.json\n\nNothing was written.\n'}],
    structuredContent: {confirm: 'abc123', written: false},
    isError: false,
  }
  assert.deepEqual(confirmation('Adopt projections', preview), {
    title: 'Adopt projections?',
    message: 'Adopt would write:\nWould create .github/projections/map.json\n',
    token: 'abc123',
  })
  assert.equal(confirmation('Adopt projections', {...preview, isError: true}), undefined)
  assert.equal(confirmation('Adopt projections', {...preview, structuredContent: {written: false}}), undefined)
  assert.equal(toolText(parseToolResult(preview)), preview.content[0].text)
  assert.throws(() => parseToolResult({}), /invalid tool result/)
  assert.throws(() => parseTools({tools: [{}]}), /invalid tools/)
})

test('package.json contributes every CLI tool, as scripts/tools.mjs writes them', {skip: !existsSync(cli) && 'no CLI build'}, async () => {
  const tools = pkg.contributes.languageModelTools
  assert.deepEqual(tools, await contributions(), 'run node scripts/tools.mjs')
  for (const tool of tools) {
    assert.match(tool.name, /^projections_[a-z_]+$/)
    assert.ok(tool.modelDescription.length > 80, tool.name)
    assert.ok(tool.userDescription && tool.displayName && tool.icon, tool.name)
    assert.equal(tool.inputSchema.type, 'object')
    assert.ok(tool.inputSchema.properties.folder, tool.name)
    assert.equal(tool.inputSchema.properties.confirm, undefined, tool.name)
  }
  assert.deepEqual(
    tools.filter(tool => tool.tags.includes(writeTag)).map(tool => tool.name),
    ['projections_adopt', 'projections_set_part', 'projections_update_snapshots'],
  )
  assert.ok(tools.some(tool => tool.name === 'projections_open_projection'))
  const current = tools.find(tool => tool.name === 'projections_current_view')
  assert.match(current?.modelDescription ?? '', /"this projection"/)
  assert.deepEqual(current.tags, ['projections'])
  for (const name of ['projections_refresh', 'projections_screenshot']) {
    assert.ok(
      tools.some(tool => tool.name === name),
      name,
    )
  }
})

// One catalog: VS Code's agent and projections mcp's get the same tools, with the same schemas and descriptions. The
// only differences are VS Code's own: its contributions add `folder` (which workspace folder) and drop `confirm` (VS
// Code asks the person to approve a write itself), and the view tools are answered by its projection tabs rather than
// the viewer.
test(
  'projections mcp lists exactly the tools VS Code contributes, with the same schemas',
  {skip: !existsSync(cli) && 'no CLI build'},
  async () => {
    const server = spawn(cli, ['mcp'], {cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['pipe', 'pipe', 'ignore']})
    const lines = createInterface({input: server.stdout})
    const replies = new Map()
    lines.on('line', line => {
      const message = JSON.parse(line)
      replies.get(message.id)?.(message)
    })
    const call = (id, method, params) =>
      new Promise(resolve => {
        replies.set(id, resolve)
        server.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id, method, params})}\n`)
      })
    await call(1, 'initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'parity', version: '1'}})
    const {tools} = (await call(2, 'tools/list', {})).result
    server.stdin.end()
    const contributed = pkg.contributes.languageModelTools
    assert.deepEqual(
      contributed.map(tool => tool.name),
      tools.map(tool => `projections_${tool.name}`),
    )
    for (const tool of tools) {
      const vscode = contributed.find(item => item.name === `projections_${tool.name}`)
      const {confirm: _, ...properties} = tool.inputSchema.properties
      assert.deepEqual(
        vscode.inputSchema,
        {
          ...tool.inputSchema,
          properties: {...properties, folder: vscode.inputSchema.properties.folder},
          required: (tool.inputSchema.required ?? []).filter(key => key !== 'confirm'),
        },
        tool.name,
      )
      assert.equal(vscode.modelDescription, tool.description, tool.name)
      assert.equal(vscode.displayName, tool.title, tool.name)
    }
  },
)
