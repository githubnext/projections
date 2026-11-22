// `affected`: the changed workspaces and crates, their dependants and what to regenerate.
import {TOOLS} from '../../lib/gates.ts'
import {changeSet} from './change-set.ts'

export function affectedReport(root: string, since?: string) {
  const {base, changes, units, affected: change} = changeSet(root, since)
  const byPath = new Map(units.map(unit => [unit.path, unit]))
  const label = (path: string) => {
    const unit = byPath.get(path)!
    return {path, kind: unit.kinds.join('+'), name: unit.names.join(', ')}
  }
  const tests = [...change.changed, ...change.dependants].filter(
    path => byPath.get(path)?.scripts.includes('test') === true || byPath.get(path)?.kinds.includes('crate') === true,
  )
  return {
    base: base
      ? {ref: base.ref, commit: base.commit.slice(0, 12), reason: base.reason}
      : {ref: 'HEAD', commit: '', reason: 'no base found; uncommitted changes only'},
    files: changes.length,
    changed: change.changed.map(label),
    dependants: change.dependants.map(label),
    other: change.unowned.slice(0, 20),
    ...(change.unowned.length > 20 ? {moreOther: change.unowned.length - 20} : {}),
    regenerate: change.regenerate,
    kinds: change.kinds,
    next: changes.length
      ? [
          `${TOOLS} check --affected${since ? ` --since ${since}` : ''}`,
          `${TOOLS} test --affected${since ? ` --since ${since}` : ''}${change.kinds.includes('rust') ? ' --rust' : ''}`,
          ...change.regenerate.map(generator => `${TOOLS} generated check --only ${generator.name}`),
          ...tests.slice(0, 3).map(path => `${TOOLS} test ${path}`),
        ]
      : [`${TOOLS} check`],
  }
}
