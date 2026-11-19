// The release version (docs/maintainers/releasing.md). Everything that ships, or that something shipped depends on, is
// in `packages/` (CONTRIBUTING.md#layout), and all of it releases together at one version: the Cargo workspace's
// `[workspace.package] version`, which every crate in `packages/` inherits, and the version of every npm workspace in
// `packages/`. Workspaces and crates elsewhere (`tools/`, `examples/`) are never released: they stay private at 0.0.0.
// Workspaces and crates depend on each other at exact versions, and both lockfiles record them. The workspaces and
// crates come from the root package.json's `workspaces` and Cargo.toml's `members`, so nothing here lists paths.
import {cargoMembers, npmWorkspaces} from './packages.ts'
import {readText} from './repo.ts'

/** The version of everything that is never released. */
export const unreleasedVersion = '0.0.0'

/** A release version: `MAJOR.MINOR.PATCH`, optionally with a prerelease (`0.2.0-beta.1`). */
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export type VersionProblem = {file: string; line?: number; message: string}

/** Whether the workspace or crate at `path` (relative to the root, POSIX) is released. */
export const isReleased = (path: string): boolean => path.startsWith('packages/')

export const isVersion = (text: string): boolean => versionPattern.test(text)

/** The version a release tag names: `v0.1.0` is 0.1.0. Anything else is not a release tag. */
export function tagVersion(tag: string): string | undefined {
  const version = tag.startsWith('v') ? tag.slice(1) : undefined
  return version && isVersion(version) ? version : undefined
}

export const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length

/** `text` as a regular expression that matches it literally. */
const regexLiteral = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&')

/** The body of the TOML table `[name]`: from its header to the next header. */
export function table(text: string, name: string): {start: number; body: string} | undefined {
  const header = new RegExp(`^\\[${regexLiteral(name)}\\][ \\t]*$`, 'm').exec(text)
  if (!header) return undefined
  const start = header.index + header[0].length
  const next = /^\[/m.exec(text.slice(start))
  return {start, body: text.slice(start, next ? start + next.index : undefined)}
}

/** `version = "…"` in a TOML table body: its value and index in the file, or `inherited` for `version.workspace = true`. */
export function tableVersion(text: string, name: string): {value: string; index: number} | 'inherited' | undefined {
  const found = table(text, name)
  if (!found) return undefined
  if (/^version\.workspace\s*=\s*true\s*$/m.test(found.body)) return 'inherited'
  const match = /^version\s*=\s*"([^"]*)"/m.exec(found.body)
  return match ? {value: match[1] as string, index: found.start + match.index} : undefined
}

export type Crate = {path: string; file: string; name: string; text: string; version: string | undefined; released: boolean}
export type Workspace = {path: string; file: string; name: string; manifest: Record<string, unknown>; text: string; released: boolean}

export const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

/** Inline-table dependencies with a path and a version requirement: `name = { path = "…", version = "…" }`. */
export const pathDependencies = (text: string) =>
  [...text.matchAll(/^\s*([\w-]+)\s*=\s*\{[^}\n]*\bpath\s*=\s*"[^"]+"[^}\n]*\}/gm)].flatMap(match => {
    const requirement = /\bversion\s*=\s*"([^"]*)"/.exec(match[0])
    return requirement ? [{name: match[1] as string, requirement: requirement[1] as string, index: match.index + requirement.index}] : []
  })

/** `[[package]]` entries of Cargo.lock without a source: the workspace's own crates. */
export function lockedCrates(text: string) {
  let offset = 0
  return text.split(/^(?=\[\[package\]\])/m).flatMap(block => {
    const start = offset
    offset += block.length
    const name = /^name = "([^"]+)"$/m.exec(block)?.[1]
    const version = /^version = "([^"]+)"$/m.exec(block)
    if (!block.startsWith('[[package]]') || !name || !version || /^source = /m.test(block)) return []
    return [{name, version: version[1] as string, index: start + version.index}]
  })
}

export type Release = {
  /** The Cargo workspace's version. */
  version: string | undefined
  crates: Crate[]
  workspaces: Workspace[]
}

export function readRelease(root: string): Release {
  const cargo = readText(root, 'Cargo.toml') ?? ''
  const workspaceVersion = tableVersion(cargo, 'workspace.package')
  const version = typeof workspaceVersion === 'object' ? workspaceVersion.value : undefined
  const crates = cargoMembers(root).flatMap(path => {
    const file = `${path}/Cargo.toml`
    const text = readText(root, file) ?? ''
    const name = /\[package\][^[]*?\bname\s*=\s*"([^"]+)"/.exec(text)?.[1]
    if (!name) return []
    const own = tableVersion(text, 'package')
    return [{path, file, name, text, version: own === 'inherited' ? version : own?.value, released: isReleased(path)}]
  })
  const workspaces = npmWorkspaces(root).flatMap(path => {
    const file = `${path}/package.json`
    const text = readText(root, file)
    if (text === undefined) return []
    const manifest = JSON.parse(text) as Record<string, unknown>
    return [{path, file, name: String(manifest['name']), manifest, text, released: isReleased(path)}]
  })
  return {version, crates, workspaces}
}
