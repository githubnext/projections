import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createNativeEngine} from '@githubnext/projections-engine/native'
import {changesScope, comparisonModel, extractionModel, scopedModel} from '@githubnext/projections-renderer-kit'
import {summaryCountText} from '@githubnext/projections-renderer-sdk/presentation'
// `npm test` compiles src/ (without the browser entry) to this cache directory first.
import {columnChanges, keyChanges, referentialAction} from '../node_modules/.cache/test/change-lines.js'
import {createDatabaseDiff} from '../node_modules/.cache/test/diff.js'
import {databaseFacts} from '../node_modules/.cache/test/facts.js'
import {analyse, mergeValues} from '../node_modules/.cache/test/diff-states.js'
import {schemaMetrics} from '../node_modules/.cache/test/schema.js'
import {DatabaseRenderer} from '../node_modules/.cache/test/view.js'
import {databaseContext} from '../node_modules/.cache/test/scope.js'

const engine = createNativeEngine()
const scenarios = JSON.parse(readFileSync(new URL('../scenarios.json', import.meta.url), 'utf8')).scenarios
const load = value => (typeof value === 'string' ? JSON.parse(readFileSync(new URL(`../${value}`, import.meta.url), 'utf8')) : value)
async function modelOf(id) {
  const scenario = scenarios.find(item => item.id === id)
  const before = load(scenario.before),
    after = load(scenario.after)
  return comparisonModel(before, after, await engine.compare(before, after))
}
/** The facts the host's summary bar states, as words with their changes. */
const factsOf = async id =>
  databaseFacts(await modelOf(id)).map(
    fact => `${summaryCountText(fact.count, fact.noun)}${fact.added ? ` +${fact.added}` : ''}${fact.removed ? ` −${fact.removed}` : ''}`,
  )
const row = (model, id) => model.entities.find(item => item.id === id)
const column = (data, label = 'c') => ({id: 'c', kind: 'column', label, data})
const change = (before, after) => ({id: 'c', status: 'modified', before, after})

test("the summary bar's facts are what the kind counts can't say, in the schema's own words", async () => {
  // Tables, columns and keys added or removed are the bar's kind counts; type, nullability and names are facts.
  assert.deepEqual(await factsOf('prisma-shop'), ['2 column types changed', '5 enum values +2'])
  assert.deepEqual(await factsOf('django-library'), ['2 column types changed'])
  assert.deepEqual(await factsOf('organizations'), [])
  assert.deepEqual(await factsOf('cleanup'), ['1 column type changed', '1 column made required', '1 index renamed'])
})

test('each fact filters to the rows it names and carries its icon', async () => {
  const model = await modelOf('cleanup')
  const facts = databaseFacts(model)
  assert.deepEqual(
    facts.map(fact => [fact.id, fact.icon, fact.ids]),
    [
      ['column-types', 'changed', ['column:Invoices.Number']],
      ['columns-required', undefined, ['column:Customers.BillingEmail']],
      ['index-renamed', 'renamed', ['index:UX_Invoices_Number']],
    ],
  )
  for (const fact of facts) for (const id of fact.ids) assert.ok(row(model, id), id)
  // One revision states only its enums' values, without changes.
  const scenario = scenarios.find(item => item.id === 'prisma-shop')
  const after = load(scenario.after)
  assert.deepEqual(
    databaseFacts(extractionModel(after)).map(fact => [fact.id, fact.count, fact.added, fact.removed]),
    [['enum-values', 5, undefined, undefined]],
  )
})

