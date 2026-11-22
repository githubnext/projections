import {isChanged} from '@githubnext/projections-renderer-kit'
import type {ComparisonModel, IconName, SummaryFactItem} from '@githubnext/projections-renderer-kit'
import {isRootEntity, membershipKinds, sideOf} from './kinds.js'
import {compareVersions, versionBump, versionOf} from './versions.js'
import type {VersionBump} from './versions.js'

const versionBumps: readonly VersionBump[] = ['major', 'minor', 'patch', 'prerelease']
const noun = (singular: string, plural: string) => ({singular, plural})

/**
 * The summary bar's dependency facts, what the kind counts can't say about a comparison, counted from the comparison
 * and each package's versions, each filtering to its packages: packages upgraded and downgraded by the part of the
 * version that moved, in the cards' words (`18 major upgrades`, `1 patch downgrade`), packages whose versions can't
 * be ordered or that changed otherwise, packages renamed, and the changed packages a workspace member or project
 * depends on directly, in either revision. Packages, workspace members and dependencies added, removed and modified
 * are the bar's kind counts.
 */
export function dependencyFacts(model: ComparisonModel): SummaryFactItem[] {
  if (model.mode !== 'comparison') return []
  const roots = new Set(model.entities.filter(row => isRootEntity(sideOf(row))).map(row => row.id))
  const direct = new Set<string>()
  for (const row of model.relationships) {
    if (membershipKinds.has(sideOf(row).kind)) continue
    for (const [side, relationship] of [
      ['before', row.before],
      ['after', row.after],
    ] as const) {
      if (!relationship) continue
      const from = model.entityRow[side].get(relationship.from),
        to = model.entityRow[side].get(relationship.to)
      if (from && to && roots.has(from) && !roots.has(to)) direct.add(to)
    }
  }
  const groups = new Map<string, {noun: {singular: string; plural: string}; icon?: IconName; ids: string[]}>()
  const add = (key: string, words: readonly [string, string], icon: IconName | undefined, id: string) => {
    const group = groups.get(key) ?? {noun: noun(words[0], words[1]), ...(icon ? {icon} : {}), ids: []}
    group.ids.push(id)
    groups.set(key, group)
  }
  const directIds: string[] = []
  for (const row of model.entities) {
    if (roots.has(row.id) || !isChanged(row)) continue
    if (direct.has(row.id)) directIds.push(row.id)
    if (row.status === 'added' || row.status === 'removed') continue
    if (row.status !== 'modified') {
      add('renamed', ['package renamed', 'packages renamed'], 'renamed', row.id)
      continue
    }
    const before = versionOf(row.before),
      after = versionOf(row.after)
    const direction = before && after && before !== after ? compareVersions(before, after) : 'changed'
    if (direction === 'changed') {
      add('changed', ['package changed otherwise', 'packages changed otherwise'], 'changed', row.id)
      continue
    }
    const bump = versionBump(before!, after!)
    const verb = direction === 'upgraded' ? 'upgrade' : 'downgrade'
    add(`${bump ?? 'other'}-${direction}`, bump ? [`${bump} ${verb}`, `${bump} ${verb}s`] : [verb, `${verb}s`], direction, row.id)
  }
  const order = [
    ...['upgraded', 'downgraded'].flatMap(direction => [...versionBumps, 'other'].map(bump => `${bump}-${direction}`)),
    'changed',
    'renamed',
  ]
  const facts: SummaryFactItem[] = order.flatMap(key => {
    const group = groups.get(key)
    return group
      ? [
          {
            type: 'fact' as const,
            id: key,
            ...(group.icon ? {icon: group.icon} : {}),
            count: group.ids.length,
            noun: group.noun,
            ids: group.ids,
          },
        ]
      : []
  })
  if (directIds.length) {
    facts.push({
      type: 'fact',
      id: 'direct',
      count: directIds.length,
      noun: noun('direct dependency changed', 'direct dependencies changed'),
      ids: directIds,
    })
  }
  return facts
}

/**
 * The dependency graph's words for the host's summary bar: workspace members are workspaces (a kind whose every item,
 * in either revision, is one), installed packages are packages, every dependency kind is a dependency of its sort
 * (`dev dependency`), and NuGet's `resolved` target memberships aren't counted. Workspaces come first, then packages,
 * then dependencies.
 */
export function dependencyNouns(model: ComparisonModel): Record<string, {singular: string; plural: string} | false> {
  const kinds = new Map<string, boolean>()
  for (const row of model.entities) {
    for (const entity of [row.before, row.after]) {
      if (entity) kinds.set(entity.kind, (kinds.get(entity.kind) ?? true) && entity.data?.workspaceMember === true)
    }
  }
  const nouns: Record<string, {singular: string; plural: string} | false> = {}
  for (const [kind, members] of kinds) if (members) nouns[kind] = noun('workspace', 'workspaces')
  if (kinds.has('project')) nouns.project = noun('project', 'projects')
  if (kinds.has('target-framework')) nouns['target-framework'] = noun('target framework', 'target frameworks')
  if (kinds.has('target')) nouns.target = noun('target', 'targets')
  if (kinds.has('product')) nouns.product = noun('product', 'products')
  for (const kind of ['package', 'external-package']) if (kinds.has(kind) && !nouns[kind]) nouns[kind] = noun('package', 'packages')
  const dependencyKinds: Record<string, string> = {
    dependencies: 'dependency',
    'depends-on': 'dependency',
    'direct-dependency': 'direct dependency',
    devDependencies: 'dev dependency',
    peerDependencies: 'peer dependency',
    optionalDependencies: 'optional dependency',
  }
  for (const [kind, singular] of Object.entries(dependencyKinds)) nouns[kind] = noun(singular, `${singular.slice(0, -1)}ies`)
  // A Swift product's targets.
  nouns.includes = noun('product target', 'product targets')
  for (const kind of membershipKinds) nouns[kind] = false
  return nouns
}
