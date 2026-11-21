// Checks notices/notices.json, which maps the upstream license texts in notices/ to the exact locked crate versions
// they cover, against Cargo.lock for every build that ships notices (tools/scripts/crate-notices.mjs) on every platform
// it builds for. Fails when a crate with no license files of its own is locked at a version the manifest doesn't cover,
// when an entry covers a version no such crate is locked at, when a notices/ directory and its entry disagree, or when
// notices/README.md's table isn't the one the manifest writes.
//
//   node tools/scripts/notices.mjs           check (npm run check:notices)
//   node tools/scripts/notices.mjs --write   rewrite notices/README.md's table from the manifest
import {readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {cargoMetadata, compiledCrates, license, noticeBuilds, ownLicenseFiles, readNoticeManifest, uncovered} from './crate-notices.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const notices = join(root, 'notices')
const begin = '<!-- generated: notices -->'
const end = '<!-- end generated: notices -->'

/**
 * Where the manifest and the locked crates disagree. `packages` are the third-party crate packages the builds compile
 * in; only those without license files of their own (`hasOwnLicense`) need the manifest.
 */
export function versionProblems(manifest, packages, hasOwnLicense = pkg => ownLicenseFiles(pkg).length > 0) {
  const all = [...packages]
  const needing = all.filter(pkg => !hasOwnLicense(pkg))
  const problems = []
  const drifted = new Set()
  for (const pkg of needing) {
    const problem = uncovered(manifest, pkg)
    if (!problem) continue
    problems.push(problem)
    drifted.add(pkg.name)
  }
  for (const entry of manifest) {
    for (const [name, versions] of Object.entries(entry.crates)) {
      // A drifted crate's message already names the version the manifest covers.
      if (drifted.has(name)) continue
      for (const version of versions) {
        if (needing.some(pkg => pkg.name === name && pkg.version === version)) continue
        const locked = [...new Set(all.filter(pkg => pkg.name === name).map(pkg => pkg.version))]
        const why = locked.includes(version)
          ? `${name} ${version} ships its own license files`
          : locked.length
            ? `no build compiles in ${name} ${version} (Cargo.lock has ${name} ${locked.join(', ')})`
            : `no build compiles in ${name}`
        problems.push(
          `notices/notices.json covers ${name} ${version}, but ${why}: remove ${version} from notices/notices.json (and notices/${entry.directory}/ once it covers nothing)`,
        )
      }
    }
  }
  return problems
}

/** Where notices/ and the manifest disagree: an entry for each directory, and exactly the files each entry lists. */
export function directoryProblems(manifest, directory = notices) {
  const problems = []
  const directories = readdirSync(directory, {withFileTypes: true})
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
  for (const name of directories) {
    if (!manifest.some(entry => entry.directory === name)) problems.push(`notices/${name}/ has no entry in notices/notices.json`)
  }
  for (const entry of manifest) {
    if (!directories.includes(entry.directory)) {
      problems.push(`notices/notices.json lists notices/${entry.directory}/, which doesn't exist`)
      continue
    }
    const present = readdirSync(join(directory, entry.directory)).sort()
    const listed = Object.keys(entry.files).sort()
    for (const file of present.filter(file => !listed.includes(file))) {
      problems.push(`notices/${entry.directory}/${file} isn't in its notices/notices.json entry's files`)
    }
    for (const file of listed.filter(file => !present.includes(file))) {
      problems.push(`notices/notices.json lists notices/${entry.directory}/${file}, which doesn't exist`)
    }
    for (const file of listed.filter(file => !license(file))) {
      problems.push(`notices/${entry.directory}/${file} isn't named as a license file (LICENSE*, LICENCE*, COPYING*, NOTICE*)`)
    }
  }
  return problems
}

const code = text => `\`${text}\``

/** notices/README.md's table of the manifest's entries. */
export function readmeTable(manifest) {
  const rows = manifest.map(entry => {
    const crates = Object.entries(entry.crates).map(([name, versions]) => `${code(name)} ${versions.join(', ')}`)
    const files = Object.entries(entry.files).map(([file, upstream]) =>
      file === upstream ? code(file) : `${code(file)} (upstream ${code(upstream)})`,
    )
    const cells = [code(`${entry.directory}/`), crates.join('<br>'), files.join('<br>'), `${entry.repository} at ${code(entry.tag)}`]
    return `| ${[...cells, entry.note ?? ''].join(' | ')} |`
  })
  return ['<!-- prettier-ignore -->', '| Directory | Crates | Files | Source | Notes |', '|---|---|---|---|---|', ...rows].join('\n')
}

/** `readme` with its generated region replaced by the manifest's table. */
export function withTable(readme, manifest) {
  const start = readme.indexOf(begin)
  const stop = readme.indexOf(end)
  if (start < 0 || stop < start) throw new Error(`notices/README.md has no ${begin} … ${end} region`)
  return `${readme.slice(0, start + begin.length)}\n${readmeTable(manifest)}\n${readme.slice(stop)}`
}

/** Every third-party crate package that any build compiles in, on any platform it builds for. */
function lockedPackages() {
  const packages = new Map()
  for (const {builds, buildDependencies} of Object.values(noticeBuilds())) {
    for (const {platform, crates} of builds) {
      for (const [id, pkg] of compiledCrates(cargoMetadata(platform), crates, buildDependencies)) packages.set(id, pkg)
    }
  }
  return packages.values()
}

// Run as a script, not imported.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = readNoticeManifest()
  const readmePath = join(notices, 'README.md')
  const readme = readFileSync(readmePath, 'utf8')
  const current = withTable(readme, manifest)
  if (process.argv.includes('--write')) {
    if (current !== readme) writeFileSync(readmePath, current)
  } else {
    const problems = [
      ...directoryProblems(manifest),
      ...(current === readme ? [] : ["notices/README.md's table isn't notices/notices.json's: run node tools/scripts/notices.mjs --write"]),
      ...versionProblems(manifest, lockedPackages()),
    ]
    for (const problem of problems) console.error(problem)
    if (problems.length) process.exit(1)
  }
}
