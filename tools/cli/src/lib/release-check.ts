// Checks that every shipped manifest, the dependencies between them and both lockfiles carry the release version
// (release.ts).
import {isDeepStrictEqual} from 'node:util'
import {
  dependencyFields,
  isVersion,
  lineOf,
  lockedCrates,
  pathDependencies,
  readRelease,
  table,
  tagVersion,
  unreleasedVersion,
  type VersionProblem,
} from './release.ts'
import {readText} from './repo.ts'

/**
 * Everything that disagrees with one release version: the Cargo workspace's, or the tag's when `tag` is given.
 * Empty when every shipped manifest, the dependencies between them and both lockfiles carry the same version.
 */
export function versionProblems(root: string, tag?: string): VersionProblem[] {
  const problems: VersionProblem[] = []
  const {version, crates, workspaces} = readRelease(root)
  const cargo = readText(root, 'Cargo.toml') ?? ''
  if (!version) {
    problems.push({file: 'Cargo.toml', message: 'Cargo.toml has no [workspace.package] version, the release version'})
    return problems
  }
  if (!isVersion(version)) problems.push({file: 'Cargo.toml', message: `The release version ${version} is not MAJOR.MINOR.PATCH`})
  if (tag !== undefined) {
    const tagged = tagVersion(tag)
    const index = cargo.indexOf(`"${version}"`)
    if (!tagged) problems.push({file: 'Cargo.toml', message: `${tag} is not a release tag such as v${version}`})
    else if (tagged !== version) {
      problems.push({file: 'Cargo.toml', line: lineOf(cargo, index), message: `The tag is ${tag}, but the release version is ${version}`})
    }
  }

  for (const crate of crates) {
    const expected = crate.released ? version : unreleasedVersion
    if (crate.version !== expected) {
      const why = crate.released ? 'inherit the release version (version.workspace = true)' : `stay at ${unreleasedVersion}`
      problems.push({
        file: crate.file,
        message: `${crate.name} is ${crate.version ?? 'unversioned'}; crates in ${crate.released ? 'packages/' : `${crate.path.split('/')[0]}/`} ${why}`,
      })
    }
    if (!crate.released && !/^publish\s*=\s*false\s*$/mu.test(table(crate.text, 'package')?.body ?? '')) {
      problems.push({file: crate.file, message: `${crate.name} is outside packages/, so it is never released: set publish = false`})
    }
  }
  const crateVersions = new Map(crates.map(crate => [crate.name, crate.version]))
  for (const crate of crates) {
    for (const dependency of pathDependencies(crate.text)) {
      const wanted = crateVersions.get(dependency.name)
      if (wanted !== undefined && dependency.requirement !== wanted) {
        problems.push({
          file: crate.file,
          line: lineOf(crate.text, dependency.index),
          message: `${crate.name} requires ${dependency.name} ${dependency.requirement}, not its version ${wanted}`,
        })
      }
    }
  }
  const lock = readText(root, 'Cargo.lock')
  if (lock !== undefined) {
    for (const locked of lockedCrates(lock)) {
      const wanted = crateVersions.get(locked.name)
      if (wanted !== undefined && locked.version !== wanted) {
        problems.push({
          file: 'Cargo.lock',
          line: lineOf(lock, locked.index),
          message: `Cargo.lock has ${locked.name} ${locked.version}, not ${wanted}: run cargo update --workspace`,
        })
      }
    }
  }

  const workspaceVersions = new Map(workspaces.map(workspace => [workspace.name, String(workspace.manifest.version)]))
  for (const workspace of workspaces) {
    const actual = workspace.manifest.version
    const line = lineOf(workspace.text, Math.max(0, workspace.text.indexOf('"version"')))
    if (workspace.released && actual !== version) {
      problems.push({file: workspace.file, line, message: `${workspace.name} is ${String(actual)}, not the release version ${version}`})
    }
    if (!workspace.released) {
      if (actual !== unreleasedVersion) {
        problems.push({
          file: workspace.file,
          line,
          message: `${workspace.name} is outside packages/, so it is never released: it stays at ${unreleasedVersion}`,
        })
      }
      if (workspace.manifest.private !== true) {
        problems.push({
          file: workspace.file,
          message: `${workspace.name} is outside packages/, so it is never released: set "private": true`,
        })
      }
    }
  }
  const rootManifest = readText(root, 'package.json')
  const manifests = [
    ...(rootManifest === undefined
      ? []
      : [{file: 'package.json', text: rootManifest, manifest: JSON.parse(rootManifest) as Record<string, unknown>}]),
    ...workspaces,
  ]
  for (const {file, text, manifest} of manifests) {
    for (const [name, range] of workspaceDependencies(manifest)) {
      const wanted = workspaceVersions.get(name)
      if (wanted !== undefined && range !== wanted) {
        problems.push({
          file,
          line: lineOf(text, Math.max(0, text.indexOf(`"${name}"`))),
          message: `${String(manifest.name)} depends on ${name} ${range}; workspaces depend on each other at their exact version, ${wanted}`,
        })
      }
    }
  }
  const npmLock = readText(root, 'package-lock.json')
  if (npmLock !== undefined) {
    const packages = (JSON.parse(npmLock) as {packages?: Record<string, Record<string, unknown>>}).packages ?? {}
    for (const workspace of workspaces) {
      const entry = packages[workspace.path]
      const expected = lockEntry(workspace.manifest)
      if (!entry || !isDeepStrictEqual(lockEntry(entry), expected)) {
        problems.push({
          file: 'package-lock.json',
          message: `package-lock.json records ${workspace.name} (${workspace.path}) at another version or with other workspace dependencies: run npm install --package-lock-only`,
        })
      }
    }
  }
  return problems
}

/** A manifest's dependencies on other workspaces, `[name, range]`, every field. */
function workspaceDependencies(manifest: Record<string, unknown>): [string, string][] {
  return dependencyFields.flatMap(field => Object.entries((manifest[field] ?? {}) as Record<string, string>))
}

/** What a lockfile entry must agree with its manifest on: the version and the ranges of every dependency. */
const lockEntry = (manifest: Record<string, unknown>) => ({
  version: manifest.version,
  ...Object.fromEntries(dependencyFields.map(field => [field, manifest[field] ?? {}])),
})
