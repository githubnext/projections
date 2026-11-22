import assert from 'node:assert/strict'
import {copyFile, mkdir, readFile, rename} from 'node:fs/promises'
import {createServer} from 'node:http'
import path from 'node:path'
import {runBounded} from './process.mjs'

export async function verifyGhExtension({source, fixture, binary, repo, revision, snapshot}) {
  const config = path.join(fixture, 'isolated-gh-config')
  const home = path.join(fixture, 'isolated-home')
  const data = path.join(fixture, 'isolated-data')
  for (const directory of [config, home, data]) await mkdir(directory)
  // gh names a local extension after its directory and runs the same-named executable in it.
  const extension = path.join(fixture, 'tools/gh-projections')
  await mkdir(extension, {recursive: true})
  await copyFile(path.join(source, 'tools/gh-projections/gh-projections'), path.join(extension, 'gh-projections'))
  await mkdir(path.join(fixture, 'packages/cli/dist'), {recursive: true})
  await copyFile(binary, path.join(fixture, 'packages/cli/dist/projections'))
  const requests = []
  const proxy = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    response.writeHead(502)
    response.end('Network is forbidden in the local extension proof')
  })
  proxy.on('connect', (request, socket) => {
    requests.push(`CONNECT ${request.url}`)
    socket.end('HTTP/1.1 502 Network forbidden\r\n\r\n')
  })
  await new Promise(resolve => {
    proxy.listen(0, '127.0.0.1', resolve)
  })
  const address = proxy.address()
  assert.ok(address && typeof address !== 'string')
  const proxyUrl = `http://127.0.0.1:${address.port}`
  const env = {
    PATH: process.env.PATH,
    ...(process.env.GIT_EXEC_PATH ? {GIT_EXEC_PATH: process.env.GIT_EXEC_PATH} : {}),
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    GH_CONFIG_DIR: config,
    GH_HOST: 'github.invalid',
    GH_ENTERPRISE_TOKEN: 'offline-extension-proof-not-a-credential',
    GH_NO_UPDATE_NOTIFIER: '1',
    GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
    GH_PROMPT_DISABLED: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    NO_PROXY: '',
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    all_proxy: proxyUrl,
    no_proxy: '',
  }
  const invoke = async (command, args, cwd) =>
    runBounded(command, args, {
      cwd,
      env,
      label: 'Isolated gh extension proof',
      timeoutMs: 60_000,
      maxStdoutBytes: 8 * 1024 * 1024,
    })
  try {
    await invoke('git', ['init', '--template=', '--quiet'], fixture)
    await invoke('git', ['remote', 'add', 'origin', 'https://github.invalid/local/projections.git'], fixture)
    await invoke('git', ['add', 'tools/gh-projections/gh-projections'], fixture)
    await invoke(
      'git',
      [
        '-c',
        'user.name=Extension proof',
        '-c',
        'user.email=extension@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'Local extension fixture',
      ],
      fixture,
    )
    await invoke('gh', ['extension', 'install', '.'], extension)
    const help = await invoke('gh', ['projections', '--help'], repo)
    const standalone = await invoke(path.join(fixture, 'packages/cli/dist/projections'), ['--help'], repo)
    assert.equal(help.stdout, standalone.stdout)
    assert.match(help.stdout, /show\s+Show one revision/u)
    const collection = await invoke('gh', ['projections', 'show', revision, '-p', 'services-node', '--trust', '--json'], repo)
    // How and when it ran differ: HEAD has moved past the revision, so it is materialized rather than extracted in place.
    const stable = ({provenance: {execution, limitations, ...provenance}, ...document}) => ({...document, provenance})
    assert.deepEqual(stable(JSON.parse(collection.stdout)), stable(snapshot))
    await assert.rejects(invoke('gh', ['projections', 'show', revision, '-p', 'services-node'], repo), /--trust/u)
    const output = 'gh snapshot with spaces.json'
    await invoke('gh', ['projections', 'show', revision, '-p', 'services-node', '--trust', '--output', output], repo)
    assert.equal(JSON.parse(await readFile(path.join(repo, output), 'utf8')).digest, snapshot.digest)
    const main = path.join(fixture, 'packages/cli/dist/projections')
    await rename(main, `${main}.saved`)
    try {
      await assert.rejects(invoke('gh', ['projections', '--help'], repo), /built native CLI is missing[\s\S]*npm ci[\s\S]*npm run build/u)
    } finally {
      await rename(`${main}.saved`, main)
    }
    const installed = await invoke('gh', ['extension', 'list'], fixture)
    assert.match(installed.stdout, /gh projections/u)
    assert.deepEqual(requests, [], 'Local installation/invocation must not call a live API or update endpoint')
  } finally {
    await new Promise((resolve, reject) => {
      proxy.close(error => (error ? reject(error) : resolve()))
    })
  }
}
