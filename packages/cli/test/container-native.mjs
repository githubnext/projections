import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const image = process.env.PROJECTIONS_CONTAINER_IMAGE
assert.match(
  image ?? '',
  /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$/,
  'Prepare and explicitly select an immutable PROJECTIONS_CONTAINER_IMAGE',
)
const source = fileURLToPath(new URL('../../../', import.meta.url))
const root = await mkdtemp(path.join(tmpdir(), 'projections-native-container-'))
const invoke = (command, args) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: {PATH: process.env.PATH, LANG: 'C.UTF-8', GIT_CONFIG_GLOBAL: '/dev/null'},
    maxBuffer: 8 * 1024 * 1024,
  })
try {
  await cp(path.join(source, 'examples/polyglot'), root, {recursive: true})
  const git = (...args) => invoke('git', ['-c', 'core.hooksPath=/dev/null', ...args])
  git('init', '--template=', '-q')
  git('config', 'user.name', 'Native container proof')
  git('config', 'user.email', 'container@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  const definition = JSON.parse(await readFile(path.join(root, '.github/projections/services-node.json'), 'utf8'))
  await writeFile(
    path.join(root, '.github/projections/container-policy.json'),
    JSON.stringify({
      ...definition,
      id: 'container-policy',
      title: 'Actual container policy',
      extractor: {command: ['node', 'container-policy.mjs', String(process.getuid())]},
    }),
  )
  await writeFile(
    path.join(root, 'container-policy.mjs'),
    String.raw`
import assert from 'node:assert/strict'
import {readFile, writeFile} from 'node:fs/promises'
import {networkInterfaces} from 'node:os'

assert.equal(process.cwd(), '/repository')
assert.equal(process.getuid(), Number(process.argv[2]))
const mounts = (await readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n').map(line => line.split(' '))
for (const target of ['/', '/repository']) {
  const mount = mounts.find(fields => fields[4] === target)
  assert.ok(mount, target)
  assert.ok(mount[5].split(',').includes('ro'), target + ' must be read-only')
}
await assert.rejects(writeFile('/repository/forbidden-write', 'forbidden'), {code: 'EROFS'})
assert.ok(Object.values(networkInterfaces()).flat().every(address => address?.internal))
const status = await readFile('/proc/self/status', 'utf8')
assert.match(status, /^CapEff:\s+0+$/m)
assert.match(status, /^NoNewPrivs:\s+1$/m)
await import('./collect.mjs')
`,
  )
  git('add', '--all')
  git('commit', '-qm', 'Native container policy fixture')
  const cli = (...args) => JSON.parse(invoke(path.join(source, 'packages/cli/dist/projections'), args))
  const local = cli('show', 'HEAD', '-p', 'services-node', '--trust', '--json')
  const isolated = cli('show', 'HEAD', '-p', 'container-policy', '--trust', '--json', '--container-image', image)
  assert.equal(isolated.extraction.schema, 'architecture/v0')
  assert.ok(isolated.extraction.entities.length > 0)
  assert.equal(isolated.digest, local.digest)
  console.log(
    JSON.stringify({
      image,
      actualContainer: true,
      readOnlyMounts: true,
      networkNone: true,
      noCapabilities: true,
      noNewPrivileges: true,
      hostUser: true,
      nativeDigestParity: true,
    }),
  )
} finally {
  await rm(root, {recursive: true, force: true})
}
