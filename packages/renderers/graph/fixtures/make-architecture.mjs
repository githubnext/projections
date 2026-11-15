// Regenerates `large-architecture-before.json` and `-after.json`: a synthetic architecture of about 200 components in
// a dozen module boundaries, with shared hubs many components depend on and long-span relationships from the apps to
// the shared libraries, as a real monorepo's topology has. The after revision changes one module only: a component
// arrives with its dependencies, one leaves and one moves to another hub, so most boundaries are unchanged.
//
//   node renderers/graph/fixtures/make-architecture.mjs
import {writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** A deterministic pseudo-random sequence (Park–Miller), so the fixture is the same on every run. */
function sequence(seed) {
  let state = seed
  return () => (state = (state * 16807) % 2147483647) / 2147483647
}

function architecture() {
  const random = sequence(20251111)
  const pick = list => list[Math.floor(random() * list.length)]
  const entities = []
  const relationships = []
  const relate = (from, to, kind) => {
    if (!relationships.some(row => row.id === `${from}->${to}`)) relationships.push({id: `${from}->${to}`, kind, from, to})
  }
  const component = (id, kind, module) => {
    entities.push({id, kind, label: id.split('/').at(-1)})
    if (module) relate(module, id, 'contains')
  }
  const modules = ['apps', 'gateway', 'billing', 'catalog', 'search', 'identity', 'messaging', 'storage', 'analytics', 'extractors', 'shared']
  for (const module of modules) entities.push({id: module, kind: 'module', label: module})
  // Shared libraries: two hubs most components depend on, and a few others.
  const hubs = ['shared/sdk', 'shared/schemas']
  const libraries = [...hubs, 'shared/logging', 'shared/config', 'shared/http', 'shared/testing']
  for (const id of libraries) component(id, 'library', 'shared')
  relate('shared/schemas', 'shared/config', 'depends-on')
  relate('shared/http', 'shared/logging', 'depends-on')
  // Apps reach across every layer to the shared libraries.
  const apps = ['apps/web', 'apps/cli', 'apps/desktop', 'apps/worker', 'apps/admin']
  for (const id of apps) component(id, 'app', 'apps')
  const services = []
  const sizes = {gateway: 14, billing: 18, catalog: 20, search: 16, identity: 17, messaging: 19, storage: 18, analytics: 20, extractors: 30}
  for (const [module, count] of Object.entries(sizes))
    for (let index = 0; index < count; index++) {
      const id = `${module}/${module === 'extractors' ? 'extractor' : 'service'}-${String(index + 1).padStart(2, '0')}`
      component(id, module === 'extractors' ? 'extractor' : 'service', module)
      services.push(id)
    }
  for (const id of services) {
    const module = id.split('/')[0]
    const siblings = services.filter(other => other.startsWith(`${module}/`) && other < id)
    // Every extractor depends on the SDK hub; services on one hub or the other.
    relate(id, module === 'extractors' ? hubs[0] : pick(hubs), 'depends-on')
    if (siblings.length && random() < 0.6) relate(id, pick(siblings), 'calls')
    if (random() < 0.3) relate(id, pick(libraries.slice(2)), 'depends-on')
  }
  for (const app of apps) {
    for (const module of ['gateway', 'identity', 'catalog', 'billing']) relate(app, pick(services.filter(id => id.startsWith(`${module}/`))), 'calls')
    relate(app, hubs[0], 'depends-on')
    relate(app, 'shared/config', 'depends-on')
  }
  return {protocolVersion: 0, schema: 'architecture/v0', entities, relationships}
}

const before = architecture()
const after = structuredClone(before)
// Billing gains an invoicing service with its dependencies, retires service-18 and moves service-03 to the other hub.
after.entities.push({id: 'billing/invoicing', kind: 'service', label: 'invoicing'})
after.relationships.push(
  {id: 'billing->billing/invoicing', kind: 'contains', from: 'billing', to: 'billing/invoicing'},
  {id: 'billing/invoicing->shared/sdk', kind: 'depends-on', from: 'billing/invoicing', to: 'shared/sdk'},
  {id: 'billing/invoicing->billing/service-01', kind: 'calls', from: 'billing/invoicing', to: 'billing/service-01'},
)
const retired = 'billing/service-18'
after.entities = after.entities.filter(entity => entity.id !== retired)
after.relationships = after.relationships.filter(row => row.from !== retired && row.to !== retired)
for (const row of after.relationships)
  if (row.from === 'billing/service-03' && row.kind === 'depends-on' && row.to.startsWith('shared/s')) {
    row.to = row.to === 'shared/sdk' ? 'shared/schemas' : 'shared/sdk'
    row.id = `${row.from}->${row.to}`
  }
const sorted = extraction => ({
  ...extraction,
  entities: extraction.entities.toSorted((a, b) => (a.id < b.id ? -1 : 1)),
  relationships: extraction.relationships.toSorted((a, b) => (a.id < b.id ? -1 : 1)),
})
const format = extraction =>
  `{\n  "protocolVersion": 0,\n  "schema": "architecture/v0",\n  "entities": [\n${extraction.entities.map(row => `    ${JSON.stringify(row)}`).join(',\n')}\n  ],\n  "relationships": [\n${extraction.relationships.map(row => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]\n}\n`
writeFileSync(path.join(here, 'large-architecture-before.json'), format(sorted(before)))
writeFileSync(path.join(here, 'large-architecture-after.json'), format(sorted(after)))
