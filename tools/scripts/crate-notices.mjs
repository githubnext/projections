// THIRD_PARTY_NOTICES.txt for Rust builds: the license files of every third-party crate a build compiles in. A crate
// package that ships no license files falls back to its upstream texts in notices/, which notices/notices.json maps to
// the exact locked versions they cover; a crate with neither, or at a version the manifest doesn't cover, fails the
// build. tools/scripts/notices.mjs checks the manifest against Cargo.lock for every build here.
import {spawnSync} from 'node:child_process'
import {readFileSync, readdirSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
export const license = name => /^(LICENSE|LICENCE|COPYING|NOTICE)([-_.].*)?$/i.test(name)
const wasm = 'wasm32-unknown-unknown'

/** The host the Rust compiler builds for. */
export function hostPlatform() {
  const compiler = spawnSync('rustc', ['-vV'], {cwd: root, encoding: 'utf8'})
  if (compiler.error) throw compiler.error
  if (compiler.status !== 0) throw new Error(compiler.stderr)
  const host = /^host: (.+)$/m.exec(compiler.stdout)?.[1]
  if (!host) throw new Error('Rust compiler did not report its build host')
  return host
}

/** The platforms dist-workspace.toml releases the CLI for. */
export function releaseTargets() {
  const toml = readFileSync(join(root, 'dist-workspace.toml'), 'utf8')
  const targets = [...(/^targets\s*=\s*\[([^\]]*)\]/m.exec(toml)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(match => match[1])
  if (!targets.length) throw new Error('dist-workspace.toml names no release targets')
  return targets
}

/**
 * Every build that ships notices: the workspace crates it compiles in on each platform, and whether build scripts'
 * dependencies count.
 */
export function noticeBuilds(host = hostPlatform()) {
  const native = ['projections-engine', 'projections-comparator-default', 'projections-cli']
  return {
    // The Engine package's notices cover the CLI's dependencies on every release platform, not only this build host,
    // so each released executable carries the same complete notices.
    engine: {
      builds: [
        ...[...new Set([host, ...releaseTargets()])].map(platform => ({platform, crates: native})),
        {platform: wasm, crates: ['projections-engine', 'projections-comparator-default', 'projections-comparator-rules']},
      ],
      buildDependencies: true,
    },
    rules: {builds: [{platform: wasm, crates: ['projections-comparator-rules']}]},
    'rules-editor': {builds: [{platform: wasm, crates: ['projections-rules-editor']}]},
    'rules-runner': {builds: [{platform: host, crates: ['projections-comparator-runtime']}]},
  }
}

const graphs = new Map()
/** `cargo metadata --locked` for `platform`, read once per process. */
export function cargoMetadata(platform) {
  if (!graphs.has(platform)) {
    const metadata = spawnSync('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', platform], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    })
    if (metadata.error) throw metadata.error
    if (metadata.status !== 0) throw new Error(metadata.stderr)
    graphs.set(platform, JSON.parse(metadata.stdout))
  }
  return graphs.get(platform)
}

/**
 * The third-party packages that the workspace `crates` compile in, by package id, from one platform's cargo metadata.
 * Normal dependencies only, unless `buildDependencies` also counts build scripts' dependencies; tests never count.
 */
export function compiledCrates(graph, crates, buildDependencies = false) {
  const nodes = new Map(graph.resolve.nodes.map(node => [node.id, node]))
  const packages = new Map(graph.packages.map(pkg => [pkg.id, pkg]))
  const pending = graph.packages.filter(pkg => !pkg.source && crates.includes(pkg.name)).map(pkg => pkg.id)
  const reached = new Set()
  const compiled = new Map()
  const counts = kind => kind.kind === null || (buildDependencies && kind.kind === 'build')
  while (pending.length) {
    const id = pending.pop()
    if (reached.has(id)) continue
    reached.add(id)
    const node = nodes.get(id)
    const pkg = packages.get(id)
    if (!node || !pkg) throw new Error(`Missing resolved dependency ${id}`)
    if (pkg.source) compiled.set(id, pkg)
    pending.push(...node.deps.filter(dependency => dependency.dep_kinds.some(counts)).map(dependency => dependency.pkg))
  }
  return compiled
}

/** The license files a crate package ships. */
export const ownLicenseFiles = pkg => readdirSync(dirname(pkg.manifest_path)).filter(license).sort()

/** notices/notices.json's entries. */
export const readNoticeManifest = (path = join(root, 'notices', 'notices.json')) => JSON.parse(readFileSync(path, 'utf8')).notices

/** The manifest entry for crate `name`, if any. */
export const noticeEntry = (manifest, name) => manifest.find(entry => Object.hasOwn(entry.crates, name))

/** Why the manifest doesn't cover `pkg`, a crate package with no license files of its own; undefined when it does. */
export function uncovered(manifest, pkg) {
  const entry = noticeEntry(manifest, pkg.name)
  if (!entry)
    return `${pkg.name} ${pkg.version} ships no license files and notices/notices.json has no entry for it: fetch the license from ${pkg.repository ?? 'its repository'} at the matching tag into notices/ and add it to notices/notices.json`
  const covered = entry.crates[pkg.name]
  if (!covered.includes(pkg.version))
    return `${pkg.name} is locked at ${pkg.version}, but notices/notices.json covers ${pkg.name} ${covered.join(', ')}: fetch the license from ${entry.repository} at the matching tag and update notices/notices.json`
}

/**
 * The notices for the third-party crates that `crates` compile in on each platform, as one text under `title`.
 *
 * @param {{builds: {platform: string, crates: string[]}[], title: string, buildDependencies?: boolean}} options
 */
export function crateNotices({builds, title, buildDependencies = false}) {
  const dependencies = new Map()
  for (const {platform, crates} of builds)
    for (const [id, pkg] of compiledCrates(cargoMetadata(platform), crates, buildDependencies)) dependencies.set(id, pkg)
  const manifest = readNoticeManifest()
  const text = [`${title}\n`]
  for (const dependency of [...dependencies.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'),
  )) {
    let directory = dirname(dependency.manifest_path)
    let files = ownLicenseFiles(dependency)
    if (!files.length) {
      const problem = uncovered(manifest, dependency)
      if (problem) throw new Error(`Missing redistribution notice: ${problem}`)
      const entry = noticeEntry(manifest, dependency.name)
      directory = join(root, 'notices', entry.directory)
      files = Object.keys(entry.files).sort()
    }
    text.push(`\n===== ${dependency.name} ${dependency.version} (${dependency.license}) =====\n`)
    for (const file of files) text.push(`\n--- ${file} ---\n${readFileSync(join(directory, file), 'utf8')}`)
  }
  return text.join('')
}
