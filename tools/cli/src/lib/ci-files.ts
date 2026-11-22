// Gives each file of a change one class, for the CI plan (ci-plan.ts), and nothing else happens to it:
//
// 1. The first file rule of .github/ci-rules.json whose paths match the file gives its class: lockfile, full, docs,
//    checks or code.
// 2. A docs file that a crate reads by path, or a generator reads or writes, is checks instead: the Linux checks run
//    every crate's tests and every generator's check.
// 3. A file no rule matches is code when a workspace or crate contains it or anything reads it, and full otherwise.
//
// A code file touches the workspace or crate containing it and the crates and workspaces that read it by path; a
// lockfile, the workspaces and crates whose resolved dependencies changed.
import {readersOf, type RepoFacts} from './ci-facts.ts'
import {lockfileReach} from './ci-lockfiles.ts'
import type {CiRules} from './ci-rules.schema.ts'
import {ownerOf} from './packages.ts'
import {matches} from './repo.ts'

export type FileClass = 'full' | 'docs' | 'checks' | 'code'

export interface ClassifiedFile {
  path: string
  class: FileClass
  /** Why it has its class: the file rule's description, or what the graph says. */
  rule: string
  /** Workspaces and crates it touches: containing it, building it in or reading it, or (a lockfile) whose dependencies changed. */
  touches: string[]
  /** Of those, the crates whose tests alone read it: their own suites run, but what depends on them isn't reached. */
  tested: string[]
}

/** A changed file's contents before and after the change, for lockfiles. */
export interface Contents {
  before: (path: string) => string | undefined
  after: (path: string) => string | undefined
}

export const UNOWNED = 'No file rule matches it, and no workspace or crate contains or reads it: run everything, to be safe'

const list = (items: readonly string[]) => items.join(', ')

export function classifyFile(facts: RepoFacts, rules: CiRules, path: string, contents?: Contents): ClassifiedFile {
  const readers = readersOf(facts, path)
  const generators = facts.generators.filter(item => matches(path, item.inputs) || matches(path, item.outputs)).map(item => item.name)
  const owner = ownerOf(facts.units, path)?.path
  const readBy = [...readers.build, ...readers.test]
  const rule = rules.files.find(item => matches(path, item.paths) && !(item.except && matches(path, item.except)))
  const file = (fileClass: FileClass, why: string, touches: string[] = [], tested: string[] = []): ClassifiedFile => ({
    path,
    class: fileClass,
    rule: why,
    touches,
    tested,
  })
  const code = (why: string) => {
    const built = [...new Set([...(owner ? [owner] : []), ...readers.build])].toSorted()
    return file(
      'code',
      why,
      [...new Set([...built, ...readers.test])].toSorted(),
      readers.test.filter(unit => !built.includes(unit)),
    )
  }
  const readNote = [
    ...(readBy.length ? [`read by ${list(readBy)}`] : []),
    ...(generators.length ? [`an input or output of the ${list(generators)} generator${generators.length > 1 ? 's' : ''}`] : []),
  ].join('; ')
  if (!rule) {
    if (owner) return code(`A file of ${owner}${readBy.length ? `, read by ${list(readBy)}` : ''}`)
    if (readNote) return code(`Outside every workspace and crate, ${readNote}`)
    return file('full', UNOWNED)
  }
  if (rule.class === 'docs' && readNote) return file('checks', `${rule.description}, but ${readNote}: the Linux checks`)
  if (rule.class === 'code') return code(rule.description)
  if (rule.class !== 'lockfile') return file(rule.class, rule.description)
  const before = contents?.before(path)
  const reach = before === undefined ? undefined : lockfileReach(path, before, contents?.after(path), facts.units)
  if (!reach) return file('full', `${rule.description}; there is no earlier version to compare`)
  if (reach.root) return file('full', `${rule.description}; the root's own dependencies changed`)
  return file('code', `${rule.description}: the resolved dependencies of ${list(reach.units) || 'nothing'} changed`, reach.units)
}

export function classifyFiles(facts: RepoFacts, rules: CiRules, paths: readonly string[], contents?: Contents): ClassifiedFile[] {
  return paths.map(path => classifyFile(facts, rules, path, contents))
}
