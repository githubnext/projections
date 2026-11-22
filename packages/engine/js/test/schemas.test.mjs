// Parity between the published JSON Schemas (generated from the TypeBox definitions in the schemas package)
// and the engine, which stays authoritative for what JSON Schema can't express:
//
// - every extraction the engine accepts, the extraction schema accepts: the engine's vectors, the shared
//   corpus and every extraction in this repository (extractor goldens, renderer fixtures and scenarios);
// - every extraction the engine rejects, the schema rejects too, unless the rule is one only the engine can
//   check (identity, topology, raw JSON and size);
// - every typed `data` field of every domain rule: a valid value passes both, and wrong types and missing
//   required fields fail both, the engine at the field's path. A rule added to the schemas that the engine
//   doesn't follow fails here (and in the engine's own test of its rule table).
import assert from 'node:assert/strict'
import {readdirSync, readFileSync, statSync} from 'node:fs'
import {join, relative} from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {Ajv2020} from 'ajv/dist/2020.js'
import {dataRules, schemaUrl} from '@githubnext/projections-schemas'
import {createNativeEngine, EngineError} from '../dist/native.js'
import {engineCases} from './vectors.mjs'

const engine = createNativeEngine()
const root = fileURLToPath(new URL('../../../../', import.meta.url))
const published = join(root, 'packages/schemas/schemas')
const ajv = new Ajv2020({allErrors: false, strictTuples: false})
for (const file of readdirSync(published, {recursive: true}).filter(file => /v\d+\.json$/u.test(file))) {
  ajv.addSchema(JSON.parse(readFileSync(join(published, file), 'utf8')))
}
const extractionSchema = ajv.getSchema(schemaUrl('extraction'))
const domainSchema = schema => ajv.getSchema(schemaUrl(schema.replace(/\/v\d+$/u, '')))

/** Rules only the engine checks: identity, topology, raw JSON and size. */
const engineOnly = new Set(['cycle', 'multiple-parents', 'duplicate-id', 'missing-endpoint', 'ambiguous-identity', 'depth-limit'])
/** Treemap leaves need a weight; whether an entity is a leaf depends on the relationships. */
const engineOnlyCases = new Set(['treemap-leaf-needs-weight'])

async function engineVerdict(extraction) {
  try {
    await engine.normalize(extraction)
    return {ok: true}
  } catch (error) {
    if (!(error instanceof EngineError)) throw error
    return {ok: false, code: error.diagnostics[0].code, path: error.diagnostics[0].path}
  }
}

function schemaVerdict(extraction) {
  const ok = extractionSchema(extraction)
  const errors = extractionSchema.errors
  // A domain schema's own document agrees with the envelope's dispatch to it.
  if (ok) assert.equal(domainSchema(extraction.schema)(extraction), true, `${extraction.schema} document disagrees with the envelope`)
  return {ok, errors}
}

/** Every extraction-shaped value in this repository's JSON files. */
function repositoryExtractions() {
  const found = []
  const skip = new Set(['node_modules', 'target', 'dist', '.git', 'storybook-static', 'static'])
  const visit = (value, file) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) return value.forEach(item => visit(item, file))
    if (value.protocolVersion === 0 && typeof value.schema === 'string' && Array.isArray(value.entities)) found.push({file, value})
    else for (const item of Object.values(value)) visit(item, file)
  }
  const walk = directory => {
    for (const name of readdirSync(directory)) {
      if (skip.has(name)) continue
      const path = join(directory, name)
      const stats = statSync(path)
      if (stats.isDirectory()) walk(path)
      else if (name.endsWith('.json') && stats.size < 40e6) {
        let value
        try {
          value = JSON.parse(readFileSync(path, 'utf8'))
        } catch {
          continue
        }
        visit(value, relative(root, path))
      }
    }
  }
  walk(root)
  return found
}

