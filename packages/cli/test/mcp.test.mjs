// `projections mcp`: the agent tools as an MCP server over standard input and output, and the same tools from
// `serve --stdio` (`tools/list`, `tools/call`), in a fixture repository.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createInterface} from 'node:readline'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {executionEnvironment} from './process.mjs'
import {commit, fixture} from './repository.mjs'

const executable = fileURLToPath(new URL(`../dist/projections${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))

/** Starts the CLI with a JSON-RPC client. Every stdout line must be a JSON-RPC 2.0 message. */
function start(t, root, args, extra = {}) {
  // With where the CLI looks for Chrome or Edge on Windows, as a host's environment has them.
  const browser = ['PROJECTIONS_BROWSER', 'ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']
  const env = {...executionEnvironment(process.env, browser), ...extra}
  const child = spawn(executable, args, {cwd: root, env, stdio: ['pipe', 'pipe', 'pipe']})
  let stderr = ''
  child.stderr.on('data', bytes => (stderr += String(bytes)))
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({code, signal})))
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  })
  const pending = new Map()
  const invalid = []
  createInterface({input: child.stdout}).on('line', line => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      invalid.push(line)
      return
    }
    if (message?.jsonrpc !== '2.0') invalid.push(line)
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  })
  let nextId = 1
  const send = message => child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', ...message})}\n`)
  const call = (method, params) => {
    const id = nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No reply to ${method} ${JSON.stringify(params)}\n${stderr}`)), 120_000)
      pending.set(id, message => {
        clearTimeout(timer)
        resolve(message)
      })
      send({id, method, ...(params === undefined ? {} : {params})})
    })
  }
  /** A tool's `CallToolResult`: `{content: [{type: 'text', text}], structuredContent, isError}`. */
  const tool = async (name, toolArguments = {}) => {
    const message = await call('tools/call', {name, arguments: toolArguments})
    assert.equal(message.error, undefined, JSON.stringify(message.error))
    assert.equal(message.result.content[0].type, 'text')
    return {...message.result, text: message.result.content[0].text}
  }
  return {child, exited, call, send, tool, invalid, stderr: () => stderr}
}

/** The polyglot example with a second commit that adds a service, so its last commit has a change. */
async function repository(t) {
  const {root} = await fixture(t)
  const services = JSON.parse(await readFile(path.join(root, 'services.json'), 'utf8'))
  services.services.push({name: 'queue', language: 'Go', dependencies: []})
  await writeFile(path.join(root, 'services.json'), JSON.stringify(services))
  commit(root)
  return root
}

test('projections mcp speaks MCP: initialize, list tools, call them, and write in two steps', async t => {
  const root = await repository(t)
  const server = start(t, root, ['mcp', '--trust'])

  const initialized = await server.call('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: {name: 'conformance', version: '1.0.0'},
  })
  assert.equal(initialized.result.protocolVersion, '2025-06-18')
  assert.deepEqual(initialized.result.capabilities, {tools: {listChanged: false}})
  assert.equal(initialized.result.serverInfo.name, 'projections')
  assert.match(initialized.result.instructions, /list_projections/)
  server.send({method: 'notifications/initialized'})
  assert.deepEqual((await server.call('ping')).result, {})

  const {tools} = (await server.call('tools/list')).result
  const names = tools.map(tool => tool.name)
  for (const name of ['list_projections', 'compare', 'explore', 'sweep', 'check', 'run_comparator_tests', 'describe_part', 'adopt']) {
    assert.ok(names.includes(name), names.join())
  }
  // Where the CI step goes is the person's decision: no tool writes a workflow.
  assert.ok(!names.includes('publish'), names.join())
  // One catalog: the view tools are listed here too, answered by the viewer.
  for (const name of ['open_projection', 'current_view', 'refresh', 'screenshot']) assert.ok(names.includes(name), name)
  assert.deepEqual(
    tools.filter(tool => tool.view).map(tool => tool.name),
    ['open_projection', 'current_view', 'refresh'],
  )
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object', tool.name)
    assert.equal(typeof tool.description, 'string')
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean')
    assert.equal(typeof tool.annotations.destructiveHint, 'boolean')
  }
  assert.equal(tools.find(tool => tool.name === 'compare').annotations.readOnlyHint, true)
  assert.equal(tools.find(tool => tool.name === 'set_part').annotations.destructiveHint, true)

  const listed = await server.tool('list_projections')
  assert.equal(listed.isError, false)
  assert.match(listed.text, /- services-node: Services extracted by Node\. Extractor command \x60node collect\.mjs\x60/)
  assert.deepEqual(
    listed.structuredContent.projections.map(projection => projection.id),
    ['services-node', 'services-python'],
  )

  // The suggested pair: the last commit, which added a service.
  const compared = await server.tool('compare', {projection: 'services-node'})
  assert.equal(compared.isError, false, compared.text)
  assert.match(compared.text, /HEAD~1 → HEAD/)
  assert.match(compared.text, /Added entity .*queue/)
  assert.ok(compared.structuredContent.counts.added >= 1)

  // Nothing is shown in the viewer, so a projection must be named.
  const invalid = await server.tool('compare', {})
  assert.equal(invalid.isError, true)
  assert.match(invalid.text, /Name a projection/)
  const unknown = await server.call('tools/call', {name: 'no_such_tool', arguments: {}})
  assert.equal(unknown.error.code, -32602)

  // A write previews, refuses a preview the file no longer matches, and writes with a current one.
  const definition = path.join(root, '.github/projections/services-node.json')
  const preview = await server.tool('set_part', {projection: 'services-node', renderer: 'graph'})
  assert.equal(preview.isError, false, preview.text)
  assert.match(preview.text, /- {3}"renderer": "architecture"/)
  assert.match(preview.text, /\+ {3}"renderer": "graph"/)
  const token = preview.structuredContent.confirm
  assert.match(preview.text, new RegExp(`confirm: "${token}"`))
  assert.match(await readFile(definition, 'utf8'), /"architecture"/)
  await writeFile(definition, (await readFile(definition, 'utf8')).replace('Services extracted by Node', 'Node services'))
  const stale = await server.tool('set_part', {projection: 'services-node', renderer: 'graph', confirm: token})
  assert.equal(stale.isError, true)
  assert.match(stale.text, /^Not written/)
  assert.match(await readFile(definition, 'utf8'), /"architecture"/)
  const written = await server.tool('set_part', {projection: 'services-node', renderer: 'graph', confirm: stale.structuredContent.confirm})
  assert.equal(written.isError, false, written.text)
  assert.equal(written.structuredContent.written, true)
  const saved = await readFile(definition, 'utf8')
  assert.match(saved, /"renderer": "graph"/)
  assert.match(saved, /Node services/)

  // A cancelled call is not answered; the server carries on.
  const sweepId = 1000
  server.send({id: sweepId, method: 'tools/call', params: {name: 'sweep', arguments: {last: 1}}})
  server.send({method: 'notifications/cancelled', params: {requestId: sweepId, reason: 'test'}})
  assert.deepEqual((await server.call('ping')).result, {})

  server.child.stdin.end()
  const exit = await Promise.race([server.exited, new Promise(resolve => setTimeout(() => resolve('timeout'), 15_000).unref())])
  assert.deepEqual(exit, {code: 0, signal: null}, server.stderr())
  assert.deepEqual(server.invalid, [])
})

test('projections mcp shows a projection in the viewer: open_projection, current_view, screenshot and refresh', async t => {
  const root = await repository(t)
  const cache = await mkdtemp(path.join(tmpdir(), 'projections-mcp-cache-'))
  t.after(() => rm(cache, {recursive: true, force: true}))
  const server = start(t, root, ['mcp', '--trust'], {PROJECTIONS_CACHE_DIR: cache})
  await server.call('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'viewer', version: '1'}})

  const nothing = await server.tool('current_view')
  assert.equal(nothing.isError, false)
  assert.match(nothing.text, /Nothing is shown/)

  const shown = await server.tool('open_projection', {projection: 'services-node', choice: 'last-commit', mode: 'side-by-side'})
  assert.equal(shown.isError, false, shown.text)
  const url = shown.structuredContent.url
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{64}\/$/)
  assert.match(shown.text, /Showing: Last commit\. Before HEAD~1/)
  assert.equal((await fetch(url)).status, 200)
  assert.equal((await fetch(new URL('/', url))).status, 404)

  const current = await server.tool('current_view')
  assert.match(current.text, /The viewer shows "[^"]+" \(projection services-node\)/)
  assert.deepEqual([current.structuredContent.before.ref, current.structuredContent.after.ref], ['HEAD~1', 'HEAD'])

  // Other tools default to what the viewer shows, and say so.
  const compared = await server.tool('compare')
  assert.equal(compared.isError, false, compared.text)
  assert.match(compared.text, /^Projection: services-node, the one the viewer shows\. Revisions: HEAD~1 → HEAD, the ones the viewer shows/)

  // The screenshot is rendered here, without a page open.
  const shot = await server.call('tools/call', {name: 'screenshot', arguments: {theme: 'dark', width: 640, height: 400}})
  assert.equal(shot.result.isError, false, JSON.stringify(shot.result.content[0]))
  const image = shot.result.content.find(part => part.type === 'image')
  assert.equal(image.mimeType, 'image/png')
  assert.deepEqual([...Buffer.from(image.data, 'base64').subarray(1, 4)], [...Buffer.from('PNG')])
  assert.equal(shot.result.structuredContent.mode, 'side-by-side')

  const refreshed = await server.tool('refresh')
  assert.equal(refreshed.isError, false)
  assert.match(refreshed.text, /extract again/)

  server.child.stdin.end()
  assert.deepEqual(await server.exited, {code: 0, signal: null})
  // The viewer stops with the server.
  await assert.rejects(fetch(url))
})

test('serve --stdio offers the same tools, and the view actions, as tools/list and tools/call', async t => {
  const root = await repository(t)
  const backend = start(t, root, ['serve', '--stdio'])
  await backend.call('initialize')
  const {tools} = (await backend.call('tools/list')).result
  assert.ok(tools.some(tool => tool.name === 'open_projection' && tool.view === true))
  assert.ok(tools.some(tool => tool.name === 'current_view' && tool.view === true))
  // One catalog: projections mcp lists exactly the same tools, with the same schemas.
  const mcp = start(t, root, ['mcp'])
  await mcp.call('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'parity', version: '1'}})
  assert.deepEqual((await mcp.call('tools/list')).result.tools, tools)
  mcp.child.stdin.end()
  await mcp.exited
  const explored = await backend.tool('explore')
  assert.equal(explored.isError, false)
  assert.match(explored.text, /- repository-map: /)
  // An editor confirms writes itself: the preview carries the token, not instructions to call again.
  const adopt = {projections: ['repository-map'], bookmarks: 0}
  const preview = await backend.tool('adopt', adopt)
  assert.equal(preview.isError, false, preview.text)
  assert.match(preview.text, /Would create \S*repository-map\.json/)
  assert.ok(preview.structuredContent.confirm)
  assert.doesNotMatch(preview.text, /confirm: "/)
  // Without --trust, and outside an explore session, writing is refused.
  const refused = await backend.tool('adopt', {...adopt, confirm: preview.structuredContent.confirm})
  assert.equal(refused.isError, true)
  assert.match(refused.text, /--trust/)
  backend.child.stdin.end()
  assert.deepEqual(await backend.exited, {code: 0, signal: null})
  assert.deepEqual(backend.invalid, [])
})
