import assert from 'node:assert/strict'
import {execFileSync, spawnSync} from 'node:child_process'
import {cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {finishedJob, pullRequestTools, startBackend} from './process.mjs'
import {helperFiles} from '../../extractors/dotnet-support/scripts/publish.mjs'

const source = fileURLToPath(new URL('../../../', import.meta.url))
const windows = process.platform === 'win32'
const exe = windows ? '.exe' : ''
const ghExtension = process.argv[2] === '--gh-extension'
if (process.argv.length > 3 || (process.argv[2] && !ghExtension)) throw new Error('Supported installed-proof option: --gh-extension')
const license = await readFile(path.join(source, 'LICENSE'), 'utf8')
const root = await mkdtemp(path.join(tmpdir(), 'projections-installed-proof-'))
// The CLI unpacks its embedded extractor helpers into this isolated per-user cache: under HOME, or LOCALAPPDATA on
// Windows, which also needs SystemRoot to start any process.
const home = path.join(root, 'home')
const localAppData = path.join(home, 'AppData', 'Local')
const isolated = {
  HOME: home,
  XDG_CACHE_HOME: path.join(home, '.cache'),
  ...(windows ? {USERPROFILE: home, LOCALAPPDATA: localAppData, APPDATA: path.join(home, 'AppData', 'Roaming')} : {}),
  ...(process.env.SystemRoot ? {SystemRoot: process.env.SystemRoot} : {}),
}
// npm is a .cmd shim on Windows, which can't run without a shell: run the npm running this proof, as node and its script.
const npm = (args, options) =>
  process.env.npm_execpath
    ? execFileSync(process.execPath, [process.env.npm_execpath, ...args], options)
    : execFileSync('npm', args, {...options, shell: windows})
// Installs outside the workspace use its registry (the committed .npmrc, or CI's npm_config_registry), not npm's default.
const registry = npm(['config', 'get', 'registry'], {cwd: source, encoding: 'utf8'}).trim()
const environment = {
  PATH: process.env.PATH,
  LANG: 'C.UTF-8',
  GIT_CONFIG_GLOBAL: '/dev/null',
  npm_config_registry: registry,
  ...(windows ? {TEMP: process.env.TEMP, TMP: process.env.TMP} : {}),
  ...isolated,
}
const invoke = (command, args, cwd) => {
  const options = {cwd, encoding: 'utf8', env: environment, maxBuffer: 8 * 1024 * 1024}
  return command === 'npm' ? npm(args, options) : execFileSync(command, args, options)
}
/** The first executable named `name` on PATH. */
function find(name) {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean))
    for (const suffix of windows ? ['.exe', '.cmd', ''] : [''])
      if (existsSync(path.join(directory, name + suffix))) return path.join(directory, name + suffix)
  throw new Error(`${name} is not on PATH`)
}
try {
  const packs = path.join(root, 'packs')
  const install = path.join(root, ghExtension ? 'gh-projections' : 'install')
  await mkdir(packs)
  await mkdir(install)
  await mkdir(home)
  // The CLI is one self-contained executable, never an npm package: copy it alone.
  const bin = path.join(root, 'bin')
  await mkdir(bin)
  const binary = path.join(bin, `projections${exe}`)
  await cp(path.join(source, 'packages/cli/dist', `projections${exe}`), binary)
  const names = ['schemas', 'machine', 'engine', 'comparator-runtime', 'renderer-sdk', 'renderer-testing', 'host', 'inspector']
  const packed = JSON.parse(
    invoke(
      'npm',
      [
        'pack',
        '--ignore-scripts',
        '--json',
        '--silent',
        '--pack-destination',
        packs,
        ...names.flatMap(name => ['--workspace', `@githubnext/projections-${name}`]),
      ],
      source,
    ),
  )
  const dependencies = Object.fromEntries(packed.map(pkg => [pkg.name, `file:${path.join(packs, pkg.filename)}`]))
  for (const name of ['react', 'react-dom'])
    dependencies[name] = JSON.parse(await readFile(path.join(source, 'node_modules', name, 'package.json'), 'utf8')).version
  await writeFile(
    path.join(install, 'package.json'),
    JSON.stringify({name: 'installed-cli-proof', private: true, type: 'module', dependencies}),
  )
  invoke(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--cache',
      path.join(root, 'npm-cache'),
      '--package-lock=false',
      '--no-audit',
      '--no-fund',
      '--omit=dev',
    ],
    install,
  )
  for (const name of names) {
    const location = path.join(install, 'node_modules/@githubnext', `projections-${name}`)
    assert.equal((await lstat(location)).isSymbolicLink(), false)
    assert.ok((await realpath(location)).startsWith(await realpath(install)))
    assert.equal(await readFile(path.join(location, 'LICENSE'), 'utf8'), license, `${name} must retain the first-party MIT license`)
  }
  const repo = path.join(root, 'repo')
  await cp(path.join(source, 'examples/polyglot'), repo, {recursive: true})
  const git = (...args) => invoke('git', ['-c', 'core.hooksPath=/dev/null', ...args], repo).trim()
  git('init', '--template=', '-q')
  git('config', 'user.name', 'Installed CLI proof')
  git('config', 'user.email', 'installed@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  const commit = () => {
    git('add', '--all')
    git('commit', '-qm', 'fixture')
    return git('rev-parse', 'HEAD')
  }
  const before = commit()
  const cli = (...args) => invoke(binary, args, repo).trim()
  const first = JSON.parse(cli('show', before, '-p', 'services-node', '--trust', '--json'))
  const python = JSON.parse(cli('show', before, '-p', 'services-python', '--trust', '--json'))
  assert.equal(first.digest, python.digest)
  const services = JSON.parse(await readFile(path.join(repo, 'services.json'), 'utf8'))
  services.services.push({name: 'queue', language: 'Go', dependencies: []})
  await writeFile(path.join(repo, 'services.json'), JSON.stringify(services))
  const after = commit()
  const comparison = JSON.parse(cli('compare', `${before}..${after}`, '-p', 'services-node', '--trust', '--json'))
  assert.match(cli('compare', `${before}..${after}`, '-p', 'services-node', '--trust'), /Added entity/)
  assert.ok(comparison.comparison.changes.length > 0)
  const collected = JSON.parse(cli('show', '--all', before, '--trust', '--json'))
  assert.equal(collected.results.length, 2)
  assert.equal(collected.failed, 0)
  assert.equal(JSON.parse(cli('compare', `${before}..${after}`, '--all', '--trust', '--json')).results[0].status, 'changed')
  await writeFile(
    path.join(repo, '.projections-bookmarks.json'),
    JSON.stringify({
      format: 'projections.bookmarks',
      version: 0,
      bookmarks: [{id: 'working', title: 'Installed working scenario', projectionId: 'services-node', before}],
    }),
  )
  assert.equal(JSON.parse(cli('bookmark', 'list', '--json')).bookmarks[0].after, 'working-tree')
  assert.equal(JSON.parse(cli('bookmark', 'run', '--trust', '--json')).results[0].status, 'changed')
  const snapshot = path.join(root, 'after.json')
  await writeFile(snapshot, JSON.stringify(comparison.after))
  assert.deepEqual(JSON.parse(cli('validate', snapshot, '--json')), {valid: true, format: 'projections.extraction'})
  assert.equal(
    JSON.parse(cli('compare', '--before-extraction', snapshot, '--after-extraction', snapshot, '--json')).comparison.changes.length,
    0,
  )
  cli('init', 'files', '--extractor', 'repository-map')
  const prBase = commit()
  // Git alone on PATH. Git for Windows finds its installation from its own path, so there PATH is the directory of its
  // git.exe launcher (cmd), which has no Node, rather than a link to it.
  const gitPath = await realpath(find('git'))
  let noNode = path.dirname(gitPath)
  if (!windows) {
    noNode = path.join(root, 'no-node-tools')
    await mkdir(noNode)
    await symlink(gitPath, path.join(noNode, 'git'))
  }
  for (const name of ['node', 'node.exe']) assert.ok(!existsSync(path.join(noNode, name)), `${noNode} must not contain Node`)
  const noNodeCli = (...args) =>
    execFileSync(binary, args, {cwd: repo, encoding: 'utf8', env: {PATH: noNode, ...isolated}, maxBuffer: 8 * 1024 * 1024})
  assert.match(noNodeCli('--help'), /how a change reshapes them/)
  assert.equal(
    JSON.parse(noNodeCli('show', prBase, '-p', 'files', '--json')).digest,
    JSON.parse(cli('show', prBase, '-p', 'files', '--json')).digest,
  )
  await writeFile(path.join(repo, 'pr-change.txt'), 'actual exact PR object')
  const prHead = commit()
  // A pull request from a fork, with stand-ins for gh and git, which are /bin/sh scripts: the CLI runs gh.exe and git.exe
  // on Windows, which a script can't stand in for. The Rust suites' pull request tests have the same limit.
  const controlledPr = !windows
  if (controlledPr) {
    const prTools = path.join(root, 'pr-tools')
    await mkdir(prTools)
    await pullRequestTools(prTools, {
      gitPath,
      repository: repo,
      base: prBase,
      head: prHead,
      metadata: {
        html_url: 'https://github.com/example/tiny/pull/11',
        base: {sha: prBase, repo: {id: 1, full_name: 'example/tiny'}},
        head: {sha: prHead, repo: {id: 2, full_name: 'example/fork'}},
      },
    })
    const prCache = path.join(root, 'pr-cache')
    await mkdir(prCache)
    const pr = spawnSync(
      binary,
      ['pr', '11', '-R', 'example/tiny', '--cache', prCache, '--id', 'files', '--id', 'services-node', '--json'],
      {
        cwd: repo,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        env: {
          PATH: `${prTools}${path.delimiter}${process.env.PATH}`,
          LANG: 'C.UTF-8',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GITHUB_TOKEN: 'must-not-be-forwarded',
          ...isolated,
        },
      },
    )
    assert.equal(pr.status, 1, pr.stderr)
    assert.match(pr.stderr, /1 of the pull request's comparisons failed/)
    const prReview = JSON.parse(pr.stdout)
    assert.equal(prReview.mergeBase, prBase)
    assert.equal(prReview.execution, 'untrusted')
    assert.deepEqual(
      prReview.comparisons.results.map(item => item.status),
      ['changed', 'error'],
    )
    assert.equal(prReview.site, undefined)
  }
  cli('init', 'native-ts', '--extractor', 'typescript-public-api')
  const typescriptDefinition = path.join(repo, '.github/projections/native-ts.json')
  const authored = JSON.parse(await readFile(typescriptDefinition, 'utf8'))
  await writeFile(typescriptDefinition, JSON.stringify({...authored, inputs: {...authored.inputs, entrypoints: ['index.ts']}}))
  await writeFile(path.join(repo, 'index.ts'), 'export function nativeExport(value: string): string { return value }\n')
  // TypeScript extractors use the repository's own compiler, which Projections never ships.
  assert.match(
    spawnSync(binary, ['show', '-p', 'native-ts', '--json'], {
      cwd: repo,
      encoding: 'utf8',
      env: {PATH: process.env.PATH, LANG: 'C.UTF-8', ...isolated},
    }).stderr,
    /No \x60typescript\x60 package is installed there/,
  )
  await writeFile(path.join(repo, '.gitignore'), 'node_modules/\n')
  await cp(path.join(source, 'node_modules/typescript'), path.join(repo, 'node_modules/typescript'), {recursive: true})
  const typed = JSON.parse(cli('show', '-p', 'native-ts', '--json'))
  assert.equal(typed.extraction.schema, 'api/v0')
  assert.ok(
    typed.extraction.entities.some(node => node.id.includes('nativeExport')),
    'Packed native CLI invokes the explicitly selected TypeScript compiler adapter',
  )
  // The slim .NET helper: first-party code only, embedded in the executable and run with
  // the repository's own SDK, whose Roslyn compiles the project's public API.
  const helperSets = windows
    ? path.join(localAppData, 'projections', 'helpers')
    : path.join(home, process.platform === 'darwin' ? 'Library/Caches' : '.cache', 'projections/helpers')
  // The Python module unpacks beside the helper set, in an order readdir doesn't fix.
  const dotnetHelper = (await readdir(helperSets))
    .filter(name => !name.startsWith('.'))
    .map(name => path.join(helperSets, name, 'helpers/dotnet'))
    .find(existsSync)
  const dotnetPackaged = dotnetHelper !== undefined
  if (process.env.PROJECTIONS_REQUIRE_HELPERS === '1') assert.ok(dotnetPackaged, 'The executable must embed the .NET helper')
  // On Windows, dotnet fails in the extractor's environment (PATH, SystemRoot and its own variables): "An issue was
  // encountered verifying workloads". Open: whether extractors should get Windows' machine locations (ProgramData,
  // ProgramFiles). The helper's embedding and size are still checked.
  const dotnetRuns = dotnetPackaged && !windows
  if (dotnetPackaged) {
    assert.deepEqual((await readdir(dotnetHelper)).sort(), helperFiles)
    let bytes = 0
    for (const file of helperFiles) bytes += (await stat(path.join(dotnetHelper, file))).size
    assert.ok(bytes < 512 * 1024, `The .NET helper ships ${bytes} bytes; it must borrow Roslyn, DI and EF Core rather than bundle them`)
  }
  if (dotnetRuns) {
    const sdk = invoke('dotnet', ['--version'], repo).trim()
    await mkdir(path.join(repo, 'dotnet'))
    await writeFile(
      path.join(repo, 'dotnet/Lib.csproj'),
      `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net${Number.parseInt(sdk, 10)}.0</TargetFramework><Nullable>enable</Nullable></PropertyGroup></Project>\n`,
    )
    await writeFile(
      path.join(repo, 'dotnet/Api.cs'),
      'namespace Installed;\npublic sealed class Greeter { public string Greet(string? name = null) => name ?? "hi"; internal void Hidden() { } }\n',
    )
    await writeFile(
      path.join(repo, 'dotnet/nuget.config'),
      '<configuration><packageSources><clear /></packageSources><auditSources><clear /></auditSources></configuration>\n',
    )
    cli('init', 'native-dotnet', '--extractor', 'dotnet-public-api')
    const dotnetDefinition = path.join(repo, '.github/projections/native-dotnet.json')
    const dotnetAuthored = JSON.parse(await readFile(dotnetDefinition, 'utf8'))
    await writeFile(
      dotnetDefinition,
      JSON.stringify({...dotnetAuthored, inputs: {project: 'dotnet/Lib.csproj'}, execution: {timeoutMs: 300000}}),
    )
    const api = JSON.parse(cli('show', '-p', 'native-dotnet', '--trust', '--json')).extraction
    assert.equal(api.schema, 'api/v0')
    const signatures = api.entities.map(entity => entity.data.signature).join('\n')
    assert.match(signatures, /Installed\.Greeter\.Greet\(System\.String\? name = null\)/)
    assert.doesNotMatch(signatures, /Hidden/)
    assert.ok(!existsSync(path.join(repo, 'dotnet/obj')), 'application build outputs stay outside the checkout')
  }
  // The packed executable's editor backend, without Node on PATH, runs a comparison job.
  const native = await startBackend(binary, ['-C', repo, '--trust'], {env: {PATH: noNode, ...isolated}})
  try {
    const created = await native.request('POST', '/api/jobs', {projectionId: 'files', before: prBase, after: prHead})
    assert.equal(created.status, 202)
    const job = await finishedJob(native, created.body)
    assert.equal(job.status, 'completed', JSON.stringify(job.diagnostics))
    assert.ok(job.comparison.comparison.changes.length > 0)
  } finally {
    assert.deepEqual(await native.close(), {code: 0, signal: null}, native.diagnostics())
  }
  const server = await startBackend(binary, ['-C', repo, '--trust'], {
    cwd: repo,
    env: {PATH: process.env.PATH, LANG: 'C.UTF-8', ...isolated},
  })
  try {
    // The embedded assets were validated at startup; the built-in renderer catalog comes from them.
    const catalog = await server.request('GET', '/renderers/index.json')
    assert.equal(catalog.status, 200)
    assert.equal(catalog.body.format, 'projections.renderers')
    // Over a megabyte of notices, past execFileSync's default buffer.
    const licenses = execFileSync(binary, ['licenses'], {
      encoding: 'utf8',
      env: {PATH: process.env.PATH, LANG: 'C.UTF-8', ...isolated},
      maxBuffer: 64 * 1024 * 1024,
    })
    assert.match(licenses, /Copyright \(c\) GitHub, Inc\./)
    assert.match(licenses, /Permission is hereby granted, free of charge/)
    for (const dependency of ['react', 'react-dom', 'scheduler', 'elkjs']) assert.ok(licenses.includes(`===== ${dependency} `))
    assert.ok(licenses.includes('LICENSE.schemasafe.txt'))
    assert.ok(licenses.includes('Third-party licenses for the bundled native and Wasm engines.'))
    assert.ok(!licenses.includes('.NET extractor helper'), 'The slim .NET helper redistributes no NuGet packages')
    const response = await server.request('POST', '/api/jobs', {projectionId: 'services-node', before, after})
    assert.equal(response.status, 202)
    const job = await finishedJob(server, response.body)
    assert.equal(job.status, 'completed', JSON.stringify(job.diagnostics))
    assert.ok(job.comparison.comparison.changes.length > 0)
  } finally {
    assert.deepEqual(await server.close(), {code: 0, signal: null}, server.diagnostics())
  }
  const review = await startBackend(binary, ['--document', snapshot], {
    cwd: root,
    env: {PATH: process.env.PATH, LANG: 'C.UTF-8', ...isolated},
  })
  try {
    const document = (await review.request('GET', '/api/document')).body
    assert.equal(document.document.digest, comparison.after.digest)
  } finally {
    assert.deepEqual(await review.close(), {code: 0, signal: null}, review.diagnostics())
  }
  if (ghExtension) {
    const {verifyGhExtension} = await import('./gh-extension-proof.mjs')
    await verifyGhExtension({source, fixture: install, binary, repo, revision: before, snapshot: first})
  }
  console.log(
    JSON.stringify({
      packages: names.length,
      standaloneCli: true,
      freshDependencyCache: true,
      ghExtension,
      workspaceLinks: false,
      firstPartyLicenses: true,
      bundledNotices: true,
      noNodeNativeCli: true,
      noNodeNativeInspector: true,
      repositoryTypeScript: true,
      repositoryDotnet: dotnetRuns,
      nodeAndPython: true,
      nativeComparison: true,
      batches: true,
      workingTreeBookmarks: true,
      controlledUntrustedPr: controlledPr,
      savedDocuments: true,
      installedInspectorAssetsAndJobs: true,
      offlineReview: true,
    }),
  )
} finally {
  await rm(root, {recursive: true, force: true})
}
