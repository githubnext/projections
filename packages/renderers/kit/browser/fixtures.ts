import type {Entity, Extraction, Relationship} from '@githubnext/projections-schemas'

/**
 * Before/after extraction pairs that exercise staged graph-family motion in a
 * real host frame. The host computes each comparison with the default
 * comparator; nothing here encodes steps or timing.
 */
export interface FixturePair {
  name: string
  /** Definition renderer name the host should resolve. */
  renderer: string
  before: Extraction
  after: Extraction
}

type Schema = Extraction['schema']
const extraction = (schema: Schema, entities: Entity[], relationships: Relationship[]): Extraction => ({
  protocolVersion: 0,
  schema,
  entities,
  relationships,
})
const entity = (id: string, kind = 'package', label = id, data?: Entity['data']): Entity => ({id, kind, label, ...(data ? {data} : {})})
const link = (from: string, to: string, kind = 'dependency'): Relationship => ({id: `${from}->${to}`, kind, from, to})

/** Files that gain a cache and a queue between surviving modules (the prototype's LSIF reflow case). */
export function fileReflow(renderer = 'graph'): FixturePair {
  const file = (name: string) => entity(`file:src/${name}.ts`, 'file', `src/${name}.ts`)
  const reference = (from: string, to: string) => link(`file:src/${from}.ts`, `file:src/${to}.ts`, 'references')
  const persistent = [
    reference('cli', 'api'),
    reference('cli', 'report'),
    reference('worker', 'metrics'),
    reference('report', 'batch'),
    reference('batch', 'scoring'),
    reference('scoring', 'rules'),
  ]
  const before = extraction('graph/v0', ['api', 'batch', 'cli', 'metrics', 'report', 'rules', 'scoring', 'worker'].map(file), [
    ...persistent,
    reference('api', 'scoring'),
    reference('worker', 'batch'),
  ])
  const after = extraction(
    'graph/v0',
    [...before.entities, file('cache'), file('queue')],
    [...persistent, reference('api', 'cache'), reference('cache', 'scoring'), reference('worker', 'queue'), reference('queue', 'batch')],
  )
  return {name: `file reflow (${renderer})`, renderer, before, after}
}

/**
 * Teams over the feature flags they own: identity arrives with passkeys, which payments co-owns. Laid out, each team
 * sits over its flag (straight routes), the rows are level, and passkeys takes its two owners at separate ports.
 */
export function featureFlags(renderer = 'graph'): FixturePair {
  const flag = (name: string, on = false) => entity(`flag:${name}`, 'flag', name, {default: on})
  const team = (name: string) => entity(`team:${name}`, 'team', name)
  const owns = (owner: string, name: string): Relationship => ({
    id: `owns:${owner}:${name}`,
    kind: 'owns',
    from: `team:${owner}`,
    to: `flag:${name}`,
  })
  const before = extraction(
    'graph/v0',
    [flag('checkout-v2'), team('payments'), flag('dark-mode', true), team('design')],
    [owns('payments', 'checkout-v2'), owns('design', 'dark-mode')],
  )
  const after = extraction(
    'graph/v0',
    [...before.entities, flag('passkeys'), team('identity')],
    [...before.relationships, owns('identity', 'passkeys'), owns('payments', 'passkeys')],
  )
  return {name: `feature flags (${renderer})`, renderer, before, after}
}

/** Several layers of removals and additions around a persistent spine, so the comparison has many steps. */
export function layeredWaves(renderer = 'graph'): FixturePair {
  const spine = ['root', 'a', 'b', 'c', 'd']
  const state = (prefix: string, count: number) =>
    extraction(
      'graph/v0',
      [...spine, ...Array.from({length: count}, (_, index) => `${prefix}${index}`)].map(id => entity(id)),
      [
        ...spine.slice(1).map((id, index) => link(spine[index]!, id)),
        ...Array.from({length: count}, (_, index) => link(spine[index % spine.length]!, `${prefix}${index}`)),
      ],
    )
  return {name: `layered waves (${renderer})`, renderer, before: state('old', 4), after: state('new', 6)}
}

/** A pipeline whose test stage is replaced and whose deploy gains a prerequisite. */
export function pipeline(): FixturePair {
  const job = (id: string) => entity(id, 'job')
  const needs = (from: string, to: string) => link(from, to, 'needs')
  const before = extraction('dag/v0', ['checkout', 'build', 'unit', 'lint', 'deploy'].map(job), [
    needs('checkout', 'build'),
    needs('build', 'unit'),
    needs('build', 'lint'),
    needs('unit', 'deploy'),
    needs('lint', 'deploy'),
  ])
  const after = extraction('dag/v0', ['checkout', 'build', 'test', 'lint', 'package', 'deploy'].map(job), [
    needs('checkout', 'build'),
    needs('build', 'test'),
    needs('build', 'lint'),
    needs('test', 'package'),
    needs('lint', 'package'),
    needs('package', 'deploy'),
  ])
  return {name: 'pipeline', renderer: 'dag', before, after}
}

