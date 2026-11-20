// Sorts a change's files for the CI plan (ci-plan.ts): the workspaces and crates they belong to or which read them,
// documentation, configuration only the checks read, release and action files, and what runs everything.
import {readersOf, type RepoFacts} from './ci-facts.ts'
import {ownerOf} from './packages.ts'
import {matches} from './repo.ts'

/** Run everything: CI's definition, toolchains, lockfiles and root manifests, and the repository's own tooling. */
export const everything = [
  '.github/workflows/**',
  '.github/actions/**',
  'package.json',
  'package-lock.json',
  'Cargo.toml',
  'Cargo.lock',
  'rust-toolchain.toml',
  '.node-version',
  '.npmrc',
  '.cargo/**',
  'tools/cli/**',
  'tools/scripts/**',
]
/** Read only as documentation (unless a generator reads or writes it). */
const documentation = ['**/*.md', 'docs/**', 'LICENSE', '.github/CODEOWNERS', '.github/ISSUE_TEMPLATE/**']
/** Configuration only the checks in public-product read: file standards, formatting, lint, the self-projection. */
const checksOnly = [
  '.considered.yaml',
  '.oxfmtrc.json',
  'eslint.config.js',
  '.portability.yaml',
  'rustfmt.toml',
  '.github/actionlint.yaml',
  '.github/dependabot.yml',
  '.github/projections/**',
  '.projections-bookmarks.json',
]
export const releaseFiles = ['dist-workspace.toml', '.github/release-build-setup.yml', '**/Cargo.toml']
const actionFiles = ['action.yml']
/** Markdown that is test data or a template, not documentation. */
const notDocumentation = /(^|\/)(fixtures|tests?|templates|snapshots|golden|vendor)\//

export type Sorted = {
  /** Workspaces and crates a changed file belongs to, or which build it in. */
  units: Set<string>
  /** Crates whose tests alone read a changed file. */
  tested: Set<string>
  docs: string[]
  checks: string[]
  release: string[]
  action: string[]
  everything: string[]
}

export function sortChanges(facts: RepoFacts, paths: readonly string[], generators: Set<string>): Sorted {
  const sorted: Sorted = {units: new Set(), tested: new Set(), docs: [], checks: [], release: [], action: [], everything: []}
  for (const path of paths) {
    const generated = facts.generators.filter(generator => matches(path, generator.inputs) || matches(path, generator.outputs))
    for (const generator of generated) generators.add(generator.name)
    const readers = readersOf(facts, path)
    for (const crate of readers.build) sorted.units.add(crate)
    for (const crate of readers.test) sorted.tested.add(crate)
    const read = generated.length || readers.build.length || readers.test.length
    if (matches(path, everything)) sorted.everything.push(path)
    else if (!read && path.endsWith('.md') && !notDocumentation.test(path)) sorted.docs.push(path)
    else if (ownerOf(facts.units, path)) sorted.units.add(ownerOf(facts.units, path)?.path as string)
    else if (read) continue
    else if (matches(path, documentation) && !notDocumentation.test(path)) sorted.docs.push(path)
    else if (matches(path, checksOnly)) sorted.checks.push(path)
    else if (matches(path, actionFiles)) sorted.action.push(path)
    else if (matches(path, releaseFiles)) sorted.release.push(path)
    else sorted.everything.push(path)
    if (matches(path, releaseFiles) && !sorted.release.includes(path)) sorted.release.push(path)
  }
  return sorted
}
