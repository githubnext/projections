import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {extractionModel, scheduleSteps, stepEmphasis} from '@githubnext/projections-renderer-kit'
// `npm test` compiles src/ (without the browser entry) to this cache directory first.
import {createDatabaseTransition} from '../node_modules/.cache/test/transition.js'
import {DatabaseRenderer} from '../node_modules/.cache/test/view.js'

const extraction = (entities, relationships) => ({protocolVersion: 0, schema: 'database/v0', entities, relationships})
const frameOf = value => createDatabaseTransition(extractionModel(value), [], {available: 1100})(1)
const markupOf = value => {
  const model = extractionModel(value)
  return renderToStaticMarkup(
    createElement(DatabaseRenderer, {
      init: {},
      model,
      comparing: false,
      progress: 1,
      highlighting: 0,
      direction: 1,
      schedule: scheduleSteps(model),
      rendererName: 'database',
      selectedId: null,
      onSelect() {},
      onOpen() {},
      reportSteps() {},
      controls: {},
      declareControls() {},
      emphasis: stepEmphasis([], 1, 0),
      onAction: () => () => {},
      options: {},
      viewport: undefined,
    }),
  )
}

/** One EF Core table, as `efcore-schema` writes it: keys, indexes and checks are entities its table links to. */
function efCore() {
  const table = 'table:dbo.Products'
  const columns = ['Id', 'Sku', 'Price']
  const entities = [
    {id: table, kind: 'table', label: 'dbo.Products'},
    ...columns.map(name => ({id: `${table}:column:${name}`, kind: 'column', label: name, data: {type: 'int'}})),
    {id: `${table}:key:PK`, kind: 'primary-key', label: 'PK_Products', data: {columns: ['Id']}},
    {id: `${table}:key:AK`, kind: 'unique-key', label: 'AK_Products_Sku', data: {columns: ['Sku']}},
    {id: `${table}:check:CK`, kind: 'check-constraint', label: 'CK_Products_Price', data: {sql: '[Price] > 0'}},
  ]
  const relationships = [
    ...columns.map(name => ({id: `contains:${name}`, kind: 'contains', from: table, to: `${table}:column:${name}`})),
    ...['key:PK', 'key:AK', 'check:CK'].map(key => ({id: `constraint:${key}`, kind: 'constraint', from: table, to: `${table}:${key}`})),
    {id: 'key-column:PK', kind: 'key-column', from: `${table}:key:PK`, to: `${table}:column:Id`},
    {id: 'key-column:AK', kind: 'key-column', from: `${table}:key:AK`, to: `${table}:column:Sku`},
  ]
  return extraction(entities, relationships)
}

test("EF Core's unique keys and check constraints are key rows of their table, marked UK and CK", () => {
  const frame = frameOf(efCore())
  assert.deepEqual(frame.tags, [], 'nothing floats free')
  const [products] = frame.tables
  const keys = products.columns.filter(row => row.kind === 'key').map(row => [row.key.marker, row.key.title, row.key.text, row.key.name])
  assert.deepEqual(keys, [
    ['UK', 'Unique', 'Sku', 'AK_Products_Sku'],
    ['CK', 'Check', 'CK_Products_Price', undefined],
  ])
})

/** Prisma's implicit many-to-many relations: tags on posts, and users following users. */
function prisma() {
  const table = name => ({id: `table:/${name}`, kind: 'table', label: name})
  const column = (owner, name) => ({id: `column:${owner}/${name}`, kind: 'column', label: name, data: {type: 'Int', primaryKey: true}})
  const contains = (owner, name) => ({
    id: `contains:${owner}/${name}`,
    kind: 'contains',
    from: `table:/${owner}`,
    to: `column:${owner}/${name}`,
  })
  const relation = (from, to, name) => ({
    id: `many-to-many:table:/${from}/table:/${to}/${name}`,
    kind: 'many-to-many',
    from: `table:/${from}`,
    to: `table:/${to}`,
    data: {implicit: true},
  })
  return extraction(
    [table('Post'), table('Tag'), table('User'), column('Post', 'id'), column('Tag', 'id'), column('User', 'id')],
    [
      contains('Post', 'id'),
      contains('Tag', 'id'),
      contains('User', 'id'),
      relation('Post', 'Tag', 'PostToTag'),
      relation('User', 'User', 'Follows'),
    ],
  )
}

test("Prisma's implicit many-to-many relations link their tables, with no arrowhead", () => {
  const frame = frameOf(prisma())
  assert.deepEqual(frame.tags, [], 'nothing floats free')
  const links = frame.links.map(link => [link.type, link.dependent, link.principal, link.dependentColumn, link.principalColumn])
  assert.deepEqual(links.toSorted(), [
    ['many-to-many', 'table:/Post', 'table:/Tag', undefined, undefined],
    ['many-to-many', 'table:/User', 'table:/User', undefined, undefined],
  ])
  for (const link of frame.links) assert.ok(link.points.length >= 2, `${link.key} is drawn`)
  const markup = markupOf(prisma())
  assert.match(markup, /aria-label="Many-to-many relationship between Post and Tag"/)
  assert.match(markup, /aria-label="Many-to-many relationship between User and User"/)
  // Neither end depends on the other, so neither gets an arrowhead.
  assert.doesNotMatch(markup, /data-head-of-link=/)
})