test('column changes are stated only where the data supports them', async () => {
  assert.deepEqual(columnChanges(change(column({type: 'Int', nullable: true}), column({type: 'Int', nullable: false}))), [
    {key: 'nullable', word: 'Made required'},
  ])
  assert.deepEqual(columnChanges(change(column({type: 'Int'}), column({type: 'Int', nullable: true}))), [
    {key: 'nullable', word: 'Made optional'},
  ])
  assert.deepEqual(columnChanges(change(column({type: 'Int'}, 'a'), column({type: 'BigInt'}, 'b'))), [
    {key: 'label', word: 'Renamed', before: 'a', after: 'b'},
    {key: 'type', word: 'Type changed', before: 'Int', after: 'BigInt'},
  ])
  // A declared type behind an unchanged native type still reads as a type change; other fields are named verbatim.
  assert.deepEqual(
    columnChanges(
      change(column({type: 'CharField', databaseType: 'varchar(50)'}), column({type: 'SlugField', databaseType: 'varchar(50)'})),
    ),
    [{key: 'type', word: 'Type changed', before: 'CharField', after: 'SlugField'}],
  )
  assert.deepEqual(columnChanges(change(column({type: 'Int', check: null}), column({type: 'Int', check: 'x > 0'}))), [
    {key: 'fields', word: 'check changed'},
  ])
  assert.deepEqual(columnChanges({id: 'c', status: 'added', after: column({type: 'Int'})}), [])

  const cleanup = await modelOf('cleanup')
  assert.deepEqual(columnChanges(row(cleanup, 'column:Customers.BillingEmail')), [{key: 'nullable', word: 'Made required'}])
  assert.deepEqual(columnChanges(row(cleanup, 'column:Invoices.Number')), [
    {key: 'type', word: 'Type changed', before: 'character varying(64)', after: 'character varying(128)'},
  ])
  assert.deepEqual(keyChanges(row(cleanup, 'index:UX_Invoices_Number')), [
    {key: 'label', word: 'Renamed', before: 'IX_Invoices_Number', after: 'UX_Invoices_Number'},
  ])
  const django = await modelOf('django-library')
  assert.deepEqual(columnChanges(row(django, 'column:table%3Acatalog_author/name')), [
    {key: 'type', word: 'Type changed', before: 'varchar(120)', after: 'varchar(200)'},
  ])
  const prisma = await modelOf('prisma-shop')
  assert.deepEqual(columnChanges(row(prisma, 'column:table%3A%2FProduct/priceCents')), [
    {key: 'type', word: 'Type changed', before: 'Int', after: 'BigInt'},
  ])
})

test('an enum keeps removed values after the value they followed', () => {
  assert.deepEqual(mergeValues(['A', 'B', 'C'], ['A', 'C', 'D']), ['A', 'B', 'C', 'D'])
  assert.deepEqual(mergeValues(['X', 'A'], ['A']), ['X', 'A'])
})

const overlaps = (a, b) =>
  a.x < b.x + b.width - 1e-6 && b.x < a.x + a.width - 1e-6 && a.y < b.y + b.height - 1e-6 && b.y < a.y + a.height - 1e-6

test('the diff lays out both revisions once, without overlap', async () => {
  for (const id of ['prisma-shop', 'django-library', 'organizations', 'cleanup'])
    for (const available of [1300, 360]) {
      const model = await modelOf(id)
      const {frame} = createDatabaseDiff(model, {available})
      const cards = frame.tables.map(table => table.change.id)
      // Every card of either revision is drawn.
      for (const entity of model.entities)
        if (['table', 'view', 'enum'].includes((entity.after ?? entity.before).kind))
          assert.ok(cards.includes(entity.id), `${id}: ${entity.id}`)
      for (const [index, table] of frame.tables.entries()) {
        for (const other of frame.tables.slice(index + 1))
          assert.ok(!overlaps(table.box, other.box), `${id} at ${available}: ${table.change.id}`)
        // Rows, with their change lines, stay inside their card and never share a slot.
        let bottom = schemaMetrics.header
        for (const item of [...table.columns].sort((a, b) => a.top - b.top)) {
          assert.ok(item.top >= bottom, `${id}: ${item.change.id} overlaps the row above`)
          bottom = item.top + (1 + (item.lines?.length ?? 0)) * schemaMetrics.row
        }
        assert.ok(bottom <= table.box.height, `${id}: ${table.change.id} holds its rows`)
      }
    }
})

