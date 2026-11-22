// Sets the release version (release.ts) in every shipped manifest, the dependencies between them and both lockfiles.
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {isDeepStrictEqual} from 'node:util'
import {dependencyFields, isVersion, lockedCrates, pathDependencies, readRelease, tableVersion} from './release.ts'
import {readText} from './repo.ts'

/** Writes `text` to `file` under `root` when it changed, recording it in `changed`. */
function update(root: string, file: string, before: string, after: string, changed: string[]) {
  if (after === before) return
  writeFileSync(join(root, file), after)
  changed.push(file)
}

/** `text` with the string value of each JSON path in `edits` replaced, keeping the formatting; JSON.parse checks it. */
function editJson(text: string, edits: {key: string; within?: string; value: string}[], expected: unknown): string {
  let result = text
  for (const {key, within, value} of edits) {
    const start = within ? result.indexOf(`"${within}"`) : 0
    const end = within ? result.indexOf('}', start) : result.length
    const pattern = new RegExp(`("${key.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&')}"\\s*:\\s*)"[^"]*"`)
    const segment = result.slice(start, end)
    result = result.slice(0, start) + segment.replace(pattern, `$1"${value}"`) + result.slice(end)
  }
  if (isDeepStrictEqual(JSON.parse(result), expected)) return result
  return `${JSON.stringify(expected, null, 2)}\n`
}

/**
 * Sets the release version to `next` in every shipped manifest, the dependencies between workspaces and crates, and both
 * lockfiles, which are edited as `cargo update --workspace` and `npm install --package-lock-only` would. Returns the
 * files it changed.
 */
export function setReleaseVersion(root: string, next: string): string[] {
  if (!isVersion(next)) throw new Error(`${next} is not a release version such as 0.2.0`)
  const changed: string[] = []
  const {crates, workspaces} = readRelease(root)

  const cargo = readText(root, 'Cargo.toml') ?? ''
  const found = tableVersion(cargo, 'workspace.package')
  if (typeof found !== 'object') throw new Error('Cargo.toml has no [workspace.package] version')
  const versionAt = (text: string, index: number) => text.slice(0, index) + text.slice(index).replace(/"[^"]*"/u, `"${next}"`)
  update(root, 'Cargo.toml', cargo, versionAt(cargo, found.index), changed)

  const releasedCrates = new Set(crates.filter(crate => crate.released).map(crate => crate.name))
  for (const crate of crates) {
    let text = crate.text
    for (const dependency of pathDependencies(crate.text).reverse()) {
      if (releasedCrates.has(dependency.name)) text = versionAt(text, dependency.index)
    }
    update(root, crate.file, crate.text, text, changed)
  }
  const lock = readText(root, 'Cargo.lock')
  if (lock !== undefined) {
    let text = lock
    for (const locked of lockedCrates(lock).reverse()) if (releasedCrates.has(locked.name)) text = versionAt(text, locked.index)
    update(root, 'Cargo.lock', lock, text, changed)
  }

  const releasedWorkspaces = new Set(workspaces.filter(workspace => workspace.released).map(workspace => workspace.name))
  const bump = (manifest: Record<string, unknown>, released: boolean) => {
    const result = structuredClone(manifest)
    const edits: {key: string; within?: string; value: string}[] = []
    if (released) {
      result.version = next
      edits.push({key: 'version', value: next})
    }
    for (const field of dependencyFields) {
      const dependencies = result[field] as Record<string, string> | undefined
      for (const name of Object.keys(dependencies ?? {})) {
        if (releasedWorkspaces.has(name) && dependencies) {
          dependencies[name] = next
          edits.push({key: name, within: field, value: next})
        }
      }
    }
    return {result, edits}
  }
  const rootText = readText(root, 'package.json')
  for (const {file, text, released} of [
    ...(rootText === undefined ? [] : [{file: 'package.json', text: rootText, released: false}]),
    ...workspaces,
  ]) {
    const {result, edits} = bump(JSON.parse(text) as Record<string, unknown>, released)
    update(root, file, text, editJson(text, edits, result), changed)
  }
  const npmLock = readText(root, 'package-lock.json')
  if (npmLock !== undefined) {
    const parsed = JSON.parse(npmLock) as {packages?: Record<string, Record<string, unknown>>}
    for (const workspace of workspaces) {
      const entry = parsed.packages?.[workspace.path]
      if (entry) Object.assign(entry, bump(entry, workspace.released).result)
    }
    update(root, 'package-lock.json', npmLock, `${JSON.stringify(parsed, null, 2)}\n`, changed)
  }
  return changed
}