test('engine vectors: what the engine accepts the schema accepts, and what it rejects the schema rejects unless only the engine can check it', async () => {
  const corpus = JSON.parse(readFileSync(join(root, 'packages/schemas/fixtures/conformance.json'), 'utf8'))
  const cases = [...corpus.cases, ...engineCases].filter(item => ['normalize', 'canonicalize'].includes(item.request.operation))
  assert.ok(cases.length > 40)
  for (const item of cases) {
    const extraction = item.request.extraction
    const verdict = await engineVerdict(extraction)
    assert.equal(verdict.ok, !item.expectError, item.id)
    const schema = schemaVerdict(extraction)
    if (verdict.ok) assert.equal(schema.ok, true, `${item.id}: ${JSON.stringify(schema.errors)}`)
    else if (!engineOnly.has(verdict.code) && !engineOnlyCases.has(item.id)) {
      assert.equal(schema.ok, false, `${item.id}: the engine rejects it (${verdict.code}) but the schema accepts it`)
    }
  }
})

test('every extraction in this repository that the engine accepts conforms to the schemas', async () => {
  const extractions = repositoryExtractions()
  assert.ok(extractions.length > 50, String(extractions.length))
  const mismatches = []
  for (const {file, value} of extractions) {
    const verdict = await engineVerdict(value)
    const schema = schemaVerdict(value)
    if (verdict.ok && !schema.ok) mismatches.push(`${file}: schema rejects ${JSON.stringify(schema.errors?.[0])}`)
    if (!verdict.ok && schema.ok && !engineOnly.has(verdict.code)) {
      mismatches.push(`${file}: engine rejects ${verdict.code} at ${verdict.path}`)
    }
  }
  assert.deepEqual(mismatches, [])
})

const valid = {
  text: 'x',
  string: 'x',
  number: -1.5,
  nonnegative: 2,
  boolean: true,
  'nullable-string': null,
  strings: ['a', 'b'],
  object: {any: [1]},
}
const invalid = {
  text: [1, ' ', ''],
  string: [1, null, false],
  number: ['1', null, {}],
  nonnegative: [-1, '1', null],
  boolean: [1, null, 'true'],
  'nullable-string': [1, false, []],
  strings: ['a', ['a', 1], {}],
  object: [[], 'x', null],
}

/** A valid value of a field's type: a record with its required fields. */
function validOf(field) {
  if (field.type === 'enum') return field.values.at(-1)
  if (field.type === 'array') return [validOf(field.items)]
  if (field.type === 'record') {
    return Object.fromEntries(Object.entries(field.fields).flatMap(([name, item]) => (item.required ? [[name, validOf(item)]] : [])))
  }
  return valid[field.type]
}

/** Invalid values of a field's type, and the path below the field each fails at. */
function invalidOf(field) {
  if (field.type === 'enum') {
    return [
      {value: 'unknown value', below: ''},
      {value: 1, below: ''},
    ]
  }
  if (field.type === 'array') {
    return [
      {value: {}, below: ''},
      ...invalidOf(field.items).map(({value, below}) => ({value: [validOf(field.items), value], below: `/1${below}`})),
    ]
  }
  if (field.type === 'record') {
    const base = validOf(field)
    return [
      {value: [], below: ''},
      {value: {...base, unknown: 1}, below: '/unknown'},
      ...Object.entries(field.fields).flatMap(([name, item]) => [
        ...invalidOf(item).map(({value, below}) => ({value: {...base, [name]: value}, below: `/${name}${below}`})),
        ...(item.required ? [{value: Object.fromEntries(Object.entries(base).filter(([key]) => key !== name)), below: `/${name}`}] : []),
      ]),
    ]
  }
  return invalid[field.type].map(value => ({value, below: ''}))
}

/** Valid `data` for an item of `kind`: every required field of every rule that applies to it. */
function data(schema, vocabulary, collection, kind) {
  const result = {}
  for (const rule of dataRules) {
    if (
      rule.schema === schema &&
      (!rule.vocabulary || rule.vocabulary === vocabulary) &&
      rule.collection === collection &&
      (!rule.kinds || rule.kinds.includes(kind))
    ) {
      for (const [name, field] of Object.entries(rule.fields)) if (field.required) result[name] = validOf(field)
    }
  }
  if (schema === 'treemap/v0' && collection === 'entities') result.value = 1
  return result
}