test('the diff keeps removed things where they were and marks links by revision', async () => {
  const cleanup = createDatabaseDiff(await modelOf('cleanup'), {available: 1300}).frame
  const users = cleanup.tables.find(table => table.change.id === 'table:Users')
  assert.equal(users.change.status, 'removed')
  assert.equal(users.columns.length, 7, 'its columns and indexes stay in its card')
  assert.deepEqual(
    cleanup.links.filter(link => link.status !== 'unchanged').map(link => [link.dependent, link.status]),
    [['table:Users', 'removed']],
  )
  const billing = cleanup.tables.flatMap(table => table.columns).find(item => item.change.id === 'column:Customers.BillingEmail')
  assert.deepEqual(billing.lines, [{key: 'nullable', word: 'Made required'}])

  const prisma = createDatabaseDiff(await modelOf('prisma-shop'), {available: 1300}).frame
  const status = prisma.tables.find(table => table.change.id === 'enum:OrderStatus')
  assert.deepEqual(
    status.columns.map(value => [value.entity.label, value.change.status]),
    [
      ['PENDING', 'unchanged'],
      ['PAID', 'unchanged'],
      ['SHIPPED', 'unchanged'],
      ['CANCELLED', 'added'],
      ['REFUNDED', 'added'],
    ],
  )
  assert.deepEqual(
    prisma.links.filter(link => link.status === 'added').map(link => link.dependentColumn),
    ['column:table%3A%2FAddress/customerId', 'column:table%3A%2FOrder/shippingAddressId'],
  )
  // Hiding relationships draws no links and keeps every card.
  const hidden = createDatabaseDiff(await modelOf('prisma-shop'), {available: 1300, links: false}).frame
  assert.equal(hidden.links.length, 0)
  assert.equal(hidden.tables.length, prisma.tables.length)
})

const render = (model, diff, highlighting = 1) =>
  renderToStaticMarkup(
    createElement(DatabaseRenderer, {
      init: {},
      model,
      direction: 1,
      onOpen() {},
      reportSteps() {},
      declareControls() {},
      onAction: () => () => {},
      viewport: undefined,
      schedule: [],
      progress: 1,
      highlighting,
      emphasis: row => (highlighting && row.status !== 'unchanged' ? highlighting : 0),
      comparing: true,
      diff,
      selectedId: null,
      hoveredId: null,
      onSelect() {},
      controls: {},
      options: {},
      reducedMotion: true,
      locale: 'en',
      rendererName: 'database',
    }),
  )

test('the diff marks changes in place, in words, and leaves the summary to the host', async () => {
  const model = await modelOf('cleanup')
  const html = render(model, true)
  assert.ok(!html.includes('pk-diff-summary') && !html.includes('1 column made required'))
  assert.match(html, /data-entity-id="table:Users"[^>]*data-change="removed"/)
  assert.match(html, /data-entity-id="column:Customers.BillingEmail"[^>]*data-change="modified"/)
  assert.ok(html.includes('Made required'))
  // The renamed index: its old name struck through under the new one, and both said in words.
  assert.ok(html.includes('<del class="pk-change-pill" data-change="removed"><span class="sr-only">was </span>'))
  assert.ok(html.includes('IX_Invoices_Number'))
  assert.match(html, /, now (<!-- -->)?UX_Invoices_Number/)
  // Not in diff mode: no summary or change lines.
  const animated = render(model, false)
  for (const mark of ['database-spanning', 'database-change-line', 'data-diff']) assert.ok(!animated.includes(mark), mark)
})

test("a foreign key's referential actions read with their values, as each extractor writes them", () => {
  const key = data => ({id: 'k', kind: 'constraint', label: 'k', data: {type: 'foreign-key', columns: ['a'], ...data}})
  assert.deepEqual(keyChanges(change(key({onDelete: 'Restrict'}), key({onDelete: 'Cascade', onUpdate: 'Cascade'}))), [
    {key: 'on-delete', word: 'On delete changed', before: 'Restrict', after: 'Cascade'},
    {key: 'on-update', word: 'On update changed', before: 'default', after: 'Cascade'},
  ])
  assert.equal(referentialAction({callable: 'django.db.models.deletion.PROTECT'}), 'PROTECT')
  // Two callables of the same name in different modules are a change, read in full.
  assert.deepEqual(
    keyChanges(change(key({onDelete: {callable: 'old_policy.PROTECT'}}), key({onDelete: {callable: 'new_policy.PROTECT'}}))),
    [{key: 'on-delete', word: 'On delete changed', before: 'old_policy.PROTECT', after: 'new_policy.PROTECT'}],
  )
  // Unset and `null` both mean the default: no change.
  assert.deepEqual(keyChanges(change(key({onDelete: null}), key({}))), [])
  assert.equal(referentialAction(null), 'default')
  assert.equal(referentialAction('SET NULL'), 'SET NULL')
})

