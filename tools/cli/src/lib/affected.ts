// What a change touches: the changed files' workspaces and crates, everything that depends on them, the generated
// files that may need regenerating, and the checks and tests to run.
import {generatorsAffectedBy, type Generator} from './generated.ts'
import {dependantsOf, ownerOf, type Unit} from './packages.ts'
import type {Change} from './git.ts'

export interface Affected {
  /** Workspaces and crates containing a changed file. */
  changed: string[]
  /** Workspaces and crates depending, directly or transitively, on a changed one. */
  dependants: string[]
  /** Changed files outside every workspace and crate (docs, scripts, root configuration). */
  unowned: string[]
  /** Generators whose inputs changed: their outputs may need regenerating. */
  regenerate: {name: string; outputs: string[]; generate: string}[]
  /** Kinds of change, which select checks: TypeScript/JavaScript, Rust, Markdown, comparator files, manifests. */
  kinds: ChangeKind[]
}

export type ChangeKind = 'ts' | 'rust' | 'docs' | 'comparators' | 'manifests' | 'workflows'

export function kindsOf(paths: readonly string[]): ChangeKind[] {
  const kinds = new Set<ChangeKind>()
  for (const path of paths) {
    if (/\.[cm]?[jt]sx?$/u.test(path)) kinds.add('ts')
    if (/\.rs$|(?:^|\/)Cargo\.(?:toml|lock)$|^rust-toolchain\.toml$/u.test(path)) kinds.add('rust')
    if (/\.md$/u.test(path)) kinds.add('docs')
    if (/\.comparator(?:\.test)?\.ya?ml$/u.test(path) || path.startsWith('packages/comparators/') || path.startsWith('packages/schemas/')) {
      kinds.add('comparators')
    }
    if (/(?:^|\/)package(?:-lock)?\.json$|(?:^|\/)tsconfig[\w.]*\.json$|^\.npmrc$/u.test(path)) kinds.add('manifests')
    if (path.startsWith('.github/')) kinds.add('workflows')
  }
  return [...kinds].sort()
}

export function affected(units: readonly Unit[], changes: readonly Change[], registry?: readonly Generator[]): Affected {
  const paths = changes.map(change => change.path)
  const changed = new Set<string>()
  const unowned: string[] = []
  for (const path of paths) {
    const owner = ownerOf(units, path)
    if (owner) changed.add(owner.path)
    else unowned.push(path)
  }
  const regenerate = generatorsAffectedBy(paths, registry).map(generator => ({
    name: generator.name,
    outputs: generator.outputs,
    generate: generator.generate.map(command => command.argv.join(' ')).join(' && '),
  }))
  return {
    changed: [...changed].sort(),
    dependants: dependantsOf(units, changed),
    unowned,
    regenerate,
    kinds: kindsOf(paths),
  }
}