/** An extraction in `rule`'s schema, declaring its vocabulary, whose item under test is index 0 of the collection. */
function extraction({schema, vocabulary}, collection, kind, itemData) {
  const endpoint = id => ({id, kind: 'endpoint', label: id, data: data(schema, vocabulary, 'entities', 'endpoint')})
  return {
    protocolVersion: 0,
    schema,
    ...(vocabulary ? {vocabularies: [vocabulary]} : {}),
    ...(collection === 'entities'
      ? {entities: [{id: 'a', kind, label: 'a', data: itemData}], relationships: []}
      : {entities: [endpoint('a'), endpoint('b')], relationships: [{id: 'r', kind, from: 'a', to: 'b', data: itemData}]}),
  }
}

test('every typed data field: valid values pass the engine and the schema; wrong types and missing required fields fail both', async () => {
  let checked = 0
  for (const rule of dataRules) {
    for (const kind of rule.kinds ?? ['anything']) {
      const base = data(rule.schema, rule.vocabulary, rule.collection, kind)
      const label = `${rule.schema} ${rule.vocabulary ?? ''} ${rule.collection} ${kind}`
      assert.equal((await engineVerdict(extraction(rule, rule.collection, kind, base))).ok, true, label)
      assert.equal(schemaVerdict(extraction(rule, rule.collection, kind, base)).ok, true, label)
      for (const [name, field] of Object.entries(rule.fields)) {
        const path = `/extraction/${rule.collection}/0/data/${name}`
        const accepted = extraction(rule, rule.collection, kind, {...base, [name]: validOf(field)})
        assert.equal((await engineVerdict(accepted)).ok, true, `${label} ${name}`)
        assert.equal(schemaVerdict(accepted).ok, true, `${label} ${name}`)
        for (const {value, below} of invalidOf(field)) {
          const rejected = extraction(rule, rule.collection, kind, {...base, [name]: value})
          const verdict = await engineVerdict(rejected)
          assert.equal(verdict.ok, false, `${label} ${name} = ${JSON.stringify(value)}: the engine accepts it`)
          assert.ok(verdict.path.startsWith(`${path}${below}`), `${label} ${name}${below}: ${verdict.path}`)
          assert.equal(schemaVerdict(rejected).ok, false, `${label} ${name} = ${JSON.stringify(value)}: the schema accepts it`)
          checked++
        }
        const {[name]: _, ...without} = base
        const missing = extraction(rule, rule.collection, kind, without)
        const engineRejects = !(await engineVerdict(missing)).ok
        const leaf = rule.schema === 'treemap/v0'
        assert.equal(engineRejects, Boolean(field.required) || leaf, `${label} without ${name}`)
        if (!leaf) assert.equal(schemaVerdict(missing).ok, !field.required, `${label} without ${name}`)
      }
    }
  }
  assert.ok(checked > 60, String(checked))
})

test('vocabularies: unknown, inapplicable and repeated declarations fail both; a declared vocabulary adds its rules', async () => {
  const base = {protocolVersion: 0, schema: 'architecture/v0', entities: [], relationships: []}
  for (const [value, valid] of [
    [{...base, vocabularies: ['dependency-injection/v0', 'runtime-policy/v0']}, true],
    [{...base, vocabularies: []}, true],
    [{...base, vocabularies: ['unknown/v0']}, false],
    [{...base, vocabularies: ['infrastructure/v0', 'infrastructure/v0']}, false],
    [{...base, vocabularies: 'infrastructure/v0'}, false],
    [{...base, schema: 'graph/v0', vocabularies: ['infrastructure/v0']}, false],
  ]) {
    assert.equal((await engineVerdict(value)).ok, valid, JSON.stringify(value))
    assert.equal(schemaVerdict(value).ok, valid, JSON.stringify(value))
  }
  const service = {id: 's', kind: 'service', label: 's', data: {key: 1}}
  for (const vocabularies of [undefined, ['dependency-injection/v0']]) {
    const value = {...base, ...(vocabularies ? {vocabularies} : {}), entities: [service]}
    assert.equal((await engineVerdict(value)).ok, !vocabularies)
    assert.equal(schemaVerdict(value).ok, !vocabularies)
  }
})