test("a single-column foreign key's change is said under its column, never as the column's own", async () => {
  // Only the Order → Customer key's onDelete changes; the key is drawn as customerId's FK marker.
  const scenario = scenarios.find(item => item.id === 'prisma-shop')
  const before = load(scenario.before)
  const after = structuredClone(before)
  const key = after.entities.find(
    entity => entity.kind === 'constraint' && entity.data?.type === 'foreign-key' && entity.data.target === 'table:/Customer',
  )
  key.data = {...key.data, onDelete: 'Cascade'}
  const model = comparisonModel(before, after, await engine.compare(before, after))
  const {union, lines} = analyse(model)
  const [column] = [...union.markers].find(([, marker]) => marker.key === row(model, key.id).id)
  assert.deepEqual(lines.get(column), [{key: 'on-delete', word: 'On delete changed', before: 'default', after: 'Cascade'}])
  const {frame} = createDatabaseDiff(model, {available: 1300})
  assert.ok(JSON.stringify(frame).includes('On delete changed'), 'the diff draws the line under the column')
  assert.deepEqual(
    databaseFacts(model).filter(fact => fact.id !== 'enum-values'),
    [],
    'no column reads as renamed or retyped',
  )
})

test("a marker key's changes are named for that key, though its column has other roles", async () => {
  // OrderLine.orderId is in the composite primary key and has its own foreign key: only that key is renamed.
  const before = load(scenarios.find(item => item.id === 'prisma-shop').before)
  const after = structuredClone(before)
  const key = after.entities.find(
    entity =>
      entity.kind === 'constraint' &&
      entity.data?.type === 'foreign-key' &&
      entity.data.table === 'table:/OrderLine' &&
      entity.data.columns?.[0] === 'orderId',
  )
  key.data = {...key.data, databaseName: 'OrderLine_order_fkey'}
  const model = comparisonModel(before, after, await engine.compare(before, after))
  const {union, lines} = analyse(model)
  const [column, marker] = [...union.markers].find(([, item]) => item.key === row(model, key.id).id)
  assert.notEqual(marker.title, 'Foreign key', 'the marker stands for more than the key')
  assert.deepEqual(
    lines.get(column).map(line => line.word),
    ['Foreign key renamed'],
  )
})

for (const [what, edit] of [
  [
    "a changed foreign key's onDelete",
    after => {
      const key = after.entities.find(
        entity => entity.kind === 'constraint' && entity.data?.type === 'foreign-key' && entity.data.target === 'table:/Customer',
      )
      key.data = {...key.data, onDelete: 'Cascade'}
    },
  ],
  [
    'a changed foreign-key column',
    after => {
      const column = after.entities.find(entity => entity.kind === 'column' && entity.label === 'customerId')
      column.data = {...column.data, nullable: !column.data?.nullable}
    },
  ],
]) {
  test(`the Changes scope keeps the table ${what} references, so its link has both ends`, async () => {
    // Only that changes: no table, other column or link does.
    const scenario = scenarios.find(item => item.id === 'prisma-shop')
    const before = load(scenario.before)
    const after = structuredClone(before)
    edit(after)
    const model = comparisonModel(before, after, await engine.compare(before, after))
    // Narrowed as the shell narrows it: the changes, their context, the rest of a shown table's columns folded.
    const scope = changesScope(model, {query: '', changesOnly: true, ids: null})
    const shown = new Set([...scope.shown, ...databaseContext(model, scope.changes)])
    const narrowed = scopedModel(model, shown, 'fold').model
    const tables = narrowed.entities.filter(row => (row.after ?? row.before).kind === 'table').map(row => (row.after ?? row.before).label)
    assert.deepEqual(tables.sort(), ['Customer', 'Order'])
    const {frame} = createDatabaseDiff(narrowed, {available: 1300})
    const label = id => (row(narrowed, id)?.after ?? row(narrowed, id)?.before)?.label
    const references = frame.links.map(link => `${label(link.dependent)} → ${label(link.principal)}`)
    assert.ok(references.includes('Order → Customer'), `the link reaches Customer: ${references}`)
  })
}
