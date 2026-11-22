// Proves a released, self-contained CLI executable on its own platform: the binary is
// moved into an empty directory and run with Node absent from PATH. It needs nothing
// from this checkout except test fixtures, and it unpacks its embedded extractor
// helpers into the platform's default per-user cache on first use.
//
//   node packages/cli/test/binary.mjs [--binary PATH] [--gh-extension]
//
// Optional ecosystem helpers are proved when their tools are on PATH: `dotnet` (.NET 8+
// SDK), `go`, `python` and `node` with this checkout's `typescript`. Name tools that must
// be proved in PROJECTIONS_PROOF_REQUIRE (comma-separated: dotnet,go,python,typescript);
// PROJECTIONS_REQUIRE_HELPERS=1 requires the .NET proof as before.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {chmod, copyFile, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {finishedJob, startBackend} from './process.mjs'

const windows = process.platform === 'win32'
const exe = windows ? '.exe' : ''
const source = fileURLToPath(new URL('../../../', import.meta.url))
const {values} = parseArgs({options: {binary: {type: 'string'}, 'gh-extension': {type: 'boolean', default: false}}})
const built = path.resolve(values.binary ?? path.join(source, 'packages/cli/dist', `projections${exe}`))
const required = new Set((process.env.PROJECTIONS_PROOF_REQUIRE ?? '').split(',').filter(Boolean))
if (process.env.PROJECTIONS_REQUIRE_HELPERS === '1') required.add('dotnet')
for (const name of required) if (!['dotnet', 'go', 'python', 'typescript'].includes(name)) throw new Error(`Unknown required proof ${name}`)

