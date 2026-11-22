// `tools link`/`unlink`, the `projections-tools` launcher and doctor's view of it, in temporary HOME and bin
// directories: never the real ~/.local/bin.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {delimiter, dirname, join} from 'node:path'
import test from 'node:test'
import {linkFindings, linkReport, unlinkReport} from '../src/commands/link.ts'
import {UsageError} from '../src/commands/work/change-set.ts'
import {findCheckout, findNode, launcherText, readLauncher, type Host} from '../src/lib/link.ts'
import {workspaceRoot} from '../src/lib/repo.ts'

const posixOnly = {skip: process.platform === 'win32' ? 'the launcher script is POSIX sh' : false}

function scratch(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'tools-link-')))
  test.after(() => rmSync(directory, {recursive: true, force: true}))
  return directory
}

/** A minimal Projections checkout whose bin.ts reports how it was run. */
function checkout(directory: string, nodeVersion?: string): string {
  mkdirSync(join(directory, 'tools/cli/src'), {recursive: true})
  writeFileSync(join(directory, 'tools/cli/package.json'), JSON.stringify({name: '@githubnext/projections-tools'}))
  writeFileSync(
    join(directory, 'tools/cli/src/bin.ts'),
    `process.stdout.write(JSON.stringify({cwd: process.cwd(), initCwd: process.env.INIT_CWD, bin: process.env.PROJECTIONS_TOOLS_BIN, argv0: process.argv0, args: process.argv.slice(2)}))\n`,
  )
  if (nodeVersion) writeFileSync(join(directory, '.node-version'), `${nodeVersion}\n`)
  return directory
}

function host(home: string, overrides: Partial<Host> = {}): Host {
  return {platform: 'linux', env: {PATH: ''}, home, execPath: '/opt/node/bin/node', version: 'v26.12.1', ...overrides}
}

test('findCheckout: the nearest workspace root upwards, or one a Git repository root holds a directory down', () => {
  const base = scratch()
  const standalone = checkout(join(base, 'projections'))
  mkdirSync(join(standalone, '.git'))
  mkdirSync(join(standalone, 'packages/renderers/graph'), {recursive: true})
  assert.equal(findCheckout(join(standalone, 'packages/renderers/graph')), standalone)
  assert.equal(findCheckout(standalone), standalone)

  const root = checkout(join(base, 'repo/public'))
  writeFileSync(join(base, 'repo/.git'), 'gitdir: elsewhere\n')
  mkdirSync(join(base, 'repo/src'), {recursive: true})
  assert.equal(findCheckout(join(root, 'renderers')), root)
  assert.equal(findCheckout(join(base, 'repo/src')), root)
  assert.equal(findCheckout(join(base, 'repo')), root)

  mkdirSync(join(base, 'elsewhere/tools'), {recursive: true})
  writeFileSync(join(base, 'elsewhere/tools/package.json'), JSON.stringify({name: 'another-tools'}))
  assert.equal(findCheckout(join(base, 'elsewhere')), undefined, 'a tools/ that is not this package is not a checkout')
  assert.equal(findCheckout(base), undefined, 'a directory that is not a repository root is not searched below')
})

test('findNode: this Node when it is the pinned one, else a version manager’s, else this one unmatched', () => {
  const base = scratch()
  const root = checkout(join(base, 'checkout'), 'v26.12.1')
  const home = join(base, 'home')
  assert.deepEqual(findNode(root, host(home)), {path: '/opt/node/bin/node', version: '26.12.1', pinned: '26.12.1', matched: true})

  const other = host(home, {version: 'v24.0.0'})
  const none = findNode(root, other, () => false)
  assert.deepEqual(none, {path: '/opt/node/bin/node', version: '24.0.0', pinned: '26.12.1', matched: false})
  const nvm = join(home, '.nvm/versions/node/v26.12.1/bin/node')
  assert.equal(findNode(root, other, path => path === nvm).path, nvm)
  const custom = join(base, 'nvm/versions/node/v26.12.1/bin/node')
  assert.equal(findNode(root, {...other, env: {NVM_DIR: join(base, 'nvm')}}, path => path === custom).path, custom)

  const unpinned = checkout(join(base, 'unpinned'))
  assert.equal(findNode(unpinned, other).matched, true, 'nothing pinned: this Node is fine')
})

test('launcherText and readLauncher: what a launcher records survives quoting, on POSIX and Windows', () => {
  const recorded = {checkout: "/home/o'neil/projections", node: "/home/o'neil/.nvm/versions/node/v26.12.1/bin/node"}
  const posix = launcherText("/home/o'neil/.local/bin/projections-tools", recorded, 'linux')
  assert.ok(posix.startsWith('#!/bin/sh\n'))
  assert.deepEqual(readLauncher(posix), {kind: 'launcher', ...recorded})
  const windows = {checkout: 'C:\\src\\projections', node: 'C:\\nvm\\v26.12.1\\node.exe'}
  const cmd = launcherText('C:\\Users\\me\\.local\\bin\\projections-tools.cmd', windows, 'win32')
  assert.ok(cmd.includes('\r\n') && cmd.includes('%*'))
  assert.deepEqual(readLauncher(cmd), {kind: 'launcher', ...windows})
  assert.deepEqual(readLauncher('#!/bin/sh\nexec something\n'), {kind: 'foreign'})
  assert.deepEqual(readLauncher(undefined), {kind: 'absent'})
})

