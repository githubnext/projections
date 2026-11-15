const node = (id = 'n', data = {}, kind = 'entity') => ({id, kind, label: id, data})
const state = (schema = 'graph/v0', entities = [], relationships = []) => ({protocolVersion: 0, schema, entities, relationships})
const edge = (id = 'e', from = 'a', to = 'b') => ({id, kind: 'relationship', from, to})
const normalize = (id, value, code, path) => ({
  id,
  request: {version: 0, operation: 'normalize', extraction: value},
  ...(code ? {expectError: true, expectedErrorCode: code, ...(path ? {expectedErrorPath: path} : {})} : {}),
})

export const engineCases = [
  ...['graph/v0', 'dag/v0', 'architecture/v0'].map(schema => normalize(`valid-${schema}`, state(schema, [node('a'), node('b')], [edge()]))),
  normalize('valid-weighted-forest', state('treemap/v0', [node('a', {value: 100}), node('b', {value: 2})], [edge()])),
  normalize('valid-metric', state('metrics/v0', [node('m', {value: -0.5, unit: ''})])),
  normalize('valid-api', state('api/v0', [node('f', {signature: '(a: string) => void'}, 'function')])),
  normalize('valid-database-schema', state('database/v0', [node('c', {type: 'text', nullable: false}, 'column')])),
  normalize('graph-directed-cycle', state('graph/v0', [node('a'), node('b')], [edge(), edge('back', 'b', 'a')])),
  normalize('architecture-directed-cycle', state('architecture/v0', [node('a'), node('b')], [edge(), edge('back', 'b', 'a')])),
  ...['dag/v0', 'treemap/v0'].map(schema =>
    normalize(
      `cycle-${schema}`,
      state(schema, [node('a'), node('b')], [edge(), edge('back', 'b', 'a')]),
      'cycle',
      '/extraction/relationships',
    ),
  ),
  normalize('self-cycle', state('dag/v0', [node('a')], [edge('self', 'a', 'a')]), 'cycle'),
  normalize(
    'forest-multiple-parent',
    state('treemap/v0', [node('a', {value: 1}), node('b', {value: 1})], [edge(), edge('parallel')]),
    'multiple-parents',
  ),
  normalize('dag-parallel-relationships', state('dag/v0', [node('a'), node('b')], [edge(), edge('parallel')])),
  normalize('treemap-leaf-needs-weight', state('treemap/v0', [node()]), 'invalid-domain-value'),
  normalize('treemap-negative-weight', state('treemap/v0', [node('n', {value: -1})]), 'invalid-domain-value'),
  normalize('metrics-nonnumeric', state('metrics/v0', [node('m', {value: '1'})]), 'invalid-domain-value'),
  normalize('metrics-unit-type', state('metrics/v0', [node('m', {value: 1, unit: 1})]), 'invalid-type'),
  ...['export', 'type', 'member', 'function', 'class', 'interface', 'method', 'property', 'enum'].map(kind =>
    normalize(`api-${kind}-signature-required`, state('api/v0', [node('a', {}, kind)]), 'invalid-type'),
  ),
  normalize('api-module-no-signature', state('api/v0', [node('a', {}, 'module')])),
  normalize('column-type-required', state('database/v0', [node('a', {}, 'column')]), 'invalid-type'),
  normalize('column-nullable-type', state('database/v0', [node('a', {type: 'text', nullable: 1}, 'column')]), 'invalid-domain-value'),
  normalize(
    'cross-collection-duplicate-id',
    state('graph/v0', [node('a')], [edge('a', 'a', 'a')]),
    'duplicate-id',
    '/extraction/relationships/0/id',
  ),
  normalize(
    'shared-previous-id-declares-split',
    state('graph/v0', [
      {...node('a'), previousIds: ['historic']},
      {...node('b'), previousIds: ['historic']},
    ]),
  ),
  normalize(
    'cross-collection-historical-identity',
    state('graph/v0', [{...node('a'), previousIds: ['historic']}, node('b')], [{...edge(), previousIds: ['historic']}]),
    'ambiguous-identity',
    '/extraction/relationships/0/previousIds/0',
  ),
  normalize(
    'previous-id-path-retains-input-order',
    state('graph/v0', [{...node('a'), previousIds: ['z', 'a']}]),
    'ambiguous-identity',
    '/extraction/entities/0/previousIds/1',
  ),
  normalize('unknown-entity-field', state('graph/v0', [{...node(), surprise: true}]), 'unknown-field', '/extraction/entities/0/surprise'),
  normalize('version-1-field-names', {protocolVersion: 0, schema: 'graph/v0', nodes: []}, 'unknown-field', '/extraction/nodes'),
  normalize(
    'unknown-evidence-field',
    state('graph/v0', [
      {
        ...node(),
        evidence: [{kind: 'source', source: 'a.ts', surprise: true}],
      },
    ]),
    'unknown-field',
  ),
  normalize(
    'evidence-location-positive-integer',
    state('graph/v0', [
      {
        ...node(),
        evidence: [{kind: 'source', source: 'a.ts', location: {line: 0}}],
      },
    ]),
    'invalid-location',
  ),
  normalize('confidence-enum', state('graph/v0', [{...node(), confidence: 'certain'}]), 'invalid-confidence'),
  normalize('null-data-not-omitted', state('graph/v0', [{...node(), data: null}]), 'invalid-type'),
  normalize('null-evidence-not-omitted', state('graph/v0', [{...node(), evidence: null}]), 'invalid-type'),
  normalize('unsupported-domain-not-graph', state('other/v0'), 'unsupported-schema'),
  normalize('unsupported-version-1', {...state(), protocolVersion: 1}, 'unsupported-version'),
  normalize('unsupported-version-3', {...state(), protocolVersion: 3}, 'unsupported-version'),
  {
    id: 'validate-comparison-hidden-relationship-change',
    request: {
      version: 0,
      operation: 'validate-comparison',
      before: state('graph/v0', [node('a'), node('b')], [edge()]),
      after: state('graph/v0', [node('a'), node('b')], [{...edge(), label: 'changed'}]),
      comparison: {protocolVersion: 0, changes: [], steps: []},
    },
    expectError: true,
    expectedErrorCode: 'hidden-change',
  },
  ...[
    ['strict-envelope-duplicate', '{"provenance":{"revision":"one","revision":"two"}}', 'duplicate-key'],
    ['strict-envelope-unsafe', '{"repositoryId":9007199254740993}', 'unsafe-integer'],
    ['strict-envelope-nonfinite', '{"value":1e400}', 'invalid-json'],
    ['strict-envelope-invalid-unicode', '{"name":"\\ud800"}', 'invalid-json'],
    ['strict-envelope-trailing', '{}{}', 'invalid-json'],
  ].map(([id, json, code]) => ({
    id,
    request: {version: 0, operation: 'parse-json', json},
    expectError: true,
    expectedErrorCode: code,
  })),
]