/** The first executable named `name` on the caller's PATH. */
function find(name) {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const suffix of windows ? ['.exe', '.cmd', ''] : ['']) {
      const candidate = path.join(directory, name + suffix)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

const root = await realpath(await mkdtemp(path.join(tmpdir(), 'projections-binary-proof-')))
const proved = {}
try {
  // The binary alone, under the gh precompiled-extension name, in an empty directory.
  const install = path.join(root, 'gh-projections')
  await mkdir(install)
  const binary = path.join(install, `gh-projections${exe}`)
  await copyFile(built, binary)
  await chmod(binary, 0o755)
  assert.deepEqual(await readdir(install), [path.basename(binary)])
  const size = (await stat(binary)).size

  // Git only: no Node, Python, .NET or Go.
  const gitPath = find('git')
  assert.ok(gitPath, 'The proof requires Git on PATH')
  let tools
  if (windows) {
    tools = path.dirname(gitPath)
  } else {
    tools = path.join(root, 'tools')
    await mkdir(tools)
    await symlink(await realpath(gitPath), path.join(tools, 'git'))
  }
  for (const name of ['node', 'node.exe']) assert.ok(!existsSync(path.join(tools, name)), `${tools} must not contain Node`)
  const home = path.join(root, 'home')
  const cacheHome = path.join(root, 'cache-home')
  const localAppData = path.join(root, 'local-app-data')
  const temporary = path.join(root, 'tmp')
  for (const directory of [home, cacheHome, localAppData, temporary, path.join(root, 'app-data')]) await mkdir(directory)
  const expectedCache = windows
    ? path.join(localAppData, 'projections')
    : process.platform === 'darwin'
      ? path.join(home, 'Library/Caches/projections')
      : path.join(cacheHome, 'projections')
  const environment = (extra = []) => ({
    PATH: [tools, ...extra].join(path.delimiter),
    LANG: 'C.UTF-8',
    GIT_CONFIG_GLOBAL: windows ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: cacheHome,
    LOCALAPPDATA: localAppData,
    TMPDIR: temporary,
    TEMP: temporary,
    TMP: temporary,
    ...(process.env.SystemRoot ? {SystemRoot: process.env.SystemRoot} : {}),
  })
  const run = (args, {cwd = repo, extra, status = 0} = {}) => {
    const result = spawnSync(binary, args, {cwd, env: environment(extra), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600_000})
    if (result.error) throw result.error
    assert.equal(result.status, status, `projections ${args.join(' ')}\n${result.stderr}`)
    return result
  }
  const json = (args, options) => JSON.parse(run(args, options).stdout)

  const version = run(['--version'], {cwd: root}).stdout.trim()
  assert.match(version, /^projections \d+\.\d+\.\d+/u)
  assert.match(run(['--help'], {cwd: root}).stdout, /how a change reshapes them/u)
  const licenses = run(['licenses'], {cwd: root}).stdout
  assert.match(licenses, /^MIT License/u)
  assert.match(licenses, /Copyright \(c\) GitHub, Inc\./u)
  assert.ok(licenses.includes('Third-party licenses for the bundled native and Wasm engines.'))
  for (const dependency of ['react', 'wasmi', 'windows-sys', 'tokio', 'elkjs', 'perfect-arrows']) {
    assert.ok(licenses.includes(`===== ${dependency} `), `Missing ${dependency} notice`)
  }
  assert.match(licenses, /Distributed under EPL-2\.0\. Source: https:\/\/github\.com\/kieler\/elkjs\/tree\//u)

  // A repository with a built-in projection and one compared by a custom comparator.
  const repo = path.join(root, 'repo')
  await mkdir(repo)
  const git = (...args) => {
    const result = spawnSync('git', ['-c', `core.hooksPath=${windows ? 'NUL' : '/dev/null'}`, '-c', 'commit.gpgsign=false', ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: {...process.env, GIT_CONFIG_GLOBAL: windows ? 'NUL' : '/dev/null'},
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git('init', '--template=', '--quiet')
  git('config', 'user.name', 'Binary proof')
  git('config', 'user.email', 'binary@example.invalid')
  git('config', 'core.autocrlf', 'false')
  const commit = message => {
    git('add', '--all')
    git('commit', '--quiet', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  await mkdir(path.join(repo, 'src'))
  await writeFile(path.join(repo, 'src/core.txt'), 'core\n')
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n')
  run(['init', 'files', '--extractor', 'repository-map'])
  const files = JSON.parse(await readFile(path.join(repo, '.github/projections/files.json'), 'utf8'))
  await mkdir(path.join(repo, 'tools'))
  await copyFile(
    path.join(source, 'examples/comparators/priority-order/priority-order.comparator.yaml'),
    path.join(repo, 'tools/priority-order.comparator.yaml'),
  )
  const priority = {priority: ['file:src/later.txt']}
  await writeFile(
    path.join(repo, '.github/projections/files-rules.json'),
    JSON.stringify({...files, id: 'files-rules', comparator: {file: 'tools/priority-order.comparator.yaml', options: priority}}),
  )
  const before = commit('Before')
  await writeFile(path.join(repo, 'src/added.txt'), 'added\n')
  await writeFile(path.join(repo, 'src/later.txt'), 'later\n')
  const after = commit('After')

  const listed = json(['list', '--json'])
  assert.deepEqual(
    listed.projections.map(item => [item.id, item.requiresTrust]),
    [
      ['files', false],
      ['files-rules', false],
    ],
  )
  const shown = json(['show', before, '-p', 'files', '--json'])
  assert.equal(shown.format, 'projections.extraction')
  assert.match(run(['show', before, '-p', 'files']).stdout, /core\.txt/u)
  const defaultComparison = json(['compare', `${before}..${after}`, '-p', 'files', '--json'])
  assert.equal(defaultComparison.comparator.id, 'default')
  assert.ok(defaultComparison.comparison.changes.some(change => change.status === 'added'))
  assert.match(run(['compare', `${before}..${after}`, '-p', 'files']).stdout, /Added/u)
  const custom = json(['compare', `${before}..${after}`, '-p', 'files-rules', '--json'])
  assert.equal(custom.comparator.id, 'tools/priority-order.comparator.yaml')
  assert.match(custom.comparator.digest, /^sha256:[a-f0-9]{64}$/u)
  assert.equal(custom.comparison.changes.length, defaultComparison.comparison.changes.length)
  assert.equal(json(['compare', `${before}..${after}`, '--all', '--json']).failed, 0)
  run(['show', after, '-p', 'files', '--output', 'after.json'])
  assert.deepEqual(json(['validate', 'after.json', '--json']), {valid: true, format: 'projections.extraction'})
  run(['compare', `${before}..${after}`, '-p', 'files-rules', '--output', 'comparison.json'])
  assert.equal(json(['validate', 'comparison.json', '--comparator', 'tools/priority-order.comparator.yaml', '--json']).valid, true)

  // The editor backend (serve --stdio) validates its embedded assets at startup, serves the built-in renderer
  // catalog and runs a comparison job.
  const backend = await startBackend(binary, ['-C', repo], {cwd: repo, env: environment()})
  try {
    const catalog = await backend.request('GET', '/renderers/index.json')
    assert.equal(catalog.status, 200)
    assert.equal(catalog.body.format, 'projections.renderers')
    const definitions = (await backend.request('GET', '/api/definitions')).body
    assert.deepEqual(
      definitions.definitions.map(definition => definition.id),
      ['files', 'files-rules'],
    )
    const created = await backend.request('POST', '/api/jobs', {projectionId: 'files', before, after})
    const job = await finishedJob(backend, created.body)
    assert.equal(job.status, 'completed', JSON.stringify(job.diagnostics))
    assert.ok(job.comparison.comparison.changes.length > 0)
  } finally {
    const exit = await backend.close()
    if (!windows) assert.deepEqual(exit, {code: 0, signal: null}, backend.diagnostics())
  }
  // Nothing so far used a helper, so nothing was unpacked.
  assert.ok(!existsSync(path.join(expectedCache, 'helpers')), 'Helpers must be unpacked only on first use')

  const toolDirectory = async name => {
    const found = find(name)
    return found && path.dirname(await realpath(found))
  }
  const skip = (name, reason) => {
    assert.ok(!required.has(name), `${name} proof is required: ${reason}`)
    proved[name] = `skipped: ${reason}`
  }
  const cached = async () => {
    const helpers = path.join(expectedCache, 'helpers')
    const entries = (await readdir(helpers)).filter(name => !name.startsWith('.'))
    assert.equal(entries.length, 1, `Expected one unpacked helper set in ${helpers}: ${entries}`)
    return path.join(helpers, entries[0], 'helpers')
  }

  // Go: the embedded helper source, built by the repository's own Go toolchain.
  const goDirectory = await toolDirectory('go')
  if (!goDirectory) skip('go', 'go is not on PATH')
  else {
    const fixture = path.join(source, 'packages/extractors/go-public-api/tests/fixtures/compatibility/before')
    await cp(fixture, repo, {recursive: true})
    for (const name of ['gocache', 'gomodcache']) await mkdir(path.join(root, name))
    await writeFile(
      path.join(repo, '.github/projections/go.json'),
      JSON.stringify({
        id: 'go',
        renderer: 'api',
        extractor: 'go-public-api',
        inputs: {patterns: ['./...']},
        execution: {
          timeoutMs: 300000,
          environment: ['GOCACHE', 'GOMODCACHE', 'GOFLAGS', 'GOTOOLCHAIN', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR'],
        },
      }),
    )
    commit('Go')
    const goEnvironment = {
      GOCACHE: path.join(root, 'gocache'),
      GOMODCACHE: path.join(root, 'gomodcache'),
      GOFLAGS: '-mod=mod',
      GOTOOLCHAIN: 'local',
    }
    const goRun = () => {
      const result = spawnSync(binary, ['show', '-p', 'go', '--trust', '--json'], {
        cwd: repo,
        encoding: 'utf8',
        env: {...environment([goDirectory]), ...goEnvironment},
        maxBuffer: 64 * 1024 * 1024,
      })
      assert.equal(result.status, 0, result.stderr)
      return JSON.parse(result.stdout)
    }
    const first = goRun()
    assert.ok(first.extraction.entities.some(entity => entity.id === 'go:example.com/ledger.Ledger'))
    assert.equal(first.extraction.metadata.ecosystem, 'go')
    const helpers = await cached()
    for (const name of ['main.go', 'api.go']) {
      assert.deepEqual(
        await readFile(path.join(helpers, 'go', name)),
        await readFile(path.join(source, 'packages/extractors/go-support/helper', name)),
      )
    }
    // An altered cached helper is detected and replaced before it runs.
    await writeFile(path.join(helpers, 'go/main.go'), 'package main\nfunc main() { panic("altered") }\n')
    assert.equal(goRun().digest, first.digest)
    assert.deepEqual(
      await readFile(path.join(helpers, 'go/main.go')),
      await readFile(path.join(source, 'packages/extractors/go-support/helper/main.go')),
    )
    proved.go = true
  }

  // Django: the embedded Python helper runs and reports the missing framework.
  const python = find(windows ? 'python' : 'python3')
  if (!python) skip('python', 'python is not on PATH')
  else {
    await writeFile(
      path.join(repo, '.github/projections/django.json'),
      JSON.stringify({id: 'django', renderer: 'graph', extractor: 'django-schema', inputs: {settings: 'missing.settings', python}}),
    )
    commit('Django')
    const result = run(['show', '-p', 'django', '--trust', '--json'], {status: 1})
    assert.match(result.stderr, /[Dd]jango/u)
    assert.ok(existsSync(path.join(await cached(), 'python/django_schema.py')))
    proved.python = true
  }

  // TypeScript: the embedded helper bundle run with the repository's own Node and compiler.
  const nodeDirectory = path.dirname(process.execPath)
  const typescript = path.join(source, 'node_modules/typescript')
  if (!existsSync(typescript)) skip('typescript', 'node_modules/typescript is missing; run npm ci')
  else {
    await writeFile(path.join(repo, '.gitignore'), 'node_modules/\n')
    await cp(typescript, path.join(repo, 'node_modules/typescript'), {recursive: true})
    await writeFile(path.join(repo, 'index.ts'), 'export function binaryExport(value: string): string { return value }\n')
    await writeFile(
      path.join(repo, '.github/projections/api.json'),
      JSON.stringify({id: 'api', renderer: 'api', extractor: 'typescript-public-api', inputs: {entrypoints: ['index.ts']}}),
    )
    commit('TypeScript')
    const api = json(['show', '-p', 'api', '--json'], {extra: [nodeDirectory]})
    assert.ok(api.extraction.entities.some(entity => entity.id.includes('binaryExport')))
    proved.typescript = true
  }

  // .NET: the slim first-party helper on the repository's own SDK.
  const dotnetDirectory = await toolDirectory('dotnet')
  const sdk = dotnetDirectory && spawnSync('dotnet', ['--version'], {encoding: 'utf8'}).stdout?.trim()
  if (!sdk || !(Number.parseInt(sdk, 10) >= 8)) skip('dotnet', 'no .NET 8+ SDK on PATH')
  else {
    await mkdir(path.join(repo, 'dotnet'))
    await writeFile(
      path.join(repo, 'dotnet/Lib.csproj'),
      `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net${Number.parseInt(sdk, 10)}.0</TargetFramework><Nullable>enable</Nullable></PropertyGroup></Project>\n`,
    )
    await writeFile(
      path.join(repo, 'dotnet/Api.cs'),
      'namespace Binary;\npublic sealed class Greeter { public string Greet(string? name = null) => name ?? "hi"; internal void Hidden() { } }\n',
    )
    await writeFile(
      path.join(repo, 'dotnet/nuget.config'),
      '<configuration><packageSources><clear /></packageSources><auditSources><clear /></auditSources></configuration>\n',
    )
    await writeFile(
      path.join(repo, '.github/projections/dotnet.json'),
      JSON.stringify({
        id: 'dotnet',
        renderer: 'api',
        extractor: 'dotnet-public-api',
        inputs: {project: 'dotnet/Lib.csproj'},
        execution: {
          timeoutMs: 300000,
          environment: [
            'HOME',
            'USERPROFILE',
            'APPDATA',
            'LOCALAPPDATA',
            'ProgramData',
            'ProgramFiles',
            'TEMP',
            'TMP',
            'TMPDIR',
            'DOTNET_ROOT',
            'DOTNET_CLI_HOME',
          ],
        },
      }),
    )
    commit('.NET')
    const dotnetEnvironment = {
      ...environment([dotnetDirectory]),
      DOTNET_CLI_HOME: path.join(root, 'dotnet-home'),
      APPDATA: path.join(root, 'app-data'),
      ...Object.fromEntries(
        ['DOTNET_ROOT', 'ProgramData', 'ProgramFiles'].filter(name => process.env[name]).map(name => [name, process.env[name]]),
      ),
    }
    const result = spawnSync(binary, ['show', '-p', 'dotnet', '--trust', '--json'], {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: dotnetEnvironment,
    })
    if (result.status !== 0) {
      // The extractor's raw tool output, which the Inspector's jobs report.
      const backend = await startBackend(binary, ['-C', repo, '--trust'], {cwd: repo, env: dotnetEnvironment})
      let outputs
      try {
        const created = await backend.request('POST', '/api/jobs', {projectionId: 'dotnet', before: 'working-tree'})
        const job = await finishedJob(backend, created.body, {intervalMs: 100})
        outputs = JSON.stringify({status: job.status, diagnostics: job.diagnostics, outputs: job.outputs}, null, 1)
      } finally {
        await backend.close()
      }
      assert.fail(`${result.stderr}\n--- extractor outputs ---\n${outputs.slice(0, 16000)}`)
    }
    const api = JSON.parse(result.stdout).extraction
    const signatures = api.entities.map(entity => entity.data.signature).join('\n')
    assert.match(signatures, /Binary\.Greeter\.Greet\(System\.String\? name = null\)/u)
    assert.doesNotMatch(signatures, /Hidden/u)
    const helper = path.join(await cached(), 'dotnet')
    assert.deepEqual((await readdir(helper)).sort(), [
      'Projections.Dotnet.deps.json',
      'Projections.Dotnet.dll',
      'Projections.Dotnet.runtimeconfig.json',
    ])
    proved.dotnet = true
  }

  if (values['gh-extension']) {
    // A downloaded binary installed as a local GitHub CLI extension, offline and isolated.
    const gh = find('gh')
    assert.ok(gh, '--gh-extension requires gh on PATH')
    const config = path.join(root, 'gh-config')
    const data = path.join(root, 'gh-data')
    for (const directory of [config, data]) await mkdir(directory)
    // GitHub CLI requires a local extension's executable named exactly gh-projections,
    // and runs it on Windows through Git for Windows' sh.
    if (windows) await copyFile(binary, path.join(install, 'gh-projections'))
    const ghEnvironment = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      LOCALAPPDATA: localAppData,
      XDG_CACHE_HOME: cacheHome,
      XDG_CONFIG_HOME: config,
      XDG_DATA_HOME: data,
      XDG_STATE_HOME: data,
      GH_CONFIG_DIR: config,
      GH_HOST: 'github.invalid',
      GH_ENTERPRISE_TOKEN: 'offline-extension-proof-not-a-credential',
      GH_NO_UPDATE_NOTIFIER: '1',
      GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
      GH_PROMPT_DISABLED: '1',
      HTTP_PROXY: 'http://127.0.0.1:9',
      HTTPS_PROXY: 'http://127.0.0.1:9',
      NO_PROXY: '',
    }
    const ghRun = (args, cwd) => {
      const result = spawnSync(gh, args, {cwd, env: ghEnvironment, encoding: 'utf8', timeout: 60_000})
      assert.equal(result.status, 0, `gh ${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
      return result.stdout
    }
    ghRun(['extension', 'install', '.'], install)
    assert.equal(ghRun(['projections', '--version'], repo).trim(), version)
    assert.ok(JSON.parse(ghRun(['projections', 'list', '--json'], repo)).projections.some(item => item.id === 'files'))
    assert.match(ghRun(['extension', 'list'], repo), /projections/u)
    proved.ghExtension = true
  }

  console.log(
    JSON.stringify({
      binary: built,
      platform: `${process.platform}-${process.arch}`,
      version,
      bytes: size,
      nodeAbsentFromPath: true,
      cache: expectedCache,
      licenses: true,
      comparators: ['default', 'tools/priority-order.comparator.yaml'],
      inspector: true,
      ...proved,
    }),
  )
} finally {
  await rm(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 200})
}