test('the launcher says its checkout is gone, printing the path as it is', posixOnly, () => {
  const base = scratch()
  const gone = join(base, 'gone `$HOME` "\\n\'')
  const path = join(base, 'projections-tools')
  writeFileSync(path, launcherText(path, {checkout: gone, node: process.execPath}, 'linux'))
  chmodSync(path, 0o755)
  const run = spawnSync(path, [], {encoding: 'utf8'})
  assert.equal(run.status, 3)
  assert.equal(
    run.stderr,
    `projections-tools: the linked checkout is gone (moved or deleted); run \`npm run tools -- link\` in a checkout: ${gone}\n`,
  )
})

test('link: dry run, write, idempotent, relink another checkout, and never a foreign file', () => {
  const base = scratch()
  const home = join(base, 'home')
  const binDir = join(base, 'bin')
  const path = join(binDir, 'projections-tools')
  const first = checkout(join(base, 'first'))
  const second = checkout(join(base, 'second'))
  const on = host(home, {env: {PATH: binDir}})

  const planned = linkReport(first, {binDir, dryRun: true}, on)
  assert.equal(planned.status, 'planned')
  assert.equal(existsSync(binDir), false, 'a dry run writes nothing')

  const linked = linkReport(first, {binDir, dryRun: false}, on)
  assert.equal(linked.status, 'linked')
  assert.deepEqual(linked.warnings, [])
  // The host is Linux; a Windows file system has no execute bits to check.
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o111, 0o111, 'executable')
  assert.deepEqual(readLauncher(readFileSync(path, 'utf8')), {kind: 'launcher', checkout: first, node: '/opt/node/bin/node'})
  assert.equal(linkReport(first, {binDir, dryRun: false}, on).status, 'unchanged')

  const relinked = linkReport(second, {binDir, dryRun: false}, on)
  assert.equal(relinked.status, 'linked')
  assert.deepEqual(relinked.warnings, [`Replaces the link to ${first}`])

  const offPath = linkReport(second, {binDir, dryRun: false}, host(home))
  assert.deepEqual(offPath.warnings, [`${binDir} is not on PATH`])
  assert.ok(offPath.next[0]?.includes(`export PATH="${binDir}:$PATH"`))

  writeFileSync(path, '#!/bin/sh\necho mine\n')
  assert.throws(() => linkReport(first, {binDir, dryRun: false}, on), UsageError)
  assert.equal(readFileSync(path, 'utf8'), '#!/bin/sh\necho mine\n', 'a foreign file is left alone')
  rmSync(path)
  symlinkSync(join(base, 'first/tools/cli/src/bin.ts'), path)
  assert.throws(() => linkReport(first, {binDir, dryRun: true}, on), UsageError, 'a symlink is not ours either')
})

test('unlink: absent, dry run, removal, and never a foreign file', () => {
  const base = scratch()
  const home = join(base, 'home')
  const binDir = join(base, 'bin')
  const path = join(binDir, 'projections-tools')
  const root = checkout(join(base, 'checkout'))
  assert.equal(unlinkReport({binDir, dryRun: false}, host(home)).status, 'absent')
  linkReport(root, {binDir, dryRun: false}, host(home))
  assert.equal(unlinkReport({binDir, dryRun: true}, host(home)).status, 'planned')
  assert.ok(existsSync(path))
  const removed = unlinkReport({binDir, dryRun: false}, host(home))
  assert.equal(removed.status, 'unlinked')
  assert.equal(removed.checkout, root)
  assert.equal(existsSync(path), false)
  writeFileSync(path, 'not a launcher\n')
  assert.throws(() => unlinkReport({binDir, dryRun: false}, host(home)), UsageError)
  assert.ok(existsSync(path))
})

