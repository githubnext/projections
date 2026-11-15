// Regenerates the api renderer's compatibility fixtures from real projects with
// the real extractors, exactly as a user runs them: a Git repository with a
// projection definition that names the api-compatibility comparator, then
// `projections compare --trust`. Requires the CLI (`cargo build -p projections-cli`),
// the built comparator module and the ecosystem's toolchain.
//
//   node packages/renderers/api/scripts/fixtures.mjs dotnet typescript rust go
import {spawnSync} from 'node:child_process'
import {cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const workspace = fileURLToPath(new URL('../../../../', import.meta.url))
const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url))
const cli = process.env.PROJECTIONS_CLI ?? path.join(workspace, 'target/debug/projections')
const comparator = path.join(workspace, 'packages/comparators/api-compatibility/api-compatibility.comparator.yaml')

const ecosystems = {
  dotnet: {
    source: 'packages/extractors/dotnet-public-api/tests/fixtures/compatibility',
    extractor: 'dotnet-public-api',
    inputs: {project: 'Payments.csproj'},
    environment: ['HOME', 'NUGET_PACKAGES', 'DOTNET_ROOT', 'TMPDIR'],
  },
  typescript: {
    source: 'packages/extractors/typescript-support/test/fixtures/compatibility',
    extractor: 'typescript-public-api',
    inputs: {tsconfig: 'tsconfig.json'},
    environment: [],
    prepare: root => cpSync(path.join(workspace, 'node_modules/typescript'), path.join(root, 'node_modules/typescript'), {recursive: true}),
  },
  rust: {
    source: 'packages/extractors/rust-public-api/tests/fixtures/compatibility',
    extractor: 'rust-public-api',
    inputs: {toolchain: process.env.PROJECTIONS_RUST_NIGHTLY ?? 'nightly'},
    environment: ['HOME', 'RUSTUP_HOME', 'CARGO_HOME'],
  },
  go: {
    source: 'packages/extractors/go-public-api/tests/fixtures/compatibility',
    extractor: 'go-public-api',
    inputs: {},
    environment: ['HOME', 'GOCACHE', 'GOMODCACHE'],
  },
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr}${result.stdout}`)
  return result.stdout
}

for (const name of process.argv.slice(2)) {
  const ecosystem = ecosystems[name]
  if (!ecosystem) throw new Error(`Unknown ecosystem ${name}; choose from ${Object.keys(ecosystems).join(', ')}`)
  const root = mkdtempSync(path.join(tmpdir(), `projections-api-${name}-`))
  try {
    const git = (...args) => run('git', ['-c', 'user.name=Projections', '-c', 'user.email=projections@example.com', ...args], root)
    git('init', '-q')
    writeFileSync(path.join(root, '.gitignore'), 'node_modules/\nbin/\nobj/\ntarget/\n')
    mkdirSync(path.join(root, '.projections'))
    mkdirSync(path.join(root, 'tools'))
    cpSync(comparator, path.join(root, 'tools/api-compatibility.comparator.yaml'))
    const definition = {
      id: 'api',
      title: 'Public API',
      extractor: ecosystem.extractor,
      renderer: 'api',
      inputs: ecosystem.inputs,
      comparator: 'tools/api-compatibility.comparator.yaml',
      execution: {timeoutMs: 300000, environment: ecosystem.environment},
    }
    writeFileSync(path.join(root, '.projections/api.json'), `${JSON.stringify(definition, null, 2)}\n`)
    ecosystem.prepare?.(root)
    for (const side of ['before', 'after']) {
      cpSync(path.join(workspace, ecosystem.source, side), root, {recursive: true})
      git('add', '-A')
      git('commit', '-q', '-m', side)
    }
    const saved = JSON.parse(run(cli, ['compare', 'HEAD~1..HEAD', '-p', 'api', '--trust', '--json'], root))
    for (const side of ['before', 'after']) {
      const file = path.join(fixtures, `${name}-${side}.json`)
      writeFileSync(file, `${JSON.stringify(saved[side].extraction, null, 2)}\n`)
      console.log(`Wrote ${path.relative(workspace, file)}`)
    }
    const {counts} = saved.comparison.metadata.compatibility
    console.log(
      `${name}: ${Object.entries(counts)
        .map(([level, count]) => `${count} ${level}`)
        .join(', ')}`,
    )
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}
