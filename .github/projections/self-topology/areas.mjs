// Self topology, part of extract.mjs: its areas, boundaries around units, and the extraction's entities.
import path from 'node:path'
import {firstSentence, frontMatterDescription, frontMatterIcon, provedWords, rounded, usesProved} from './facts.mjs'
import {channelWords} from './releases.mjs'
import {byText, sortedUnique} from './files.mjs'
import {prefixOf} from './units.mjs'

/** The extraction's entities: a module per area (with `contains` relationships to its units), then every unit. */
export function topologyEntities(cx) {
  const {roots, units, relationships, facts, read, containerOf, belowContainer, relativeDirectory} = cx
  // ---------------------------------------------------------------------------------------------------------------
  // Areas: a module per top-level directory holding two or more units, which the architecture renderer draws as a
  // boundary. Units of a root other than the first are grouped by their root.

  const areaGroups = new Map()
  for (const unit of units.values()) {
    if (unit.single && path.posix.dirname(unit.single) === (unit.root || '.')) continue
    const key = unit.root === roots[0].path ? belowContainer(unit, relativeDirectory(unit)).split(/[/#]/u)[0] : unit.root
    if (!key) continue
    areaGroups.set(key, [...(areaGroups.get(key) ?? []), unit.id])
  }

  // Repository tooling: the first root's units outside every area that nothing ships, which are built and run only in
  // the repository (its command line, its Storybook, a source-checkout launcher). A unit ships when a release attaches or
  // publishes it (`releases.mjs`), or when a unit that ships depends on, bundles, compiles to or loads it.
  const shipped = new Set([...units.values()].filter(unit => unit.meta?.published?.length).map(unit => unit.id))
  const carried = [...relationships.values()].filter(({kind}) => ['depends-on', 'bundles', 'compiles-to', 'loads'].includes(kind))
  for (let grew = true; grew;) {
    grew = false
    for (const {from, to} of carried) {
      if (shipped.has(from) && !shipped.has(to)) {
        shipped.add(to)
        grew = true
      }
    }
  }
  const unshipped = 'Built and run only here; no release ships it'
  const grouped = new Set([...areaGroups.values()].filter(members => members.length >= 2).flat())
  const tooling = [...units.values()]
    .filter(unit => unit.root === roots[0].path && unit.kind !== 'wasm-module' && !grouped.has(unit.id) && !shipped.has(unit.id))
    .map(unit => unit.id)

  const boundaries = [...areaGroups]
    .filter(([, members]) => members.length >= 2)
    .map(([key, members]) => {
      const first = units.get(members[0])
      // An area outside the root's container (`tools` beside `packages`) is its own directory.
      const contained = containerOf(first) && relativeDirectory(first).startsWith(containerOf(first))
      const directory = first.root === roots[0].path ? `${prefixOf(roots[0].path)}${contained ? containerOf(first) : ''}${key}` : key
      // A boundary is described by its directory's README, whose front matter may name its icon.
      const readme = read(`${directory}/README.md`)
      const written = frontMatterDescription(readme) ?? firstSentence(readme)
      const icon = frontMatterIcon(readme)
      // Without one, an area of the first root that nothing ships says so.
      const description = written ?? (first.root === roots[0].path && !members.some(member => shipped.has(member)) ? unshipped : undefined)
      const source = (written || icon) && readme ? `${directory}/README.md` : undefined
      return {id: `area:${key}`, key, label: key, members, directory, description, icon, readme: source}
    })
  if (tooling.length >= 2) {
    boundaries.push({
      id: 'group:repository-tooling',
      key: '',
      label: 'Repository tooling',
      members: tooling,
      description: unshipped,
    })
  }

  const entities = []
  for (const {id, key, label, members, directory, description, icon, readme} of boundaries.sort((a, b) => byText(a.id, b.id))) {
    // A boundary is sized by its members.
    const code = members.reduce((sum, member) => sum + (facts.get(member).tokens ?? 0), 0)
    // Its language is the one most of its members' code is in.
    const byLanguage = new Map()
    for (const member of members) {
      const {language, tokens: count = 0} = facts.get(member)
      if (language) byLanguage.set(language, (byLanguage.get(language) ?? 0) + count)
    }
    const language = [...byLanguage].sort(([a, x], [b, y]) => y - x || byText(a, b))[0]?.[0]
    // How its members are assured and where they run, so a collapsed boundary still says it.
    const union = field => sortedUnique(members.flatMap(member => facts.get(member)[field] ?? []))
    // What the members publish is theirs; that some use proved code says nothing new where the proofs are too.
    // Its proofs add up; a boundary without any of its own says its members use proved code.
    const proved = members.reduce((sum, member) => sum + (facts.get(member).provedFunctions ?? 0), 0)
    const verification = proved ? [provedWords(proved)] : union('verification').length ? [usesProved] : []
    const published = new Set(members.flatMap(member => (units.get(member).meta?.published ?? []).map(channelWords)))
    const traits = union('traits').filter(trait => !published.has(trait))
    const runs = union('runs')
    entities.push({
      id,
      kind: 'module',
      label,
      data: {
        ...(directory ? {path: directory} : {}),
        ...(description ? {description} : {}),
        ...(icon ? {icon} : {}),
        ...(code ? {tokens: rounded(code)} : {}),
        ...(language ? {language} : {}),
        verification,
        ...(traits.length ? {traits} : {}),
        ...(runs.length ? {runs} : {}),
      },
      ...(readme ? {evidence: [{kind: 'readme', source: readme}]} : {}),
    })
    for (const member of sortedUnique(members)) {
      // Inside its boundary a unit is named relative to it (`extractors/sdk` reads `sdk`), which keeps cards narrow.
      const unit = units.get(member)
      const prefix = key && unit.label.startsWith(`${key}/`) ? `${key}/` : ''
      if (prefix) unit.label = unit.label.slice(prefix.length)
      relationships.set(`${id}->${member}`, {
        id: `${id}->${member}`,
        kind: 'contains',
        from: id,
        to: member,
        via: new Set(),
        evidence: [],
        confidence: 'derived',
      })
    }
  }

  const ecosystems = {'rust-crate': 'cargo', 'npm-package': 'npm', 'wasm-module': 'wasm', script: 'shell'}
  for (const unit of [...units.values()].sort((a, b) => byText(a.id, b.id))) {
    const capabilityFiles = Object.fromEntries(
      Object.entries(unit.capabilityFiles)
        .sort(([a], [b]) => byText(a, b))
        .map(([capability, list]) => [capability, sortedUnique(list)]),
    )
    // Where a description was read is evidence, not a fact about the unit: moving a README changes nothing it says.
    const {descriptionSource, ...known} = facts.get(unit.id)
    entities.push({
      id: unit.id,
      kind: unit.kind,
      label: unit.label,
      data: {
        ...unit.data,
        ecosystem: ecosystems[unit.kind] ?? unit.language,
        ...known,
        ...(unit.scan ? {capabilities: Object.keys(capabilityFiles), capabilityModules: capabilityFiles} : {}),
      },
      evidence: [
        ...(unit.manifest ? [{kind: 'manifest', source: unit.manifest}] : unit.single ? [{kind: 'file', source: unit.single}] : []),
        ...(descriptionSource && descriptionSource !== unit.manifest ? [{kind: 'readme', source: descriptionSource}] : []),
        ...unit.evidence.sort((a, b) => byText(a.kind, b.kind) || byText(a.source, b.source)),
      ],
      confidence: unit.kind === 'wasm-module' || unit.kind === 'helper' ? 'derived' : 'authoritative',
    })
  }
  return entities
}
