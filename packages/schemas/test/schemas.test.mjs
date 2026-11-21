import assert from 'node:assert/strict'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {test} from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import {schemaUrl} from '../dist/index.js'

// Extractor argv intentionally has an executable prefix and an open argument tail.
const ajv = new Ajv2020({allErrors: true, strictTuples: false})
const directory = new URL('../schemas/', import.meta.url)
const names = readdirSync(directory, {recursive: true})
  .map(path => path.split('\\').join('/'))
  .filter(path => path.endsWith('/v0.json'))
  .map(path => path.slice(0, -'/v0.json'.length))
for (const name of names) ajv.addSchema(JSON.parse(readFileSync(new URL(`${name}/v0.json`, directory), 'utf8')))
const id = name => schemaUrl(name)
const validate = (name, value) => ajv.getSchema(id(name))(value)
const extraction = {protocolVersion: 0, schema: 'graph/v0', entities: [], relationships: []}
const definition = {id: 'services', renderer: 'graph', extractor: {command: ['python3', 'extract.py']}}
const revision = {kind: 'commit', ref: 'a'.repeat(40), commit: 'a'.repeat(40), dirty: false}
const document = {
  format: 'projections.extraction',
  version: 0,
  projection: {id: 'services', title: 'Services', renderer: 'graph'},
  extraction,
  digest: 'a'.repeat(64),
  provenance: {
    revision,
    extractor: {id: 'executable', version: '1'},
    definition,
    definitionDigest: `sha256:${'d'.repeat(64)}`,
    reproducibility: 'local',
    limitations: [],
  },
}
const change = {id: 'a', collection: 'entities', before: [], after: ['a'], status: 'added', correspondence: 'none'}
const comparison = {protocolVersion: 0, changes: [change], steps: [{changes: ['a'], kind: 'add'}], order: {reverse: 'mirror'}}

