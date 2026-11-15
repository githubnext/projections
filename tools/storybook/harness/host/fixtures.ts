import type {DomainSchema, Entity, Extraction, Relationship} from '@githubnext/projections-schemas'

// Synthetic extractions; the demo host compares them with the default Wasm comparator.
export function demonstration(schema: DomainSchema, presentation?: string) {
  if (presentation === 'code-statistics') return statisticsDemonstration()
  const model = schema.split('/')[0]
  const common = {
    confidence: 'derived' as const,
    evidence: [{kind: 'source', source: 'src/checkout.ts', location: {line: 12}}],
  }
  const a: Entity = {id: 'checkout', kind: 'service', label: 'Checkout', ...common}
  const b: Entity = {id: 'legacy', kind: 'service', label: 'Legacy inventory', ...common}
  const c: Entity = {id: 'inventory', kind: 'service', label: 'Inventory worker', ...common}
  const d: Entity = {id: 'payments', kind: 'service', label: 'Payments', ...common}
  if (model === 'treemap') {
    a.kind = 'directory'
    a.label = 'Application'
    b.kind = c.kind = d.kind = 'file'
    b.data = {value: 35}
    c.data = {value: 60}
    d.data = {value: 40}
  }
  if (model === 'metrics') {
    a.kind = b.kind = c.kind = d.kind = 'metric'
    a.label = 'Checkout latency'
    a.data = {value: 240, unit: 'ms'}
    b.label = 'Legacy requests'
    b.data = {value: 12, unit: 'req/s'}
    c.label = 'Worker throughput'
    c.data = {value: 60, unit: 'jobs/s'}
    d.label = 'Error budget'
    d.data = {value: -4, unit: '%'}
  }
  if (model === 'api') {
    a.kind = b.kind = c.kind = d.kind = 'function'
    a.label = 'checkout'
    a.data = {signature: 'checkout(cart: Cart): Receipt'}
    b.label = 'reserveLegacy'
    b.data = {signature: 'reserveLegacy(sku: string): void'}
    c.label = 'reserve'
    c.data = {signature: 'reserve(items: Item[]): Promise<Reservation>'}
    d.label = 'pay'
    d.data = {signature: 'pay(receipt: Receipt): Promise<Payment>'}
  }
  if (model === 'schema') {
    a.kind = 'table'
    a.label = 'orders'
    b.kind = c.kind = d.kind = 'column'
    b.label = 'legacy_ref'
    b.data = {type: 'text', nullable: true}
    c.label = 'inventory_id'
    c.data = {type: 'uuid', nullable: false}
    d.label = 'id'
    d.data = {type: 'uuid', nullable: false, primaryKey: true}
  }
  if (model === 'architecture') {
    a.data = {layer: 'Application', technology: 'TypeScript'}
    b.data = {layer: 'Storage', technology: 'Legacy HTTP'}
    c.data = {layer: 'Storage', technology: 'Worker'}
    d.data = {layer: 'Application', technology: 'Payments API'}
  }
  if (presentation === 'dependencies') {
    a.kind = b.kind = c.kind = d.kind = 'package'
    a.data = {version: '1.0.0', scope: 'runtime'}
    b.data = {version: '0.2.0', scope: 'runtime'}
    c.data = {version: '2.0.0', scope: 'runtime'}
    d.data = {version: '1.4.0', scope: 'development'}
  }
  if (presentation === 'text') {
    a.kind = b.kind = c.kind = d.kind = 'document'
    a.data = {text: 'Checkout reserves inventory before payment.'}
    b.data = {text: 'The legacy reservation path is synchronous.'}
    c.data = {text: 'The new worker records a durable reservation.'}
    d.data = {text: 'Payments are retried idempotently.'}
  }
  const updated: Entity = {
    ...a,
    data:
      model === 'metrics'
        ? {value: 180, unit: 'ms'}
        : model === 'api'
          ? {signature: 'checkout(cart: Cart): Promise<Receipt>'}
          : presentation === 'dependencies'
            ? {version: '2.0.0', scope: 'runtime'}
            : presentation === 'text'
              ? {text: 'Checkout reserves inventory asynchronously before payment.'}
              : {...a.data, asynchronous: true},
  }
  const edge: Relationship = {
    id: 'reserve',
    kind: model === 'database' || model === 'treemap' ? 'contains' : 'calls',
    from: a.id,
    to: b.id,
  }
  const rewired: Relationship = {...edge, to: c.id}
  const stable: Relationship = {id: 'payment', kind: edge.kind, from: a.id, to: d.id}
  const metadata = {limitations: ['Synthetic demonstration, not extracted from a repository.'], ...(presentation ? {presentation} : {})}
  const before: Extraction = {protocolVersion: 0, schema, entities: [a, b, d], relationships: [edge, stable], metadata}
  const after: Extraction = {protocolVersion: 0, schema, entities: [updated, c, d], relationships: [rewired, stable], metadata}
  return {before, after}
}

function statisticsDemonstration() {
  const language = (name: string, files: number, code: number, comment: number, blank: number): Entity => ({
    id: `language:${name}`,
    kind: 'language',
    label: name,
    data: {
      files,
      code,
      comment,
      blank,
      lines: code + comment + blank,
      value: code,
      unit: 'lines of code',
    },
    confidence: 'derived',
    evidence: [{kind: 'counted-file', source: `src/example.${name === 'TypeScript' ? 'ts' : 'txt'}`}],
  })
  const state = (entities: Entity[]): Extraction => ({
    protocolVersion: 0,
    schema: 'metrics/v0',
    entities,
    relationships: [],
    metadata: {limitations: ['Synthetic language counts; no repository extractor was executed.']},
  })
  return {
    before: state([
      language('TypeScript', 10, 1000, 200, 100),
      language('JavaScript', 5, 500, 100, 50),
      language('Python', 4, 400, 50, 20),
    ]),
    after: state([language('TypeScript', 20, 2000, 250, 150), language('JavaScript', 2, 200, 50, 25), language('Rust', 1, 100, 20, 10)]),
  }
}

/** A third revision: payments changes and an audit service arrives. */
export function laterRevision(after: Extraction): Extraction {
  const audit: Entity = {...after.entities[0]!, id: 'audit', label: 'Audit log', data: {...after.entities[0]!.data, audited: true}}
  const entities = after.entities.map(entity => (entity.id === 'payments' ? {...entity, data: {...entity.data, retries: 3}} : entity))
  const relationships: Relationship[] =
    after.schema === 'metrics/v0'
      ? after.relationships
      : [...after.relationships, {id: 'audit-payments', kind: after.relationships[0]?.kind ?? 'calls', from: 'payments', to: 'audit'}]
  return {...after, entities: [...entities, audit], relationships}
}