/** Default comparator vectors, run through native and browser Wasm hosts. */
export const comparatorCases = [
  {
    id: 'cross-schema-comparison',
    before: state(),
    after: state('dag/v0'),
    expectedErrorCode: 'comparator-error',
    expectedMessage: /schema-mismatch/,
  },
  {
    id: 'modified-rename-relationship-endpoint-equality',
    before: state('graph/v0', [node('a'), node('stable')], [edge('e', 'a', 'stable')]),
    after: state(
      'graph/v0',
      [{...node('b', {value: 1}), previousIds: ['a']}, node('stable')],
      [{...edge('f', 'b', 'stable'), previousIds: ['e']}],
    ),
    expectedChanges: [
      {id: 'b', collection: 'entities', before: ['a'], after: ['b'], status: 'modified', correspondence: 'declared'},
      {id: 'f', collection: 'relationships', before: ['e'], after: ['f'], status: 'unchanged', correspondence: 'declared'},
    ],
  },
  {
    id: 'reverse-modified-rename',
    before: state('graph/v0', [{...node('b', {value: 1}), previousIds: ['a']}]),
    after: state('graph/v0', [node('a')]),
    expectedChanges: [{id: 'a', collection: 'entities', before: ['b'], after: ['a'], status: 'modified', correspondence: 'declared'}],
  },
  {
    id: 'explicit-merge',
    before: state('graph/v0', [node('a'), node('b')]),
    after: state('graph/v0', [{...node('c'), previousIds: ['a', 'b']}]),
    expectedChanges: [{id: 'c', collection: 'entities', before: ['a', 'b'], after: ['c'], status: 'modified', correspondence: 'merge'}],
  },
  {
    id: 'ambiguous-many-to-many',
    before: state('graph/v0', [node('a'), node('b')]),
    after: state('graph/v0', [
      {...node('c'), previousIds: ['a', 'b']},
      {...node('d'), previousIds: ['b']},
    ]),
    expectedErrorCode: 'comparator-error',
    expectedMessage: /ambiguous-correspondence/,
  },
  {
    id: 'invalid-options',
    before: state(),
    after: state(),
    options: {order: {by: 'size'}},
    expectedErrorCode: 'comparator-error',
    expectedMessage: /invalid-options/,
  },
]