test('every published schema is draft 2020-12 at its URL, compiles strictly and refers only to published schemas', () => {
  assert.deepEqual(names.sort(), [
    'api',
    'architecture',
    'artifact',
    'comparator',
    'comparator-tests',
    'comparison',
    'comparison-document',
    'dag',
    'database',
    'definition',
    'environment',
    'extraction',
    'extraction-document',
    'extractor-request',
    'graph',
    'metrics',
    'scenarios',
    'treemap',
    'vocabularies/agentic-workflows',
    'vocabularies/dependency-injection',
    'vocabularies/infrastructure',
    'vocabularies/runtime-policy',
    'vocabularies/scenarios',
  ])
  // Unknown keywords and formats are errors; artifact verification also enforces strict types.
  const strict = new Ajv2020({strict: true, strictTuples: false, strictTypes: false, strictRequired: false})
  for (const name of names) strict.addSchema(JSON.parse(readFileSync(new URL(`${name}/v0.json`, directory), 'utf8')))
  new Ajv2020({strict: true, strictTuples: false}).compile(JSON.parse(readFileSync(new URL('artifact/v0.json', directory), 'utf8')))
  for (const name of names) {
    const schema = strict.getSchema(id(name)).schema
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
    assert.equal(schema.$id, id(name))
    for (const reference of JSON.stringify(schema).matchAll(/"\$ref":"([^"#]*)/g)) {
      if (reference[1])
        assert.ok(
          names.some(other => id(other) === reference[1]),
          reference[1],
        )
    }
  }
})

test('each domain schema is the envelope with its typed data, and the envelope applies it by name', () => {
  const column = {id: 'c', kind: 'column', label: 'c', data: {type: 'text', databaseType: null, nullable: true}}
  const database = {protocolVersion: 0, schema: 'database/v0', entities: [column], relationships: []}
  assert.equal(validate('database', database), true)
  assert.equal(validate('extraction', database), true)
  for (const invalid of [
    {...column, data: {}},
    {...column, data: {type: 'text', databaseType: 1}},
    {...column, data: {type: ' '}},
  ]) {
    assert.equal(validate('database', {...database, entities: [invalid]}), false, JSON.stringify(invalid))
    assert.equal(validate('extraction', {...database, entities: [invalid]}), false, JSON.stringify(invalid))
  }
  // Typed fields belong to their schema and kind; other data stays open.
  assert.equal(validate('extraction', {...database, schema: 'graph/v0', entities: [{...column, data: {type: 1}}]}), true)
  assert.equal(validate('extraction', {...database, entities: [{...column, kind: 'table', data: {type: 1}}]}), true)
  assert.equal(validate('database', {...database, entities: [{...column, data: {...column.data, extra: {any: [1]}}}]}), true)
  assert.equal(validate('database', {...database, schema: 'graph/v0'}), false)
  const metric = {
    protocolVersion: 0,
    schema: 'metrics/v0',
    entities: [{id: 'm', kind: 'file', label: 'm', data: {value: 1}}],
    relationships: [],
  }
  assert.equal(validate('metrics', metric), true)
  assert.equal(validate('extraction', {...metric, entities: [{id: 'm', kind: 'file', label: 'm'}]}), false)
})

test('extraction text is nonblank as the engine requires, and labels follow the engine', () => {
  const entity = {id: 'a', kind: 'service', label: 'A'}
  const with_ = entities => ({...extraction, entities})
  assert.equal(validate('extraction', with_([entity])), true)
  assert.equal(validate('extraction', with_([{...entity, label: ''}])), true)
  assert.equal(validate('extraction', with_([{id: 'a', kind: 'service'}])), false)
  for (const blank of ['', ' ', '\t\n']) {
    assert.equal(validate('extraction', with_([{...entity, id: blank}])), false, JSON.stringify(blank))
    assert.equal(validate('extraction', with_([{...entity, kind: blank}])), false, JSON.stringify(blank))
  }
  const relationship = {id: 'r', kind: 'calls', from: 'a', to: 'a'}
  assert.equal(validate('extraction', {...with_([entity]), relationships: [relationship]}), true)
  assert.equal(validate('extraction', {...with_([entity]), relationships: [{...relationship, label: ''}]}), true)
  assert.equal(validate('extraction', {...with_([entity]), relationships: [{...relationship, from: ' '}]}), false)
})

test('public schemas accept extractions, any-language extractors, component definitions and saved documents', () => {
  assert.equal(validate('extraction', extraction), true)
  assert.equal(validate('extraction', {...extraction, schema: 'database/v0'}), true)
  assert.equal(validate('definition', definition), true)
  assert.equal(validate('definition', {...definition, extractor: {command: ['python3', '']}}), true)
  assert.equal(validate('definition', {...definition, extractor: {command: ['', 'extract.py']}}), false)
  assert.equal(validate('definition', {...definition, extractor: 'third-party-installed-extractor'}), true)
  assert.equal(
    validate('definition', {
      ...definition,
      extractor: {command: ['python3', 'tools/x.py'], sources: ['tools/x.py']},
      comparator: {options: {order: {by: 'data.size', direction: 'ascending'}}},
      renderer: {bundle: 'renderers/flags/dist', sources: ['renderers/flags/dist']},
    }),
    true,
  )
  assert.equal(validate('definition', {...definition, comparator: {}}), true)
  assert.equal(
    validate('definition', {
      ...definition,
      comparator: {file: 'tools/compare.comparator.yaml', sources: ['tools/lib.yaml'], options: {any: [1]}},
    }),
    true,
  )
  assert.equal(validate('definition', {...definition, comparator: 'tools/compare.comparator.yml'}), true)
  assert.equal(validate('extraction-document', document), true)
  assert.equal(
    validate('extractor-request', {
      protocolVersion: 0,
      projection: {id: definition.id, definition},
      repository: {mode: 'materialized', root: '/temporary/revision', revision},
      capabilities: {trusted: false, network: false},
    }),
    true,
  )
  assert.equal(
    validate('extractor-request', {
      protocolVersion: 0,
      projection: {id: definition.id, definition},
      repository: {mode: 'git-objects', git: {directory: '/repository/.git', tree: 'a'.repeat(40)}, revision, scope: ['src']},
      capabilities: {trusted: false, network: false},
    }),
    true,
  )
  // The definition's project: empty for the root, else a plain repository-relative directory.
  for (const [project, valid] of [
    ['', true],
    ['packages/app', true],
    ['.github', true],
    ['..', false],
    ['../app', false],
    ['packages/app/', false],
    ['/packages', false],
    ['./app', false],
  ])
    assert.equal(
      validate('extractor-request', {
        protocolVersion: 0,
        projection: {id: definition.id, definition},
        repository: {mode: 'in-place', root: '/checkout', project, revision},
        capabilities: {trusted: false, network: false},
      }),
      valid,
      project,
    )
  assert.equal(
    validate('extraction-document', {
      ...document,
      provenance: {...document.provenance, execution: {source: 'local-in-place', fidelity: 'stale', tree: 'b'.repeat(40)}},
    }),
    true,
  )
  assert.equal(
    validate('extraction-document', {...document, provenance: {...document.provenance, execution: {source: 'remote', fidelity: 'exact'}}}),
    false,
  )
  assert.equal(validate('comparison', comparison), true)
  assert.equal(
    validate('comparison-document', {
      format: 'projections.comparison',
      version: 0,
      before: document,
      after: document,
      comparison,
      comparator: {id: 'default', digest: `sha256:${'c'.repeat(64)}`},
    }),
    true,
  )
  for (const [notices, valid] of [
    [[], true],
    [['The head revision changes the definition of projection services.'], true],
    [[''], false],
    ['note', false],
    [[1], false],
    [Array.from({length: 21}, () => 'note'), false],
  ]) {
    assert.equal(
      validate('comparison-document', {
        format: 'projections.comparison',
        version: 0,
        before: document,
        after: document,
        comparison,
        comparator: {id: 'default', digest: `sha256:${'c'.repeat(64)}`},
        notices,
      }),
      valid,
      JSON.stringify(notices),
    )
  }
})

test('version 1 shapes, unknown fields, numeric bounds, dirty commits and secret-shaped provenance are rejected', () => {
  for (const invalid of [
    {...extraction, protocolVersion: 1},
    {...extraction, extra: true},
    {protocolVersion: 0, schema: 'graph/v0', nodes: [], edges: []},
    {...extraction, schema: 'schema/v0'},
    {...extraction, metadata: {value: Infinity}},
    {...extraction, metadata: {value: 9007199254740992}},
  ]) {
    assert.equal(validate('extraction', invalid), false)
  }
  assert.equal(
    validate('extraction-document', {...document, provenance: {...document.provenance, environment: {TOKEN: 'not-allowed'}}}),
    false,
  )
  assert.equal(
    validate('extraction-document', {...document, provenance: {...document.provenance, revision: {...revision, dirty: true}}}),
    false,
  )
  assert.equal(validate('extraction-document', {...document, format: 'projections.snapshot', version: 1}), false)
  assert.equal(
    validate('extraction-document', {...document, provenance: {...document.provenance, definitionDigest: 'd'.repeat(64)}}),
    false,
  )
  assert.equal(validate('definition', {...definition, extractor: {command: ['python3', '\0']}}), false)
  assert.equal(validate('definition', {id: 'services', renderer: 'graph', collector: 'parser'}), false)
  for (const comparator of [
    {options: {order: {by: 'size'}}},
    {options: {order: {by: 'dependents', direction: 'up'}}},
    {options: {extra: true}},
    // Comparator files are the only custom comparators.
    {module: 'tools/compare.wasm'},
    {module: 'tools/compare.js'},
    // `rules` was renamed to `file`.
    {rules: 'x.comparator.yaml'},
    {file: 'a/../outside.comparator.yaml'},
    {file: 'x.json'},
    {file: 'x.rules.yaml'},
    {file: 'x.yaml'},
    {file: 'x.comparator.yaml', url: 'https://example.com'},
    {file: 'x.comparator.yaml', options: {order: {by: 'dependents'}}, extra: 1},
    'x.yaml',
    './x.comparator.yaml',
    'default',
  ])
    assert.equal(validate('definition', {...definition, comparator}), false, JSON.stringify(comparator))
  for (const sources of [['/absolute'], ['a/../b'], ['a', 'a'], ['a//b'], ['C:\\x'], ['../'], ['./a']]) {
    assert.equal(validate('definition', {...definition, extractor: {command: ['x'], sources}}), false, sources.join())
  }
  // Paths are relative to the definition's project: leading `..` segments leave a nested one.
  for (const sources of [['../shared'], ['../../a/b.mjs'], ['..']])
    assert.equal(validate('definition', {...definition, extractor: {command: ['x'], sources}}), true, sources.join())
  assert.equal(validate('definition', {...definition, comparator: '../x.comparator.yaml'}), true)
})

test('comparison schema bounds shapes structurally without replacing engine validation', () => {
  for (const [field, value] of [
    ['status', 'renamed'],
    ['correspondence', 'fuzzy'],
    ['collection', 'nodes'],
  ])
    assert.equal(validate('comparison', {...comparison, changes: [{...change, [field]: value}]}), false, field)
  for (const invalid of [
    {...change, before: ['x']},
    {...change, status: 'removed'},
    {...change, correspondence: 'declared'},
    {...change, status: 'modified', correspondence: 'split', before: ['x'], after: ['a']},
    {...change, status: 'modified', correspondence: 'merge', before: ['x'], after: ['a']},
    {...change, position: {x: 1}},
  ])
    assert.equal(validate('comparison', {...comparison, changes: [invalid]}), false, JSON.stringify(invalid))
  assert.equal(
    validate('comparison', {
      ...comparison,
      changes: [{...change, status: 'modified', correspondence: 'split', before: ['x'], after: ['a', 'b']}],
    }),
    true,
  )
  assert.equal(validate('comparison', {...comparison, steps: [{changes: []}]}), false)
  assert.equal(validate('comparison', {...comparison, steps: [{changes: ['a'], time: 0.5}]}), false)
  assert.equal(validate('comparison', {...comparison, order: {reverse: 'explicit'}}), false)
  assert.equal(validate('comparison', {...comparison, order: {reverse: 'explicit'}, reverseSteps: [{changes: ['a']}]}), true)
  assert.equal(validate('comparison', {...comparison, reverseSteps: [{changes: ['a']}]}), false)
  assert.equal(validate('comparison', {...comparison, protocolVersion: 1}), false)
  assert.equal(
    validate('comparison-document', {format: 'projections.comparison', version: 0, before: document, after: document, comparison}),
    false,
  )
})

test('scenarios schema accepts inline, path, single-extraction, custom-comparator and bundle-renderer scenarios', () => {
  const scenarios = (...items) => ({format: 'projections.scenarios', version: 0, title: 'Graph', renderer: 'graph', scenarios: items})
  for (const valid of [
    scenarios({id: 'inline', title: 'Inline', description: 'Both sides inline.', before: extraction, after: extraction}),
    scenarios({
      id: 'paths',
      title: 'Paths',
      group: 'Files',
      before: 'fixtures/a.json',
      after: '../shared/b.json',
      comparator: {options: {order: {by: 'dependents'}}},
      presentation: {highlighting: 'animated', durationMs: 6000, rendererOptions: {layout: 'horizontal'}},
    }),
    scenarios({id: 'single.v1', title: 'Single', extraction: 'fixtures/a.json'}, {id: 'single_2', title: 'Inline single', extraction}),
    scenarios(
      {
        id: 'custom',
        title: 'Custom',
        before: extraction,
        after: extraction,
        comparator: {file: '../../comparators/x.comparator.yaml', options: {priority: ['a']}},
      },
      {id: 'file', title: 'File', before: extraction, after: extraction, comparator: 'x.comparator.yml'},
      {id: 'default', title: 'Default', before: extraction, after: extraction, comparator: {}},
    ),
    {
      format: 'projections.scenarios',
      version: 0,
      scenarios: [
        {id: 'bundle', title: 'Bundle', renderer: {bundle: 'dist'}, extraction},
        {id: 'named', title: 'Named', renderer: 'graph-horizontal', extraction},
      ],
    },
    scenarios(),
  ])
    assert.equal(validate('scenarios', valid), true, JSON.stringify(ajv.getSchema(id('scenarios')).errors))
})

test('scenarios schema rejects unknown fields, mixed forms, misplaced comparators and invalid identifiers or paths', () => {
  const base = {id: 'a', title: 'A', extraction}
  const document = scenario => ({format: 'projections.scenarios', version: 0, renderer: 'graph', scenarios: [scenario]})
  for (const invalid of [
    {...base, extra: true},
    {...base, before: extraction},
    {...base, before: extraction, after: extraction},
    {...base, comparator: {}},
    {id: 'a', title: 'A', before: extraction},
    {id: 'a', title: 'A'},
    {id: 'a', extraction},
    {...base, title: ''},
    {...base, id: '-a'},
    {...base, id: 'a/b'},
    {...base, id: ''},
    {...base, id: 'a'.repeat(101)},
    {...base, extraction: '/absolute.json'},
    {...base, extraction: 'https://example.com/a.json'},
    {...base, extraction: 'C:\\a.json'},
    {...base, extraction: 'a\0.json'},
    {...base, extraction: ''},
    {...base, extraction: {...extraction, extra: true}},
    {id: 'a', title: 'A', before: extraction, after: extraction, comparator: {module: 'x.wasm'}},
    {id: 'a', title: 'A', before: extraction, after: extraction, comparator: {file: 'x.js'}},
    {id: 'a', title: 'A', before: extraction, after: extraction, comparator: {rules: 'x.comparator.yaml'}},
    {id: 'a', title: 'A', before: extraction, after: extraction, comparator: 'x.yaml'},
    {id: 'a', title: 'A', before: extraction, after: extraction, comparator: {file: 'x.comparator.yaml', sources: ['x.yaml']}},
    {id: 'a', title: 'A', before: extraction, after: extraction, comparator: {options: {order: {by: 'size'}}}},
    {...base, renderer: {bundle: 'dist', sources: ['dist']}},
    {...base, renderer: 'not a renderer'},
    {...base, presentation: {mode: 'zoom'}},
    {...base, group: ''},
    {...base, description: 'x'.repeat(4097)},
  ])
    assert.equal(validate('scenarios', document(invalid)), false, JSON.stringify(invalid))
  assert.equal(validate('scenarios', {format: 'projections.scenarios', version: 0, scenarios: [base]}), false, 'no renderer')
  assert.equal(validate('scenarios', {...document(base), version: 1}), false)
  assert.equal(validate('scenarios', {...document(base), extra: true}), false)
  assert.equal(
    validate('scenarios', {...document(base), scenarios: Array.from({length: 1001}, (_, index) => ({...base, id: `s${index}`}))}),
    false,
  )
})

// DollarLint (.dollarlint.toml) validates each scenarios.json and the extractions it references against the schemas;
// this checks what a schema can't: unique IDs, and references that resolve to files.
test('every renderer package scenarios file has unique scenario IDs and references files that exist', () => {
  const renderers = new URL('../../renderers/', import.meta.url)
  const packages = readdirSync(renderers)
    .filter(name => existsSync(new URL(`${name}/scenarios.json`, renderers)))
    .sort()
  assert.ok(packages.length >= 7, packages.join())
  for (const name of packages) {
    const file = new URL(`${name}/scenarios.json`, renderers)
    const document = JSON.parse(readFileSync(file, 'utf8'))
    const ids = document.scenarios.map(scenario => scenario.id)
    assert.equal(new Set(ids).size, ids.length, `${name}: duplicate scenario IDs`)
    for (const scenario of document.scenarios) {
      for (const side of ['before', 'after', 'extraction']) {
        if (typeof scenario[side] === 'string')
          assert.ok(existsSync(new URL(scenario[side], file)), `${name}/${scenario.id}: ${scenario[side]}`)
      }
    }
  }
})

test('artifact manifest binds one run to a PR or push and records every document or failure', () => {
  const sha = 'a'.repeat(40)
  const manifest = {
    format: 'projections.artifact',
    version: 0,
    protocolVersion: 0,
    producer: {cli: 'projections 0.0.0', action: 'githubnext/projections@v0'},
    repository: {provider: 'github', id: 1, owner: 'octo-org', name: 'delivery'},
    run: {id: 10, attempt: 1},
    subject: {kind: 'pull-request', number: 5, base: sha, head: 'b'.repeat(40), mergeBase: sha, definition: 'base'},
    trust: false,
    projections: [
      {id: 'services', status: 'changed', path: 'projections/services.json', sha256: 'c'.repeat(64)},
      {id: 'flags', status: 'error', diagnostics: [{severity: 'error', code: 'TRUST_REQUIRED', path: '', message: 'Pass --trust'}]},
    ],
  }
  assert.equal(validate('artifact', manifest), true)
  assert.equal(validate('artifact', {...manifest, subject: {kind: 'push', ref: 'refs/heads/main', revision: sha}}), true)
  assert.equal(validate('artifact', {...manifest, projections: []}), true)
  for (const invalid of [
    {...manifest, version: 1},
    {...manifest, subject: {...manifest.subject, head: 'main'}},
    {...manifest, subject: {kind: 'push', ref: 'main', revision: sha}},
    {...manifest, projections: [{...manifest.projections[0], path: '../escape.json'}]},
    {...manifest, projections: [{...manifest.projections[0], path: 'projections/a/b.json'}]},
    {...manifest, projections: [{...manifest.projections[0], status: 'error'}]},
    {...manifest, projections: [{id: 'flags', status: 'error', diagnostics: []}]},
    {...manifest, repository: {...manifest.repository, id: 0}},
    {...manifest, extra: true},
  ])
    assert.equal(validate('artifact', invalid), false, JSON.stringify(invalid))
})

test('the environment schema accepts prepare steps, a toolchain and a strategy, and rejects unsafe or unknown ones', () => {
  const valid = {
    format: 'projections.environment',
    version: 0,
    prepare: [
      {
        id: 'install',
        run: ['npm', 'ci'],
        key: ['package-lock.json', '**/package.json'],
        directory: 'web',
        environment: ['NPM_TOKEN'],
        timeoutMs: 600000,
      },
    ],
    toolchain: [['node', '--version']],
    workspace: {strategy: 'worktree'},
    devcontainer: '.devcontainer/devcontainer.json',
  }
  assert.equal(validate('environment', valid), true)
  assert.equal(validate('environment', {format: 'projections.environment', version: 0}), true)
  const step = valid.prepare[0]
  for (const invalid of [
    {...valid, version: 1},
    {...valid, extra: true},
    {...valid, prepare: [{...step, run: []}]},
    {...valid, prepare: [{...step, key: []}]},
    {...valid, prepare: [{...step, key: ['../outside']}]},
    {...valid, prepare: [{...step, directory: '/abs'}]},
    {...valid, prepare: [{...step, timeoutMs: 0}]},
    {...valid, prepare: [{...step, shell: 'npm ci'}]},
    {...valid, workspace: {strategy: 'magic'}},
  ])
    assert.equal(validate('environment', invalid), false, JSON.stringify(invalid))
})
