/** Synthetic invoicing schema: the after revision adds an Organizations table that four tables reference. */
/** @returns {import('@githubnext/projections-schemas').Extraction} */
const extraction = (entities, relationships) => ({protocolVersion: 0, schema: 'database/v0', entities, relationships})

export function invoicing({organizations}) {
  const entities = [],
    relationships = []
  const table = (name, columns, {indexes = [], keys = ['Id'], references = []} = {}) => {
    const id = `table:${name}`
    entities.push({id, kind: 'table', label: name, evidence: [{kind: 'migration', source: `Migrations/${name}.cs`, location: {line: 12}}]})
    for (const [column, type, nullable = false] of columns) {
      entities.push({id: `column:${name}.${column}`, kind: 'column', label: column, data: {type, nullable}})
      relationships.push({id: `contains:${name}.${column}`, kind: 'contains', from: id, to: `column:${name}.${column}`})
    }
    const key = `key:PK_${name}`
    entities.push({id: key, kind: 'primary-key', label: `PK_${name}`, data: {columns: keys}})
    relationships.push({id: `constraint:PK_${name}`, kind: 'constraint', from: id, to: key})
    for (const column of keys)
      relationships.push({id: `key-column:PK_${name}.${column}`, kind: 'key-column', from: key, to: `column:${name}.${column}`})
    for (const column of indexes) {
      const index = `index:IX_${name}_${column}`
      entities.push({id: index, kind: 'index', label: `IX_${name}_${column}`, data: {columns: [column]}})
      relationships.push({id: `index:${index}`, kind: 'index', from: id, to: index})
      relationships.push({id: `index-column:${index}`, kind: 'index-column', from: index, to: `column:${name}.${column}`})
    }
    for (const [column, principal] of references) {
      relationships.push({
        id: `relation:FK_${name}_${principal}_${column}`,
        kind: 'relation',
        from: id,
        to: `table:${principal}`,
        data: {columns: [column], principalColumns: ['Id'], name: `FK_${name}_${principal}_${column}`},
      })
    }
  }
  const org = organizations ? [['OrganizationId', 'uuid']] : []
  const orgIndex = organizations ? ['OrganizationId'] : []
  const orgReference = organizations ? [['OrganizationId', 'Organizations']] : []
  table('Customers', [['Id', 'uuid'], ['Name', 'character varying(200)'], ['BillingEmail', 'character varying(320)', true], ...org], {
    indexes: orgIndex,
    references: orgReference,
  })
  table(
    'Invoices',
    [
      ['Id', 'uuid'],
      ['Number', 'character varying(32)'],
      ['CustomerId', 'uuid'],
      ['IssuedOn', 'date'],
      ['DueOn', 'date'],
      ['Status', 'character varying(16)'],
      ...org,
    ],
    {indexes: ['CustomerId', 'Number', ...orgIndex], references: [['CustomerId', 'Customers'], ...orgReference]},
  )
  table(
    'InvoiceLines',
    [
      ['Id', 'uuid'],
      ['InvoiceId', 'uuid'],
      ['Description', 'character varying(500)'],
      ['Quantity', 'integer'],
      ['UnitPrice', 'numeric(12,2)'],
    ],
    {indexes: ['InvoiceId'], references: [['InvoiceId', 'Invoices']]},
  )
  table(
    'Users',
    [
      ['Id', 'uuid'],
      ['Email', 'character varying(320)'],
      ['DisplayName', 'character varying(120)'],
      ['CreatedAt', 'timestamp with time zone'],
      ...org,
    ],
    {indexes: ['Email', ...orgIndex], references: orgReference},
  )
  if (organizations) {
    table(
      'Organizations',
      [
        ['Id', 'uuid'],
        ['Name', 'character varying(200)'],
        ['Slug', 'character varying(64)'],
        ['CreatedAt', 'timestamp with time zone'],
      ],
      {indexes: ['Slug']},
    )
  }
  return extraction(entities, relationships)
}

export const before = invoicing({organizations: false})
export const after = invoicing({organizations: true})

/** A column changes type and a nullable column becomes required: restructures without any arrival. */
export const retyped = {
  ...after,
  entities: after.entities.map(entity =>
    entity.id === 'column:Invoices.Number'
      ? {...entity, data: {type: 'character varying(64)', nullable: false}}
      : entity.id === 'column:Customers.BillingEmail'
        ? {...entity, data: {type: 'character varying(320)', nullable: false}}
        : entity,
  ),
}

/** Tag-only change: one index renamed (declared through previousIds) and one added. */
export function indexes(names) {
  return extraction(
    [
      {id: 'table:Events', kind: 'table', label: 'Events'},
      {id: 'column:Events.Id', kind: 'column', label: 'Id', data: {type: 'uuid'}},
      ...names.map(([id, label, previous]) => ({id, kind: 'index', label, ...(previous ? {previousIds: [previous]} : {})})),
    ],
    [{id: 'contains:Events.Id', kind: 'contains', from: 'table:Events', to: 'column:Events.Id'}],
  )
}
