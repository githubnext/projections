// Sorts a change's files for the CI plan (ci-plan.ts) by the file rules of .github/ci-rules.json: the first rule that
// matches a file decides whether it runs everything, is documentation, runs the Linux checks alone, is its workspace's or
// crate's change, or is a change only to what reads it. But for `checks`, the crates that read a file by path count;
// whatever the rule, the generators that read or write it count, and it gets every tag whose paths it matches.
import {readersOf, type RepoFacts} from './ci-facts.ts'
import type {CiRules} from './ci-rules.ts'
import {ownerOf} from './packages.ts'
import {matches} from './repo.ts'

export type Sorted = {
  /** Workspaces and crates a changed file belongs to, or which build it in. */
  units: Set<string>
  /** Crates whose tests alone read a changed file. */
  tested: Set<string>
  /** Files that run everything, with the rule that says so. */
  everything: {path: string; rule: string}[]
  /** Whether every file is documentation. */
  docsOnly: boolean
  tags: Set<string>
  generators: Set<string>
}

type FileRule = CiRules['files'][number]

function applies(rule: FileRule, path: string, owned: boolean, read: boolean): boolean {
  if (rule.paths && !matches(path, rule.paths)) return false
  if (rule.except && matches(path, rule.except)) return false
  if (rule.owned !== undefined && rule.owned !== owned) return false
  return rule.read === undefined || rule.read === read
}

export function sortChanges(facts: RepoFacts, rules: CiRules, paths: readonly string[]): Sorted {
  const sorted: Sorted = {units: new Set(), tested: new Set(), everything: [], docsOnly: true, tags: new Set(), generators: new Set()}
  for (const path of paths) {
    const generated = facts.generators.filter(generator => matches(path, generator.inputs) || matches(path, generator.outputs))
    for (const generator of generated) sorted.generators.add(generator.name)
    const readers = readersOf(facts, path)
    for (const [tag, {paths: globs}] of Object.entries(rules.tags)) if (matches(path, globs)) sorted.tags.add(tag)
    const owner = ownerOf(facts.units, path)
    const read = generated.length > 0 || readers.build.length > 0 || readers.test.length > 0
    const rule = rules.files.find(candidate => applies(candidate, path, owner !== undefined, read))
    if (!rule) throw new Error(`No file rule in .github/ci-rules.json matches ${path}; end the list with one that matches every file`)
    if (rule.effect !== 'checks') {
      for (const crate of readers.build) sorted.units.add(crate)
      for (const crate of readers.test) sorted.tested.add(crate)
    }
    if (rule.effect !== 'docs') sorted.docsOnly = false
    if (rule.effect === 'full') sorted.everything.push({path, rule: rule.description})
    if (rule.effect === 'owner' && owner) sorted.units.add(owner.path)
  }
  if (sorted.generators.size) sorted.docsOnly = false
  return sorted
}
