// Regenerates `module-graph-*.json`: synthetic module import graphs of 30 to 60 modules, the size of a mid-sized app's
// own modules and the packages they use, in the shapes real ones take: layered (apps over features over core),
// wide (many independent features over a few foundations) and hub-heavy (every module imports the same shared
// ones). Layered and wide have a before and an after revision, the after adding a module and its imports and dropping
// another; hub-heavy is one revision, as routing many routes into a hub is slow enough that a comparison's checks
// outlast their time. Modules' names are as long as real ones.
//
//   node packages/renderers/graph/fixtures/make-module-graphs.mjs
import {writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** A deterministic pseudo-random sequence (Park–Miller), so the fixtures are the same on every run. */
function sequence(seed) {
  let state = seed
  return () => (state = (state * 16807) % 2147483647) / 2147483647
}

const words = [
  'Accounts', 'Actions', 'Analytics', 'Billing', 'Catalog', 'Clipboard', 'Commands', 'Contacts', 'Documents', 'Extensions',
  'Favorites', 'Files', 'Indexing', 'Licensing', 'Notes', 'Onboarding', 'Preferences', 'Previews', 'Ranking', 'Reminders',
  'Search', 'Settings', 'Shortcuts', 'Snippets', 'Storage', 'Sync', 'Telemetry', 'Themes', 'Updates', 'Windows',
]

/** A graph whose `layers` (top first) hold that many modules; each imports `imports` modules from the layers below. */
function layered(name, seed, layers, imports, hubs = 0, compared = true) {
  const random = sequence(seed)
  const entities = []
  const relationships = []
  const relate = (from, to) => {
    if (from !== to && !relationships.some(row => row.id === `${from}->${to}`))
      relationships.push({id: `${from}->${to}`, kind: 'imports', from, to})
  }
  const prefixes = ['App', 'Feature', 'Kit', 'Core', 'Base']
  const rows = layers.map((count, layer) =>
    Array.from({length: count}, (_, index) => {
      const id = `${prefixes[layer] ?? 'Lib'}${words[(index * 7 + layer * 3) % words.length]}${index >= words.length ? index : ''}`
      entities.push({id, kind: layer === layers.length - 1 ? 'package' : 'module', label: id})
      return id
    }),
  )
  const shared = rows.at(-1).slice(0, hubs)
  rows.forEach((row, layer) => {
    const below = rows.slice(layer + 1).flat()
    if (!below.length) return
    for (const id of row) {
      // The next layer first, so each module has a parent one layer down, then any lower one.
      relate(id, rows[layer + 1][Math.floor(random() * rows[layer + 1].length)])
      for (let count = 1; count < imports; count++) relate(id, below[Math.floor(random() * below.length)])
      for (const hub of shared) relate(id, hub)
    }
  })
  return {name, compared, extraction: {protocolVersion: 0, schema: 'graph/v0', entities, relationships}}
}

/** The after revision: a feature module arrives with its imports, and the last module of the second layer leaves. */
function evolve({extraction}) {
  const after = structuredClone(extraction)
  const modules = after.entities.filter(entity => entity.kind === 'module')
  const leaving = modules.at(-1).id
  after.entities = after.entities.filter(entity => entity.id !== leaving)
  after.relationships = after.relationships.filter(row => row.from !== leaving && row.to !== leaving)
  after.entities.push({id: 'FeatureQuickLook', kind: 'module', label: 'FeatureQuickLook'})
  const packages = after.entities.filter(entity => entity.kind === 'package').map(entity => entity.id)
  const added = [
    [modules[0].id, 'FeatureQuickLook'],
    ...packages.slice(0, 2).map(to => ['FeatureQuickLook', to]),
  ]
  for (const [from, to] of added) after.relationships.push({id: `${from}->${to}`, kind: 'imports', from, to})
  return after
}

const graphs = [
  // Apps over features over kits over core and third-party packages: 36 modules, as in a field report.
  layered('layered', 20261117, [3, 12, 9, 6, 6], 3),
  // Many independent features over a handful of foundations: a wide, shallow graph of 48.
  layered('wide', 20261118, [2, 34, 6, 6], 2),
  // Every one of 33 modules imports the same two shared ones besides its own: long edges fan into two hubs.
  layered('hub-heavy', 20261119, [3, 10, 9, 6, 5], 1, 2, false),
]

const sorted = extraction => ({
  ...extraction,
  entities: extraction.entities.toSorted((a, b) => (a.id < b.id ? -1 : 1)),
  relationships: extraction.relationships.toSorted((a, b) => (a.id < b.id ? -1 : 1)),
})
const format = extraction =>
  `{\n  "protocolVersion": 0,\n  "schema": "${extraction.schema}",\n  "entities": [\n${extraction.entities.map(row => `    ${JSON.stringify(row)}`).join(',\n')}\n  ],\n  "relationships": [\n${extraction.relationships.map(row => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]\n}\n`
for (const graph of graphs) {
  writeFileSync(path.join(here, `module-graph-${graph.name}${graph.compared ? '-before' : ''}.json`), format(sorted(graph.extraction)))
  if (graph.compared) writeFileSync(path.join(here, `module-graph-${graph.name}-after.json`), format(sorted(evolve(graph))))
}
