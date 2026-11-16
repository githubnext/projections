// Unit tests of the extension's Node side, loaded from source with Node's type stripping.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createInterface} from 'node:readline'
import {PassThrough} from 'node:stream'
import {fileURLToPath} from 'node:url'
import {transportTag} from '@githubnext/projections-inspector/transport'
import {createBridge} from '../src/bridge.ts'
import {customRendererPath} from '../src/bridge/responses.ts'
import {contentSecurityPolicy, skeletonHtml, webviewHtml} from '../src/html.ts'
import {position, relativePath, revision} from '../src/protocol.ts'
import {parseInfo, startRunner} from '../src/runner.ts'
import {bundledCli, cliPath, compatibleVersion, incompatibility, resolveCli} from '../src/runner/cli.ts'
import {createRpcClient, RpcError} from '../src/runner/rpc.ts'
import {parseWrite, refusal} from '../src/writes.ts'
import {addToCiPrompt, isAddToCiChoice} from '../src/projections/ci.ts'
import {rendererPackage, sourceArguments} from '../src/sources.ts'

const cli = fileURLToPath(new URL(`../../../cli/dist/projections${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))

/** A fake backend: answers like `serve --stdio` would, from a table of paths. */
function fakeRunner(answers) {
  const seen = []
  return {
    seen,
    request(request, signal) {
      seen.push(request)
      const answer = answers[request.path]
      if (answer === 'hang')
        return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
      if (answer instanceof Error) return Promise.reject(answer)
      return Promise.resolve({size: JSON.stringify(answer?.body ?? null).length, ...answer})
    },
  }
}

test('the bridge sends /api/ requests to the backend and relays status and body', async () => {
  const runner = fakeRunner({
    '/api/definitions?ref=working-tree': {status: 200, contentType: 'application/json; charset=utf-8', body: {ok: true}},
    '/api/jobs': {status: 202, contentType: 'application/json; charset=utf-8', body: {id: 'job'}},
    '/api/missing': {status: 404, contentType: 'application/json; charset=utf-8', body: {diagnostics: [{message: 'Not found'}]}},
    '/api/sweep/thumbnail': {status: 200, contentType: 'image/png', body: {base64: 'AQID'}},
    '/api/text': {status: 200, contentType: 'text/plain', body: 'hello'},
    '/api/huge': {status: 200, contentType: 'image/png', body: {base64: 'A'.repeat(90 * 1024 * 1024)}},
    '/api/broken': new Error('The Projections backend exited (1)'),
  })
  const replies = []
  const bridge = createBridge(runner, reply => replies.push(reply))
  const settled = count =>
    new Promise(resolve => {
      const check = () => (replies.length >= count ? resolve() : setTimeout(check, 5))
      check()
    })
  assert.equal(bridge.receive({tag: transportTag, type: 'request', id: 1, method: 'GET', path: '/api/definitions?ref=working-tree'}), true)
  assert.equal(
    bridge.receive({tag: transportTag, type: 'request', id: 2, method: 'POST', path: '/api/jobs', body: {projectionId: 'x'}}),
    true,
  )
  assert.equal(bridge.receive({tag: transportTag, type: 'request', id: 3, method: 'GET', path: '/api/missing'}), true)
  // Not the backend's API: ignored, never sent.
  assert.equal(bridge.receive({tag: transportTag, type: 'request', id: 4, method: 'GET', path: '/index.html'}), false)
  assert.equal(bridge.receive({tag: transportTag, type: 'request', id: 5, method: 'GET', path: 'http://example.com/api/x'}), false)
  assert.equal(bridge.receive({type: 'request', id: 6, method: 'GET', path: '/api/x'}), false)
  bridge.receive({tag: transportTag, type: 'request', id: 7, method: 'GET', path: '/api/sweep/thumbnail', responseType: 'blob'})
  bridge.receive({tag: transportTag, type: 'request', id: 8, method: 'GET', path: '/api/text'})
  bridge.receive({tag: transportTag, type: 'request', id: 9, method: 'GET', path: '/api/huge', responseType: 'blob'})
  bridge.receive({tag: transportTag, type: 'request', id: 10, method: 'GET', path: '/api/broken'})
  await settled(7)
  assert.deepEqual(
    runner.seen.map(request => request.path),
    ['/api/definitions?ref=working-tree', '/api/jobs', '/api/missing', '/api/sweep/thumbnail', '/api/text', '/api/huge', '/api/broken'],
  )
  assert.deepEqual(runner.seen[0], {method: 'GET', path: '/api/definitions?ref=working-tree'})
  assert.deepEqual(runner.seen[1], {method: 'POST', path: '/api/jobs', body: {projectionId: 'x'}})
  const byId = Object.fromEntries(replies.map(reply => [reply.id, reply]))
  assert.deepEqual(byId[1], {tag: transportTag, id: 1, type: 'response', status: 200, body: {ok: true}})
  assert.deepEqual(byId[2], {tag: transportTag, id: 2, type: 'response', status: 202, body: {id: 'job'}})
  // A refusal relays its body as text, as an HTTP bridge would.
  assert.deepEqual(byId[3], {tag: transportTag, id: 3, type: 'response', status: 404, body: '{"diagnostics":[{"message":"Not found"}]}'})
  assert.deepEqual(byId[7].body, {type: 'image/png', base64: 'AQID'})
  assert.deepEqual(byId[8], {tag: transportTag, id: 8, type: 'failure', message: 'The backend returned invalid JSON'})
  assert.deepEqual(byId[9], {tag: transportTag, id: 9, type: 'failure', message: 'The backend response exceeds the bridge limit'})
  assert.match(byId[10].message, /exited \(1\)/)
  bridge.dispose()
})

test('an aborted request is cancelled in the backend and not answered', async () => {
  const runner = fakeRunner({'/api/changes?since=1': 'hang', '/api/revisions': {status: 200, contentType: 'application/json', body: {}}})
  const replies = []
  const bridge = createBridge(runner, reply => replies.push(reply))
  bridge.receive({tag: transportTag, type: 'request', id: 1, method: 'GET', path: '/api/changes?since=1'})
  bridge.receive({tag: transportTag, type: 'abort', id: 1})
  bridge.receive({tag: transportTag, type: 'request', id: 2, method: 'GET', path: '/api/revisions'})
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.deepEqual(
    replies.map(reply => [reply.id, reply.type]),
    [[2, 'response']],
  )
})

test('the JSON-RPC client matches replies by id, cancels on abort, relays notifications and fails pending calls on close', async () => {
  const toBackend = new PassThrough()
  const fromBackend = new PassThrough()
  const sent = []
  createInterface({input: toBackend}).on('line', line => sent.push(JSON.parse(line)))
  const client = createRpcClient({input: fromBackend, output: toBackend})
  const notifications = []
  client.onNotification((method, params) => notifications.push([method, params]))
  const reply = message => fromBackend.write(`${JSON.stringify({jsonrpc: '2.0', ...message})}\n`)
  const next = async count => {
    while (sent.length < count) await new Promise(resolve => setTimeout(resolve, 5))
  }
  const first = client.call('request', {method: 'GET', path: '/api/a'})
  const second = client.call('request', {method: 'GET', path: '/api/b'})
  await next(2)
  assert.deepEqual(sent[0], {jsonrpc: '2.0', id: 1, method: 'request', params: {method: 'GET', path: '/api/a'}})
  reply({id: 2, result: {status: 200}})
  reply({id: 1, error: {code: -32602, message: 'invalid'}})
  assert.deepEqual((await second).result, {status: 200})
  await assert.rejects(first, error => error instanceof RpcError && error.code === -32602)
  const abort = new AbortController()
  const cancelled = client.call('request', {method: 'GET', path: '/api/changes?since=1'}, abort.signal)
  await next(3)
  abort.abort()
  await assert.rejects(cancelled, {name: 'AbortError'})
  await next(4)
  assert.deepEqual(sent[3], {jsonrpc: '2.0', method: '$/cancelRequest', params: {id: 3}})
  // The late cancelled reply is ignored.
  reply({id: 3, error: {code: -32800, message: 'Request cancelled'}})
  reply({method: 'changes', params: {generation: 2, changes: ['working-tree'], complete: true}})
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(notifications, [['changes', {generation: 2, changes: ['working-tree'], complete: true}]])
  const pending = client.call('initialize')
  client.close('The Projections backend exited (1)')
  await assert.rejects(pending, /exited \(1\)/)
  await assert.rejects(client.call('initialize'), /exited \(1\)/)
})

test(
  'the real backend: serve --stdio through the runner and the bridge',
  {skip: !existsSync(cli) && 'no packages/cli/dist/projections'},
  async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'projections-vscode-runner-'))
    t.after(() => rm(root, {recursive: true, force: true}))
    const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {cwd: root, stdio: 'pipe'})
    git('init', '-q')
    await writeFile(path.join(root, 'README.md'), '# Demo\n')
    git('add', '-A')
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init')
    const logged = []
    const runner = await startRunner({executable: cli, repository: root, trust: false, log: line => logged.push(line)})
    t.after(() => runner.stop())
    assert.equal(runner.info.trusted, false)
    assert.equal(runner.info.explore, true)
    const replies = []
    const bridge = createBridge(runner, reply => replies.push(reply))
    bridge.receive({tag: transportTag, type: 'request', id: 1, method: 'GET', path: '/api/revisions?limit=2'})
    bridge.receive({tag: transportTag, type: 'request', id: 2, method: 'GET', path: `/api/changes?since=1`})
    bridge.receive({tag: transportTag, type: 'abort', id: 2})
    while (!replies.length) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(replies[0].id, 1)
    assert.equal(replies[0].status, 200)
    assert.equal(replies[0].body.revisions[0].ref, 'working-tree')
    const changes = new Promise(resolve => runner.onNotification((method, params) => method === 'changes' && resolve(params)))
    // A change subscription at the current generation is answered by the next notification.
    const generation = (await runner.request({method: 'GET', path: '/api/changes?since=0'})).body.generation
    bridge.receive({tag: transportTag, type: 'next', id: 3, channel: 'changes', since: generation})
    await writeFile(path.join(root, 'notes.txt'), 'changed\n')
    assert.ok((await changes).changes.includes('working-tree'))
    while (replies.length < 2) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(replies[1].id, 3)
    assert.ok(replies[1].body.generation > generation && replies[1].body.changes.includes('working-tree'))
    runner.stop()
    assert.equal(await runner.exited, 0)
    assert.deepEqual(
      replies.map(reply => reply.id),
      [1, 3],
    )
    assert.ok(logged.some(line => /serving/.test(line)))
  },
)

test('the webview policy loads nothing from the network and only nonce scripts run inline', () => {
  const policy = contentSecurityPolicy('https://*.vscode-cdn.net', 'n0nce')
  assert.match(policy, /default-src 'none'/)
  assert.match(policy, /script-src 'nonce-n0nce' https:\/\/\*\.vscode-cdn\.net 'wasm-unsafe-eval'/)
  assert.match(policy, /connect-src https:\/\/\*\.vscode-cdn\.net(;|$)/)
  assert.match(policy, /worker-src blob:/)
  assert.match(policy, /frame-src blob:/)
  assert.doesNotMatch(policy, /127\.0\.0\.1|localhost| 'unsafe-eval'/)
  const html = webviewHtml({
    cspSource: 'https://x',
    config: {
      assets: 'https://x/',
      engineWorker: 'https://x/e.js',
      comparatorWorker: 'https://x/c.js',
      nonce: 'n0nce',
      view: 'inspect</script>',
    },
    styles: ['https://x/mount.css', 'https://x/vscode-ui/styles.css', 'https://x/vscode-ui/inspector.css'],
    codicons: 'https://x/vscode-ui/codicons/codicon.css',
    script: 'https://x/webview.js',
  })
  assert.match(html, /<script type="module" nonce="n0nce" src="https:\/\/x\/webview.js">/)
  // The VS Code UI: its stylesheets after the Inspector's, the codicon stylesheet VSCode Elements reads, its font under
  // the policy's font-src, and the mount root marked for the shell's VS Code style.
  assert.match(
    html,
    /mount\.css">\n<link rel="stylesheet" href="https:\/\/x\/vscode-ui\/styles\.css">\n<link rel="stylesheet" href="https:\/\/x\/vscode-ui\/inspector\.css">/,
  )
  assert.match(html, /<link id="vscode-codicon-stylesheet" rel="stylesheet" href="https:\/\/x\/vscode-ui\/codicons\/codicon\.css">/)
  assert.match(policy, /font-src https:\/\/\*\.vscode-cdn\.net/)
  assert.match(html, /<div id="root" data-host-ui="vscode">/)
  // Before the script runs, VS Code's thin progress bar, shown only after 300 ms.
  assert.match(html, /<div class="pj-boot" role="progressbar" aria-label="Loading…" data-loading-indicator>/)
  assert.match(html, /\.pj-boot\{[^}]*height:2px[^}]*animation:pj-boot-show 0s linear 300ms forwards\}/)
  assert.doesNotMatch(html, /1<\/script>/, 'config JSON cannot close its script element')
  assert.doesNotMatch(html, /token/i)
})

test("a projection tab's page paints its skeleton before any script: toolbar, loading status and summary strip", () => {
  const page = config =>
    webviewHtml({
      cspSource: 'https://x',
      config: {assets: 'https://x/', engineWorker: 'https://x/e.js', comparatorWorker: 'https://x/c.js', nonce: 'n0nce', ...config},
      styles: ['https://x/mount.css'],
      codicons: 'https://x/codicon.css',
      script: 'https://x/webview.js',
    })
  const html = page({projection: 'packages', title: 'Packages <beta>', before: 'main', after: 'HEAD', chrome: 'none', toolbar: true})
  // The skeleton comes before the script, outside the mount root (which React replaces), and the panel's bar is gone.
  assert.ok(html.indexOf('data-skeleton') < html.indexOf('<script type="module"'))
  assert.match(html, /<div class="pj-skeleton" data-skeleton[^>]*>.*<\/div><div id="root" data-host-ui="vscode"><\/div>/s)
  assert.doesNotMatch(html, /pj-boot/)
  // The toolbar strip is empty: no stand-ins for its controls (no mode group, no dimmed actions); the one codicon is the spinner.
  assert.match(html, /<div class="pj-skeleton-toolbar" aria-hidden="true"><\/div>/)
  assert.doesNotMatch(html, /pj-skeleton-(modes|end|icon)|codicon-(filter|settings-gear|info|diff-single)\b/)
  assert.equal(html.match(/class="[^"]*\bcodicon\b/g)?.length, 1)
  assert.match(
    html,
    /codicon-loading codicon-modifier-spin" aria-hidden="true" data-loading-indicator><\/span><span>Loading Packages &lt;beta>…<\/span>/,
  )
  assert.match(html, /<div class="pj-skeleton-bar"/)
  // The real dimensions: a 35px toolbar with a hairline, a 22px summary strip, VS Code's colors only; no delay.
  assert.match(html, /\.pj-skeleton-toolbar\{[^}]*height:35px;border-bottom:1px solid var\(--vscode-contrastBorder/)
  assert.match(html, /\.pj-skeleton-bar\{[^}]*height:22px;border-top:1px solid/)
  assert.doesNotMatch(html.slice(html.indexOf('.pj-skeleton{'), html.indexOf('</style>')), /animation-delay|300ms/)
  assert.match(html, /prefers-reduced-motion:reduce\)\{\.pj-skeleton \.codicon-modifier-spin\{animation:none\}/)
  // One revision: the same empty strip. A definition that can't load: no skeleton, its failure instead.
  assert.match(
    page({projection: 'packages', title: 'Packages', after: 'working-tree'}),
    /<div class="pj-skeleton-toolbar" aria-hidden="true"><\/div>/,
  )
  assert.doesNotMatch(page({projection: 'packages', failure: {title: 'x', diagnostics: []}}), /data-skeleton/)
  // The editor's first document, before the folder or the backend: the skeleton alone, no script.
  const first = skeletonHtml({cspSource: 'https://x', nonce: 'n0nce', title: 'Packages', codicons: 'https://x/codicon.css'})
  assert.match(first, /data-skeleton/)
  assert.match(first, /Loading Packages…/)
  assert.doesNotMatch(first, /<script/)
})

test('host requests from the webview are validated', () => {
  assert.equal(relativePath('src/index.ts'), 'src/index.ts')
  assert.equal(relativePath('./a\\b.ts'), 'a/b.ts')
  for (const path of ['/etc/passwd', '../x', 'a/../../x', 'C:/x', '', 7, 'a\0b']) assert.equal(relativePath(path), undefined, String(path))
  assert.equal(position(3), 3)
  assert.equal(position(0), undefined)
  assert.equal(position(1.5), undefined)
  assert.equal(revision('working-tree'), 'working-tree')
  assert.equal(revision('HEAD~1'), 'HEAD~1')
  assert.equal(revision('feature/auth'), 'feature/auth')
  for (const ref of ['--output=x', '-x', 'a..b', 'a b', '']) assert.equal(revision(ref), undefined, ref)
})

test('the backend must speak a supported protocol and a compatible version; the CLI is found in order', () => {
  const info = {protocol: 1, version: '0.4.2', repository: '/r', trusted: false, explore: true}
  assert.deepEqual(parseInfo(info), info)
  assert.throws(() => parseInfo({...info, trusted: 'yes'}), /unsupported protocol/)
  assert.throws(() => parseInfo(null), /unsupported protocol/)
  const fromPath = {path: 'projections', source: 'path'}
  assert.equal(incompatibility(info, '0.4.0', fromPath), undefined)
  assert.match(incompatibility({...info, protocol: 2}, '0.4.0', fromPath), /speaks protocol 2; this extension speaks 1/)
  assert.match(
    incompatibility(info, '0.5.0', fromPath),
    /projections 0\.4\.2 at projections \(on PATH\) is not compatible with the Projections extension 0\.5\.0/,
  )
  assert.match(incompatibility(info, '0.5.0', {path: '/x', source: 'bundled'}), /Reinstall the Projections extension/)
  assert.match(incompatibility(info, '0.5.0', {path: '/x', source: 'setting'}), /from projections\.cliPath.*point projections\.cliPath/)
  assert.equal(compatibleVersion('1.2.0', '1.9.3'), true)
  assert.equal(compatibleVersion('1.2.0', '2.0.0'), false)
  assert.equal(compatibleVersion('0.3.1', '0.3.0-rc.1'), true)
  assert.equal(compatibleVersion('0.3.1', '0.4.0'), false)
  assert.equal(compatibleVersion('0.0.0', 'garbage'), false)

  const ext = path.join('/repo', 'packages', 'integrations', 'vscode')
  const bundled = bundledCli(ext, 'darwin', 'arm64')
  assert.equal(bundled, path.join(ext, 'bin', 'darwin-arm64', 'projections'))
  assert.equal(bundledCli(ext, 'win32', 'x64'), path.join(ext, 'bin', 'win32-x64', 'projections.exe'))
  const development = path.join('/repo', 'packages', 'cli', 'dist', 'projections')
  const resolve = (existing, setting, environment = {}) =>
    resolveCli({setting, extensionPath: ext, environment, platform: 'darwin', arch: 'arm64', exists: file => existing.includes(file)})
  // The setting, then PROJECTIONS_CLI (explicit choices win), then the bundled executable, a development build and PATH.
  assert.deepEqual(resolve([bundled, development], ' /opt/projections ', {PROJECTIONS_CLI: '/env'}), {
    path: '/opt/projections',
    source: 'setting',
  })
  assert.deepEqual(resolve([bundled, development], '', {PROJECTIONS_CLI: '/env'}), {path: '/env', source: 'environment'})
  assert.deepEqual(resolve([bundled, development], undefined), {path: bundled, source: 'bundled'})
  assert.deepEqual(resolve([development], undefined), {path: development, source: 'development'})
  assert.deepEqual(resolve([], undefined), {path: 'projections', source: 'path'})
  assert.equal(cliPath(undefined, '/nonexistent/ext', {}), 'projections')
})

test('change subscriptions are answered from notifications, at once when behind, and after a wait when quiet', async () => {
  let notify
  const requests = []
  const runner = {
    onNotification: listener => ((notify = listener), () => (notify = undefined)),
    request: async ({path}) => {
      requests.push(path)
      const since = Number(new URL(path, 'http://x').searchParams.get('since'))
      return {
        status: 200,
        contentType: 'application/json',
        body: {generation: 5, changes: since < 5 ? ['definitions'] : [], complete: true},
        size: 10,
      }
    },
  }
  const replies = []
  const bridge = createBridge(runner, reply => replies.push(reply))
  const settled = async count => {
    while (replies.length < count) await new Promise(resolve => setTimeout(resolve, 5))
  }
  // Behind the current generation (5, learned with since=0): the backend answers at once.
  bridge.receive({tag: transportTag, type: 'next', id: 1, channel: 'changes', since: 3})
  await settled(1)
  assert.deepEqual(requests, ['/api/changes?since=0', '/api/changes?since=3'])
  assert.deepEqual(replies[0], {
    tag: transportTag,
    id: 1,
    type: 'response',
    status: 200,
    body: {generation: 5, changes: ['definitions'], complete: true},
  })
  // Current: it waits for the next notification, without asking the backend.
  bridge.receive({tag: transportTag, type: 'next', id: 2, channel: 'changes', since: 5})
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(replies.length, 1)
  notify('changes', {generation: 5, changes: [], complete: true})
  notify('fixtures', {generation: 9})
  notify('changes', {generation: 6, changes: ['working-tree'], complete: true})
  await settled(2)
  assert.deepEqual(replies[1].body, {generation: 6, changes: ['working-tree'], complete: true})
  assert.equal(requests.length, 2)
  // An aborted subscription is never answered.
  bridge.receive({tag: transportTag, type: 'next', id: 3, channel: 'changes', since: 6})
  bridge.receive({tag: transportTag, type: 'abort', id: 3})
  notify('changes', {generation: 7, changes: ['definitions'], complete: true})
  // The fixtures channel is a long poll through the backend.
  bridge.receive({tag: transportTag, type: 'next', id: 4, channel: 'fixtures', since: 1})
  await settled(3)
  assert.deepEqual(
    replies.map(reply => reply.id),
    [1, 2, 4],
  )
  assert.equal(requests.at(-1), '/api/fixtures/changes?since=1')
  bridge.dispose()
  assert.equal(notify, undefined)
  // Quiet: after the wait, the unchanged answer, as the backend's long poll gives it.
  const quiet = []
  const waiting = createBridge(runner, reply => quiet.push(reply), {waitMs: 30})
  waiting.receive({tag: transportTag, type: 'next', id: 1, channel: 'changes', since: 5})
  while (!quiet.length) await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(quiet[0].body, {generation: 5, changes: [], complete: true})
  waiting.dispose()
})

test('custom renderer files are fetched from the backend for the webview; nothing else is', async () => {
  const runner = fakeRunner({
    '/custom-renderers/cap/working-tree/map/index.html?v=2': {status: 200, contentType: 'text/html; charset=utf-8', body: '<p>map</p>'},
    '/custom-renderers/cap/working-tree/x/index.html': {
      status: 403,
      contentType: 'application/json',
      body: {diagnostics: [{message: 'trust'}]},
    },
  })
  const bridge = createBridge(runner, () => {})
  assert.deepEqual(await bridge.rendererFile('/custom-renderers/cap/working-tree/map/index.html?v=2'), {
    type: 'text/html; charset=utf-8',
    base64: Buffer.from('<p>map</p>').toString('base64'),
  })
  assert.match((await bridge.rendererFile('/custom-renderers/cap/working-tree/x/index.html')).error, /unavailable \(403\).*trust/)
  for (const path of ['/api/definitions', '/custom-renderers/../api/x', '/custom-renderers/a#b', 'http://x/custom-renderers/a', 7])
    assert.equal((await bridge.rendererFile(path)).error, 'Not a custom renderer path', String(path))
  assert.equal(customRendererPath('/custom-renderers/a/b/index.html'), true)
  assert.equal(runner.seen.length, 2)
})

test('Adopt previews are validated, and refusals explain themselves', () => {
  const preview = {
    files: [{path: '.github/projections/x.json', before: null, after: '{}', created: true, changed: true}],
    digest: 'sha256:1',
    written: false,
  }
  assert.equal(parseWrite(preview), preview)
  assert.throws(() => parseWrite({...preview, files: [{path: 1}]}), /invalid preview/)
  assert.throws(() => parseWrite(null), /invalid preview/)
  assert.equal(refusal({status: 403, body: {diagnostics: [{message: 'Writing needs --trust'}]}}), 'Writing needs --trust (403)')
  assert.equal(refusal({status: 409, body: 'changed'}), 'changed (409)')
})

test('Add to CI hands the agent the same prompt as the guide, and writes nothing', async () => {
  const guide = await readFile(new URL('../../../../docs/setup/ci.md', import.meta.url), 'utf8')
  assert.ok(guide.includes(`\n${addToCiPrompt}\n`), 'docs/setup/ci.md holds the same prompt')
  const explore = await readFile(new URL('../../../host/inspector/src/explore.tsx', import.meta.url), 'utf8')
  assert.ok(explore.includes(JSON.stringify(addToCiPrompt)), 'the Explore view offers the same prompt')
  assert.ok(['agent', 'copy', 'guide'].every(isAddToCiChoice))
  assert.equal(isAddToCiChoice('write'), false)
})

test('documents and renderer scenarios open with serve --stdio --document or --fixtures, a package with its bundle', async t => {
  assert.deepEqual(sourceArguments({kind: 'repository'}), [])
  assert.deepEqual(sourceArguments({kind: 'document', path: '/r/review.json'}), ['--document', '/r/review.json'])
  assert.deepEqual(sourceArguments({kind: 'fixtures', path: '/r/renderer', renderer: true}), [
    '--fixtures',
    '/r/renderer',
    '--renderer',
    '/r/renderer',
  ])
  assert.deepEqual(sourceArguments({kind: 'fixtures', path: '/r/cases'}), ['--fixtures', '/r/cases'])
  const root = await mkdtemp(path.join(tmpdir(), 'projections-vscode-sources-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  assert.equal(rendererPackage(root), false)
  await writeFile(path.join(root, 'package.json'), JSON.stringify({projections: {renderer: 'dist'}}))
  assert.equal(rendererPackage(root), true)
  assert.equal(rendererPackage(fileURLToPath(new URL('../../../renderers/api/dist/', import.meta.url))), true)
})
