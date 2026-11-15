import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolveRenderer} from '@githubnext/projections-host'

const catalog = JSON.parse(readFileSync(new URL('../dist/client/renderers/index.json', import.meta.url), 'utf8')).renderers.map(
  manifest => ({
    name: manifest.name,
    title: manifest.title,
    handles: manifest.handles,
    url: `https://h/renderers/${manifest.name}/index.html`,
    source: 'builtin',
  }),
)
const extraction = JSON.parse(
  readFileSync(new URL(import.meta.resolve('@githubnext/projections-schemas/schemas/extraction/v0.json')), 'utf8'),
)
/** The schema's `domainSchema` enum: the standard domain schemas. */
function standardSchemas(node) {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node.domainSchema?.enum)) return node.domainSchema.enum
  for (const value of Object.values(node)) {
    const found = standardSchemas(value)
    if (found) return found
  }
  return undefined
}

/** Families that only the host's table and text views present (`metrics` data has a renderer only when a definition names one, such as `code-statistics`). */
const tableOnly = new Set(['metrics'])

test('every standard schema resolves to a dedicated built-in renderer that handles its family, or to the host views', () => {
  const schemas = standardSchemas(extraction)
  assert.ok(schemas, 'the extraction schema lists the standard domain schemas')
  assert.ok(schemas.length >= 7)
  for (const schema of schemas) {
    const family = schema.split('/')[0]
    if (tableOnly.has(family)) {
      assert.equal(resolveRenderer(family, catalog).renderer, undefined, `${family} uses the host views`)
      continue
    }
    const renderer = resolveRenderer(family, catalog).renderer
    assert.ok(renderer && (renderer.name === family || renderer.handles.includes(family)), `${family} has a dedicated renderer`)
    // A custom renderer that isn't available falls back to the same dedicated renderer for the extraction's schema.
    assert.equal(
      resolveRenderer({bundle: 'custom/dist'}, catalog, undefined, schema).renderer?.name,
      renderer.name,
      `${schema} falls back to ${renderer.name}`,
    )
  }
  assert.ok(!catalog.some(entry => entry.name === 'basic'), 'no generic renderer ships')
  // One bundle presents every staged-graph name, so the layout engine ships once.
  for (const name of ['graph', 'graph-horizontal', 'dag', 'architecture'])
    assert.equal(resolveRenderer(name, catalog).renderer?.name, 'graph', name)
  // A renderer name nothing handles gets the host's own table and text views.
  assert.equal(resolveRenderer('unknown-renderer', catalog).renderer, undefined)
})
