// A small repository for the smoke test and screenshots: npm workspaces whose dependencies change between commits,
// with a workspace-dependencies projection (a built-in extractor, so it runs without trust).
import {execFileSync} from 'node:child_process'
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const write = async (root, path, value) => {
  await mkdir(join(root, path, '..'), {recursive: true})
  await writeFile(join(root, path), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)
}
const pkg = (name, dependencies = {}) => ({name: `@demo/${name}`, version: '1.0.0', private: true, dependencies})

const comparatorTests = `format: projections.comparator-tests
version: 0
options:
  priority: [package:@acme/core]
cases:
  - name: core leads
    before: fixtures/before.json
    after: fixtures/after.json
    expect:
      order: [package:@acme/core, package:@acme/docs-site]
  - name: billing leads
    before: fixtures/before.json
    after: fixtures/after.json
    expect:
      order: [package:@acme/billing, package:@acme/core]
`

/**
 * `acme` makes it look like a real repository for the Compare screenshots: dated commits with real subjects, a `v1.0`
 * tag on main, `feature/auth` checked out, and an untracked file in the working tree.
 */
export async function createDemoRepository(cli, {acme = false} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'projections-vscode-demo-'))
  let date
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      stdio: 'pipe',
      env: {...process.env, ...(date ? {GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date} : {})},
    })
  const daysAgo = days => new Date(Date.now() - days * 86_400_000).toISOString()
  git('init', '--quiet', '--initial-branch=main')
  git('config', 'user.email', 'demo@example.com')
  git('config', 'user.name', 'Demo')
  git('config', 'commit.gpgsign', 'false')
  await write(root, 'package.json', {name: 'demo', private: true, workspaces: ['packages/*']})
  await write(root, 'packages/shared/package.json', pkg('shared'))
  await write(root, 'packages/api/package.json', pkg('api', {'@demo/shared': '1.0.0'}))
  await write(root, 'packages/web/package.json', pkg('web', {'@demo/api': '1.0.0', '@demo/shared': '1.0.0'}))
  await write(root, 'packages/api/src/index.ts', 'export const api = 1\n')
  execFileSync(cli, ['init', 'packages', '--extractor', 'workspace-dependencies', '--title', 'Packages'], {cwd: root, stdio: 'pipe'})
  // A comparator file the Inspector's Comparator part offers to try.
  await write(
    root,
    'tools/first.comparator.yaml',
    await readFile(new URL('../../../../../examples/comparators/priority-order/priority-order.comparator.yaml', import.meta.url), 'utf8'),
  )
  // Its tests, for the Testing view: one case passes, one fails at its `order` line (15).
  const example = new URL('../../../../../examples/comparators/priority-order/fixtures/', import.meta.url)
  for (const name of ['before.json', 'after.json']) {
    await write(root, `tools/fixtures/${name}`, await readFile(new URL(name, example), 'utf8'))
  }
  await write(root, 'tools/first.comparator.test.yaml', comparatorTests)
  git('add', '-A')
  if (acme) date = daysAgo(9)
  git('commit', '--quiet', '-m', acme ? 'Set up the workspaces' : 'Workspaces')
  if (acme) git('tag', 'v1.0')
  git('checkout', '--quiet', '-b', 'feature/auth')
  await write(root, 'packages/auth/package.json', pkg('auth', {'@demo/shared': '1.0.0'}))
  await write(root, 'packages/api/package.json', pkg('api', {'@demo/shared': '1.0.0', '@demo/auth': '1.0.0'}))
  await write(root, 'packages/billing/package.json', pkg('billing', {'@demo/api': '1.0.0'}))
  await write(root, 'packages/web/package.json', pkg('web', {'@demo/api': '1.0.0', '@demo/billing': '1.0.0'}))
  git('add', '-A')
  if (acme) date = daysAgo(2)
  git('commit', '--quiet', '-m', acme ? 'Add auth package' : 'Auth and billing')
  if (acme) await write(root, 'packages/notifications/package.json', pkg('notifications', {'@demo/auth': '1.0.0'}))
  return root
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(await createDemoRepository(process.argv[2] ?? 'projections'))
