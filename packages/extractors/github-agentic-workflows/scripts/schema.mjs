#!/usr/bin/env node
// Generates vendor/gh-aw/fields.json (and its LICENSE and vendor.json) from gh-aw's published front matter schema,
// pkg/parser/schemas/main_workflow_schema.json, at a pinned release: the fields gh-aw knows at each object the
// extractor reads, and the ones it marks deprecated. The extractor embeds the table to tell recognized fields from
// unrecognized ones and to record which gh-aw release it understands.
//
//   node scripts/schema.mjs                      fetches the pinned release from GitHub
//   node scripts/schema.mjs --source <checkout>  reads the schema and LICENSE from a local gh-aw checkout at that tag
//   node scripts/schema.mjs --check              fails when the committed table differs from the pinned release's
//
// To move to a new gh-aw release, change `release` and `commit` below, run the script, then run the extractor's tests
// (`cargo test -p projections-extractor-github-agentic-workflows`) and update the goldens they report as changed.
import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

const release = 'v1.3.0'
const commit = '789cc9c2da60fca3b4e0396591c7179be3b5d9eb'
const repository = 'https://github.com/github/gh-aw'
const schemaPath = 'pkg/parser/schemas/main_workflow_schema.json'
const output = new URL('../vendor/gh-aw/', import.meta.url)

/** The objects whose fields the extractor checks, as dotted paths from the front matter's root ('' is the root). */
const objects = ['', 'on', 'engine', 'tools', 'tools.github', 'network', 'permissions', 'safe-outputs', 'sandbox']

const argument = name => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

async function read(file) {
  const source = argument('--source')
  if (source) return readFileSync(join(source, file), 'utf8')
  const response = await fetch(`https://raw.githubusercontent.com/github/gh-aw/${commit}/${file}`)
  if (!response.ok) throw new Error(`Fetching ${file} at ${release}: HTTP ${response.status}`)
  return response.text()
}

const schema = JSON.parse(await read(schemaPath))

/** A schema node with its local `$ref`s (JSON pointers into the schema, such as `#/$defs/x`) followed. */
function resolve(node) {
  let current = node
  for (let depth = 0; current?.$ref && depth < 16; depth++) {
    if (!current.$ref.startsWith('#/')) throw new Error(`Unsupported $ref ${current.$ref}`)
    current = current.$ref
      .slice(2)
      .split('/')
      .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
      .reduce((parent, segment) => parent?.[segment], schema)
    if (!current) throw new Error(`Unresolved $ref ${node.$ref}`)
  }
  return current
}

/** Every object branch of a node: itself, and its `oneOf`, `anyOf` and `allOf` alternatives, recursively. */
function branches(node, seen = new Set()) {
  const resolved = resolve(node)
  if (!resolved || typeof resolved !== 'object' || seen.has(resolved)) return []
  seen.add(resolved)
  const nested = ['oneOf', 'anyOf', 'allOf'].flatMap(key => (resolved[key] ?? []).flatMap(item => branches(item, seen)))
  return [resolved, ...nested]
}

const deprecated = node => {
  const resolved = resolve(node) ?? {}
  return resolved.deprecated === true || /^\s*deprecated\b/iu.test(resolved.description ?? '')
}

/** The fields a node knows, each with whether gh-aw marks it deprecated, from every branch. */
function fieldsOf(node) {
  const fields = new Map()
  for (const branch of branches(node)) {
    for (const [name, property] of Object.entries(branch.properties ?? {})) {
      fields.set(name, (fields.get(name) ?? false) || deprecated(property))
    }
  }
  return fields
}

/** The node at a dotted path, through the properties of any branch. */
function nodeAt(path) {
  let node = schema
  for (const segment of path ? path.split('.') : []) {
    node = branches(node).find(branch => branch.properties?.[segment])?.properties[segment]
    if (!node) throw new Error(`The schema has no ${path}`)
  }
  return node
}

/**
 * Each safe output handler's default `max`, which gh-aw documents in the field's description (`(default: 1)`,
 * `(default: unlimited)`), so a handler without one can be compared with one that sets it.
 */
function defaultMaxima() {
  const maxima = {}
  for (const [kind, handler] of Object.entries(branches(nodeAt('safe-outputs')).find(branch => branch.properties)?.properties ?? {})) {
    const max = branches(handler).find(branch => branch.properties?.max)?.properties.max
    const found = max && (resolve(max).description ?? '').match(/\(default:\s*(\d+|unlimited)\b/u)
    if (found) maxima[kind] = found[1] === 'unlimited' ? 'unlimited' : Number(found[1])
  }
  return Object.fromEntries(Object.entries(maxima).sort(([a], [b]) => (a < b ? -1 : 1)))
}

const table = {
  format: 'projections.gh-aw-fields',
  release,
  commit,
  schema: `${repository}/blob/${release}/${schemaPath}`,
  objects: Object.fromEntries(
    objects.map(path => {
      const fields = fieldsOf(nodeAt(path))
      if (!fields.size) throw new Error(`The schema's ${path || 'root'} declares no fields`)
      const names = [...fields.keys()].sort()
      return [path, {known: names, deprecated: names.filter(name => fields.get(name))}]
    }),
  ),
  maxima: defaultMaxima(),
}

const files = {
  'fields.json': `${JSON.stringify(table, null, 2)}\n`,
  'vendor.json': `${JSON.stringify(
    {
      name: 'github/gh-aw main_workflow_schema.json (field names only)',
      version: release,
      commit,
      license: 'MIT',
      source: `${repository}/blob/${release}/${schemaPath}`,
    },
    null,
    2,
  )}\n`,
  LICENSE: await read('LICENSE'),
}

if (process.argv.includes('--check')) {
  const stale = Object.entries(files).filter(([name, text]) => readFileSync(new URL(name, output), 'utf8') !== text)
  if (stale.length) {
    console.error(`vendor/gh-aw is stale against gh-aw ${release}: ${stale.map(([name]) => name).join(', ')}`)
    process.exit(1)
  }
} else {
  for (const [name, text] of Object.entries(files)) writeFileSync(new URL(name, output), text)
  console.log(`Wrote vendor/gh-aw from gh-aw ${release} (${commit.slice(0, 12)})`)
}