test('doctor: not linked, linked here or elsewhere, a stale link to a moved checkout, a foreign file, a gone Node', () => {
  const base = scratch()
  const home = join(base, 'home')
  const binDir = join(home, '.local/bin')
  const here = checkout(join(base, 'here'))
  const there = checkout(join(base, 'there'))
  const node = join(base, 'node')
  writeFileSync(node, '')
  const on = host(home, {env: {PATH: binDir}, execPath: node})
  const only = (root: string, h = on) => linkFindings(root, h).map(finding => `${finding.status}: ${finding.detail}`)

  assert.deepEqual(only(here), ['ok: not linked (optional: npm run tools -- link puts projections-tools on PATH)'])
  linkReport(here, {dryRun: false}, on)
  const path = join(binDir, 'projections-tools')
  assert.deepEqual(only(here), [`ok: ${path} links this checkout`])
  assert.deepEqual(only(there), [`ok: ${path} links ${here}; inside this checkout it runs this checkout's tools`])
  assert.deepEqual(only(here, host(home, {execPath: node})), [`ok: ${path} links this checkout`, `warn: ${binDir} is not on PATH`])

  rmSync(node)
  assert.deepEqual(only(here)[1], `warn: its Node ${node} no longer exists; it runs node from PATH`)
  rmSync(here, {recursive: true})
  const stale = linkFindings(there, on)
  assert.equal(stale.length, 1)
  assert.equal(stale[0]?.status, 'warn')
  assert.match(stale[0]?.detail ?? '', /no longer a Projections checkout \(moved or deleted\)/u)

  writeFileSync(path, 'someone else\n')
  assert.deepEqual(only(there), [`warn: ${path} exists but wasn't written by tools link`])
})

/** Runs the real launcher, linked to this checkout in a temporary bin directory. */
function launcher(): {
  base: string
  shim: string
  run: (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => ReturnType<typeof spawnSync>
} {
  const base = scratch()
  const home = join(base, 'home')
  mkdirSync(home)
  const binDir = join(base, 'bin')
  const {path: shim} = linkReport(
    workspaceRoot,
    {binDir, dryRun: false},
    {...host(home), platform: process.platform, execPath: process.execPath, version: process.version},
  )
  const environment: NodeJS.ProcessEnv = {...process.env, HOME: home, XDG_DATA_HOME: join(home, '.local/share')}
  delete environment.npm_config_user_agent
  delete environment.npm_execpath
  return {
    base,
    shim,
    run: (cwd, args, env = {}) => spawnSync(shim, args, {cwd, encoding: 'utf8', env: {...environment, ...env}}),
  }
}

test('projections-tools: runs the checkout it is invoked in, in its root, with its pinned Node', posixOnly, () => {
  const {base, shim, run} = launcher()
  const other = checkout(join(base, 'worktree'))
  mkdirSync(join(other, 'renderers'))
  const inProcess = run(join(other, 'renderers'), ['context', '--json'])
  assert.equal(inProcess.status, 0, String(inProcess.stderr))
  assert.equal(inProcess.stderr, '')
  assert.deepEqual(JSON.parse(String(inProcess.stdout)), {
    cwd: other,
    initCwd: join(other, 'renderers'),
    bin: shim,
    argv0: process.execPath,
    args: ['context', '--json'],
  })

  // A different pinned Node, from a version manager: run as a child process of the launcher.
  const pinned = checkout(join(base, 'pinned'), '99.0.0')
  const nvm = join(base, 'nvm/versions/node/v99.0.0/bin/node')
  mkdirSync(dirname(nvm), {recursive: true})
  symlinkSync(process.execPath, nvm)
  const child = run(pinned, ['doctor'], {NVM_DIR: join(base, 'nvm')})
  assert.equal(child.status, 0, String(child.stderr))
  const reported = JSON.parse(String(child.stdout))
  assert.equal(reported.argv0, nvm)
  assert.equal(reported.cwd, pinned)
  assert.deepEqual(reported.args, ['doctor'])
})

test('projections-tools: outside a checkout it runs the linked one, says so, and names itself everywhere', posixOnly, () => {
  const {base, shim, run} = launcher()
  const outside = join(base, 'outside')
  mkdirSync(outside)
  const version = run(outside, ['--version'])
  assert.equal(version.status, 0, String(version.stderr))
  assert.equal(String(version.stdout).trim(), '0.0.0')
  assert.match(String(version.stderr), new RegExp(`is not in a Projections checkout; using the linked checkout ${workspaceRoot}`))

  const llms = String(run(outside, ['--llms']).stdout)
  assert.ok(llms.startsWith('# projections-tools'))
  assert.ok(llms.includes('`projections-tools context`'))

  // `mcp add` registers the launcher's absolute path: Amp's settings directly, other agents through `npx add-mcp`.
  const fakes = join(base, 'fakes')
  mkdirSync(fakes)
  const record = join(base, 'npx-args')
  writeFileSync(join(fakes, 'npx'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${record}'\n`)
  chmodSync(join(fakes, 'npx'), 0o755)
  const added = run(outside, ['mcp', 'add'], {PATH: `${fakes}${delimiter}${process.env.PATH ?? ''}`})
  assert.equal(added.status, 0, String(added.stdout) + String(added.stderr))
  assert.deepEqual(readFileSync(record, 'utf8').trim().split('\n'), ['add-mcp', `${shim} --mcp`, '--name', 'projections-tools', '-y', '-g'])
  const amp = JSON.parse(readFileSync(join(base, 'home/.config/amp/settings.json'), 'utf8'))
  assert.deepEqual(amp['amp.mcpServers']['projections-tools'], {command: shim, args: ['--mcp']})
})