/** A module boundary that gains a worker and a queue (compound reflow). */
export function architectureModules(): FixturePair {
  const resources = ['api', 'bucket', 'database', 'gateway', 'network']
  const entities = [entity('root', 'module', 'platform'), ...resources.map(id => entity(id, 'resource'))]
  const relationships = [
    ...resources.map(id => link('root', id, 'contains')),
    link('api', 'database', 'references'),
    link('api', 'gateway', 'references'),
    link('gateway', 'network', 'references'),
  ]
  const before = extraction('architecture/v0', entities, relationships)
  const after = extraction(
    'architecture/v0',
    [...entities, entity('worker', 'resource'), entity('queue', 'resource')],
    [
      ...relationships,
      link('root', 'worker', 'contains'),
      link('root', 'queue', 'contains'),
      link('worker', 'database', 'references'),
      link('worker', 'queue', 'references'),
    ],
  )
  return {name: 'architecture modules', renderer: 'architecture', before, after}
}

/**
 * Method namespaces as module boundaries, each method requiring a scope. Removals empty three namespaces and take
 * every requirement of one scope, and a method arrives: no namespace may become a card, and no boundary or card may
 * pass through another, while the layout moves.
 */
export function emptiedBoundaries(): FixturePair {
  const methods: [method: string, space: string, scope: string, change?: 'removed' | 'added'][] = [
    ['open', 'accounts', 'write', 'removed'],
    ['close', 'billing', 'read', 'removed'],
    ['charge', 'billing', 'write'],
    ['list', 'catalog', 'audit'],
    ['price', 'catalog', 'read', 'removed'],
    ['stock', 'catalog', 'operate'],
    ['ship', 'delivery', 'admin'],
    ['track', 'delivery', 'admin', 'removed'],
    ['route', 'delivery', 'write'],
    ['emit', 'events', 'audit', 'removed'],
    ['upload', 'files', 'operate', 'removed'],
    ['proxy', 'gateway', 'audit', 'added'],
    ['retry', 'gateway', 'audit', 'removed'],
    ['forward', 'gateway', 'write'],
  ]
  const scopes = ['read', 'write', 'admin', 'audit', 'operate']
  const side = (skip: 'removed' | 'added') => {
    const kept = methods.filter(([, , , change]) => change !== skip)
    return extraction(
      'architecture/v0',
      [
        ...scopes.map(scope => entity(`scope:${scope}`, 'scope', scope)),
        ...[...new Set(methods.map(([, space]) => space))].map(space => entity(`ns:${space}`, 'module', space)),
        ...kept.map(([method, space]) => entity(`${space}.${method}`, 'method', method)),
      ],
      kept.flatMap(([method, space, scope]) => [
        link(`ns:${space}`, `${space}.${method}`, 'contains'),
        link(`${space}.${method}`, `scope:${scope}`, 'requires'),
      ]),
    )
  }
  return {name: 'emptied boundaries', renderer: 'architecture', before: side('added'), after: side('removed')}
}

/**
 * Units with facts in `data` (capabilities, a scope) and relationships of three kinds: one unit gains a capability and
 * a `sessionScoped` flag, and one arrives.
 */
export function capabilityUnits(): FixturePair {
  const unit = (id: string, capabilities: string[], scope: string, extra: Record<string, boolean> = {}) =>
    entity(`unit:${id}`, 'unit', id, {capabilities, scope, ...extra})
  const units = [
    entity('app', 'module', 'app'),
    unit('server', ['network', 'filesystem'], 'public'),
    unit('store', ['filesystem'], 'internal'),
    unit('worker', ['process'], 'internal'),
  ]
  const relationships = [
    link('app', 'unit:server', 'contains'),
    link('app', 'unit:store', 'contains'),
    link('app', 'unit:worker', 'contains'),
    link('unit:server', 'unit:store', 'calls'),
    link('unit:server', 'unit:worker', 'spawns'),
    link('unit:worker', 'unit:store', 'reads'),
  ]
  const before = extraction('architecture/v0', units, relationships)
  const after = extraction(
    'architecture/v0',
    [
      ...units.slice(0, 3),
      unit('worker', ['process', 'network'], 'internal', {sessionScoped: true}),
      unit('cache', ['memory'], 'internal'),
    ],
    [...relationships, link('app', 'unit:cache', 'contains'), link('unit:store', 'unit:cache', 'reads')],
  )
  return {name: 'capability units', renderer: 'architecture', before, after}
}

/** Weighted files: one grows, one leaves, one arrives. */
export function weightedFiles(): FixturePair {
  const leaf = (id: string, value: number) => entity(id, 'file', id, {value})
  const contains = (from: string, to: string) => link(from, to, 'contains')
  const before = extraction(
    'treemap/v0',
    [entity('root', 'directory'), entity('lib', 'directory'), leaf('a', 30), leaf('b', 10), leaf('old', 20), leaf('c', 15)],
    [contains('root', 'lib'), contains('root', 'a'), contains('lib', 'b'), contains('lib', 'old'), contains('lib', 'c')],
  )
  const after = extraction(
    'treemap/v0',
    [entity('root', 'directory'), entity('lib', 'directory'), leaf('a', 30), leaf('b', 35), leaf('new', 20), leaf('c', 15)],
    [contains('root', 'lib'), contains('root', 'a'), contains('lib', 'b'), contains('lib', 'new'), contains('lib', 'c')],
  )
  return {name: 'weighted files', renderer: 'file-packing', before, after}
}

export const graphFamilyFixtures = (): FixturePair[] => [
  fileReflow('graph'),
  fileReflow('graph-horizontal'),
  layeredWaves('graph'),
  featureFlags(),
  pipeline(),
  architectureModules(),
  weightedFiles(),
]
