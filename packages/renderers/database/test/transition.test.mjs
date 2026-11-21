import {test} from 'node:test'
import {stepEmphasis, comparisonModel, compileTimeline, extractionModel, scheduleSteps} from '@githubnext/projections-renderer-kit'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createNativeEngine} from '@githubnext/projections-engine/native'
// `npm test` compiles src/ (without the browser entry) to this cache directory first.
import {createDatabaseTransition} from '../node_modules/.cache/test/transition.js'
import {schemaMetrics} from '../node_modules/.cache/test/schema.js'
import {DatabaseRenderer} from '../node_modules/.cache/test/view.js'
import {after, before, indexes, retyped} from './fixtures.mjs'

const engine = createNativeEngine()
async function transitionOf(a, b, options = {available: 1100}, schedule = scheduleSteps) {
  const model = comparisonModel(a, b, await engine.compare(a, b))
  return {model, transition: createDatabaseTransition(model, schedule(model), options)}
}
/**
 * The schedule without reading time. Reading is one-sided (a removal is read before it leaves, an arrival is not
 * held), so the reverse comparison mirrors the motion, not the reading.
 */
const unread = model => compileTimeline(model.steps).map(step => ({...step, travel: 1}))
const tableName = id => id.replace(/^table:/, '')
const tableCard = (frame, label) => {
  const found = frame.tables.find(candidate => tableName(candidate.change.id) === label)
  assert.ok(found, `missing table ${label}`)
  return found
}
const opacityOf = (frame, label) => frame.tables.find(candidate => tableName(candidate.change.id) === label)?.opacity ?? 0
const overlaps = (a, b) =>
  a.x < b.x + b.width - 1e-6 && b.x < a.x + a.width - 1e-6 && a.y < b.y + b.height - 1e-6 && b.y < a.y + a.height - 1e-6
const samples = (count = 400) => Array.from({length: count + 1}, (_, index) => index / count)
/** What a frame presents, independent of geometry. */
const content = frame => ({
  tables: frame.tables
    .map(item => [
      item.change.id,
      item.entity.label,
      item.columns.map(column => `${column.role ?? '-'}:${column.entity.label}:${column.entity.data?.type}`),
    ])
    .sort(),
  links: frame.links.map(link => link.key).sort(),
  tags: frame.tags.map(tag => (tag.label.mix < 0.5 ? tag.label.from : tag.label.to)).sort(),
})

test('orders columns primary key, then foreign keys, then by name', async () => {
  const {transition} = await transitionOf(before, after)
  const invoices = tableCard(transition(1), 'Invoices')
  const rows = [...invoices.columns].sort((a, b) => a.top - b.top)
  const order = rows.filter(row => row.kind === 'column').map(column => `${column.role ?? '-'}:${column.entity.label}`)
  assert.deepEqual(order.slice(0, 3), ['pk:Id', 'fk:CustomerId', 'fk:OrganizationId'])
  const rest = order.slice(3)
  assert.ok(rest.every(entry => entry.startsWith('-:')))
  assert.deepEqual(rest, [...rest].sort())
  // The table's indexes follow its columns as rows of the card; its single-column primary key is the Id column's marker.
  const kinds = rows.map(row => row.kind)
  assert.equal(kinds.indexOf('key'), kinds.lastIndexOf('column') + 1)
  assert.deepEqual(
    rows.filter(row => row.kind === 'key').map(row => [row.key.marker, row.key.text, row.key.name]),
    [
      ['IX', 'CustomerId', 'IX_Invoices_CustomerId'],
      ['IX', 'Number', 'IX_Invoices_Number'],
      ['IX', 'OrganizationId', 'IX_Invoices_OrganizationId'],
    ],
  )
  assert.equal(rows[0].marker.key, 'key:PK_Invoices')
  assert.deepEqual(transition(1).tags, [], 'no key floats free of its table')
})

test('places principals left of their dependents', async () => {
  const {transition} = await transitionOf(before, after)
  const end = transition(1)
  assert.equal(end.mode, 'columns')
  const x = label => tableCard(end, label).box.x
  assert.ok(x('Organizations') < x('Customers'))
  assert.equal(x('Customers'), x('Users'))
  assert.ok(x('Customers') < x('Invoices') && x('Invoices') < x('InvoiceLines'))
  const start = transition(0)
  assert.ok(tableCard(start, 'Customers').box.x < tableCard(start, 'Invoices').box.x)
})

test('connects foreign-key columns to the principal key column', async () => {
  const {transition} = await transitionOf(before, after)
  const frame = transition(1)
  const keys = frame.links.map(link => `${link.dependentColumn.replace(/^column:/, '')}->${tableName(link.principal)}`).sort()
  assert.deepEqual(keys, [
    'Customers.OrganizationId->Organizations',
    'InvoiceLines.InvoiceId->Invoices',
    'Invoices.CustomerId->Customers',
    'Invoices.OrganizationId->Organizations',
    'Users.OrganizationId->Organizations',
  ])
  for (const link of frame.links) {
    const dependent = frame.tables.find(item => item.change.id === link.dependent)
    const column = dependent.columns.find(item => item.change.id === link.dependentColumn)
    assert.equal(
      link.points[0].y,
      dependent.box.y + column.top + schemaMetrics.row / 2,
      'link leaves from the middle of its foreign-key row',
    )
  }
})

test('routes rank-skipping links around cards', async () => {
  const {transition} = await transitionOf(before, after)
  const frame = transition(1)
  const skip = frame.links.find(link => tableName(link.dependent) === 'Invoices' && tableName(link.principal) === 'Organizations')
  assert.ok(skip.points.length > 2, 'skip link has interior waypoints')
  for (const point of skip.points.slice(1, -1)) {
    for (const card of frame.tables) {
      const {x, y, width, height} = card.box
      assert.ok(!(point.x > x && point.x < x + width && point.y > y && point.y < y + height), `waypoint inside ${card.change.id}`)
    }
  }
})

test('the status glyph cell costs no card width: ranks stay side by side, cards at least the usual width', async () => {
  const {rankGap, minCard, maxCard, maxContentCard} = schemaMetrics
  const gaps = 3 * rankGap
  for (let available = 1000; available <= 2000; available += 50) {
    const frame = (await transitionOf(before, after, {available})).transition(1)
    // Four ranks side by side, exactly as laid out before cards had a status cell; the row's glyph cell is the only cost.
    assert.ok(4 * minCard + gaps <= available)
    assert.equal(frame.mode, 'columns', `side by side at ${available}px`)
    // One width for every card: the usual width, or wider when a name needs it, never wider than the frame's share.
    const widths = [...new Set(frame.tables.map(item => item.box.width))]
    const share = Math.floor((available - gaps) / 4)
    assert.equal(widths.length, 1)
    assert.ok(
      widths[0] >= Math.min(maxCard, share) && widths[0] <= Math.min(share, Math.max(maxCard, maxContentCard)),
      `${widths[0]} at ${available}px`,
    )
    assert.ok(frame.width <= available, `the schema fits ${available}px`)
  }
})

test('stacks cards when ranks do not fit, and hiding links reclaims the gutter', async () => {
  const stacked = (await transitionOf(before, after, {available: 480})).transition(1)
  assert.equal(stacked.mode, 'stack')
  assert.equal(new Set(stacked.tables.map(item => item.box.x)).size, 1)
  assert.ok(stacked.width <= 480)
  assert.ok(stacked.tables[0].box.x > 0, 'a gutter carries the links')
  for (const available of [1100, 480]) {
    const shown = (await transitionOf(before, after, {available})).transition
    const hidden = (await transitionOf(before, after, {available, links: false})).transition
    for (const progress of [0, 0.5, 1]) {
      assert.equal(hidden(progress).links.length, 0)
      assert.equal(hidden(progress).mode, shown(progress).mode)
      assert.deepEqual(
        hidden(progress).tables.map(item => item.change.id),
        shown(progress).tables.map(item => item.change.id),
      )
    }
  }
  const bare = (await transitionOf(before, after, {available: 480, links: false})).transition(1)
  assert.ok(
    bare.tables.every(item => item.box.x === 0),
    'no gutter is reserved without links',
  )
})

for (const available of [1100, 980, 480]) {
  test(`keeps every frame coherent at ${available}px, forward and backward`, async () => {
    const {transition} = await transitionOf(before, after, {available})
    const organizations = transition.timeline.windows.find(entry => entry.step.entities.includes('table:Organizations'))
    assert.ok(organizations, 'the new table arrives in a step')
    const arrival = organizations.fadeIn.time - organizations.fadeIn.radius
    const final = transition(1)
    const frames = samples()
    let previous
    for (const progress of [...frames, ...frames.slice().reverse()]) {
      const frame = transition(progress)
      assert.equal(frame.width, final.width, 'framing is stable')
      assert.equal(frame.height, final.height, 'framing is stable')
      const visible = frame.tables.filter(item => item.opacity > 0)
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          assert.ok(!overlaps(visible[i].box, visible[j].box), `${visible[i].change.id} overlaps ${visible[j].change.id} at ${progress}`)
        }
      }
      for (const card of frame.tables) {
        assert.ok(card.box.x >= -1e-9 && card.box.y >= -1e-9, 'cards stay inside the canvas')
        assert.ok(card.box.x + card.box.width <= frame.width + 1e-6 && card.box.y + card.box.height <= frame.height + 1e-6)
      }
      if (progress < arrival) {
        assert.equal(opacityOf(frame, 'Organizations'), 0, `new table hidden before its arrival at ${progress}`)
        assert.ok(
          frame.links.every(link => link.principal !== 'table:Organizations'),
          `its links wait for it at ${progress}`,
        )
      } else {
        assert.deepEqual(
          tableCard(frame, 'Customers').box,
          tableCard(final, 'Customers').box,
          `survivors settled before the arrival at ${progress}`,
        )
      }
      // Readable rows never sit on top of each other, even when a column becomes a key and moves up.
      for (const card of frame.tables) {
        const readable = card.columns.filter(column => column.opacity > 0.5)
        for (const [index, a] of readable.entries()) {
          for (const b of readable.slice(index + 1)) {
            assert.ok(Math.abs(a.top - b.top) >= schemaMetrics.row - 0.5, `${a.change.id} overlaps ${b.change.id} at ${progress}`)
          }
        }
      }
      // Links never outlive (or precede) their cards and rows.
      for (const link of frame.links) {
        const owner = frame.tables.find(item => item.change.id === link.dependent)
        assert.ok(owner && link.opacity <= owner.opacity + 1e-9)
      }
      if (previous) {
        for (const card of frame.tables) {
          const previousCard = previous.tables.find(item => item.change.id === card.change.id)
          if (!previousCard) continue
          const jump = Math.hypot(card.box.x - previousCard.box.x, card.box.y - previousCard.box.y)
          assert.ok(jump < 40, `${card.change.id} jumps ${jump.toFixed(1)}px at ${progress}`)
        }
      }
      previous = frame
    }
    assert.equal(tableCard(final, 'Organizations').opacity, 1)
  })
}

test('endpoints present exactly what each extraction presents alone', async () => {
  for (const [a, b] of [
    [before, after],
    [after, retyped],
    [before, retyped],
  ]) {
    const {transition} = await transitionOf(a, b)
    const alone = extraction => createDatabaseTransition(extractionModel(extraction), [], {available: 1100})(1)
    assert.deepEqual(content(transition(0)), content(alone(a)))
    assert.deepEqual(content(transition(1)), content(alone(b)))
    for (const frame of [transition(0), transition(1)]) {
      assert.ok(frame.tables.every(item => item.opacity === 1 && item.columns.every(column => column.opacity === 1)))
      assert.ok(frame.links.every(link => link.opacity === 1) && frame.tags.every(tag => tag.opacity === 1))
    }
  }
})

test('the reverse comparison mirrors the motion', async () => {
  const forward = (await transitionOf(before, after, undefined, unread)).transition
  const reverse = (await transitionOf(after, before, undefined, unread)).transition
  for (const progress of samples(100)) {
    const a = forward(progress),
      b = reverse(1 - progress)
    assert.deepEqual(
      content(a).tables.map(item => item[0]),
      content(b).tables.map(item => item[0]),
      `same tables at ${progress}`,
    )
    for (const card of a.tables) {
      const other = b.tables.find(item => item.change.id === card.change.id)
      for (const key of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(card.box[key] - other.box[key]) < 1e-6, `${card.change.id}.${key} at ${progress}`)
      }
      assert.ok(Math.abs(card.opacity - other.opacity) < 1e-6)
    }
  }
})

test('a column retype switches halfway through its own step', async () => {
  const {transition} = await transitionOf(after, retyped)
  const id = 'column:Invoices.Number'
  const step = transition.timeline.windows.find(entry => entry.step.entities.includes(id)).step
  const type = progress => tableCard(transition(progress), 'Invoices').columns.find(column => column.change.id === id).entity.data.type
  assert.equal(type(step.time - step.radius), 'character varying(32)')
  assert.equal(type(step.time - 1e-6), 'character varying(32)')
  assert.equal(type(step.time + 1e-6), 'character varying(64)')
  assert.equal(type(1), 'character varying(64)')
})

test('tags rename and arrive in their own steps', async () => {
  const a = indexes([
    ['index:IX_Old', 'IX_Old'],
    ['index:IX_B', 'IX_B'],
  ])
  const b = indexes([
    ['index:IX_New', 'IX_NewLongerName', 'index:IX_Old'],
    ['index:IX_B', 'IX_B'],
    ['index:IX_C', 'IX_C'],
  ])
  const {transition} = await transitionOf(a, b, {available: 480})
  assert.deepEqual(
    transition.tagStages[0].map(tag => tag.label),
    ['IX_B', 'IX_Old'],
  )
  assert.deepEqual(
    transition.tagStages.at(-1).map(tag => tag.label),
    ['IX_B', 'IX_C', 'IX_NewLongerName'],
  )
  const arrival = transition.timeline.windows.find(entry => entry.step.entities.includes('index:IX_C'))
  const tag = (progress, id) => transition(progress).tags.find(item => item.change.id === id)
  assert.equal(tag(arrival.fadeIn.time - arrival.fadeIn.radius, 'index:IX_C'), undefined, 'arrivals wait for their window')
  assert.equal(tag(1, 'index:IX_C').opacity, 1)
  assert.deepEqual(tag(0, 'index:IX_New').label, {from: 'IX_Old', to: 'IX_Old', mix: 0})
  assert.deepEqual(tag(1, 'index:IX_New').label, {from: 'IX_NewLongerName', to: 'IX_NewLongerName', mix: 0})
  for (const progress of samples(100)) {
    assert.deepEqual(transition(progress).tables[0].box, transition(0).tables[0].box, 'tag changes never move a table')
  }
})

const props = (model, progress, highlighting) => ({
  init: {},
  model,
  comparing: model.mode === 'comparison',
  progress,
  highlighting,
  direction: 1,
  schedule: scheduleSteps(model),
  rendererName: 'database',
  selectedId: null,
  onSelect() {},
  onOpen() {},
  reportSteps() {},
  controls: {},
  declareControls() {},
  get emphasis() {
    return stepEmphasis(this.schedule ?? [], this.progress, this.highlighting)
  },
  onAction: () => () => {},
  options: {},
  viewport: undefined,
  reducedMotion: false,
  locale: 'en-US',
})

test('endpoints carry no change decoration; the middle states each change as text in reserved space', async () => {
  const model = comparisonModel(before, after, await engine.compare(before, after))
  const count = (markup, pattern) => [...markup.matchAll(pattern)].length
  for (const progress of [0, 1]) {
    const markup = renderToStaticMarkup(createElement(DatabaseRenderer, props(model, progress, 0)))
    assert.ok(!markup.includes('class="badge') && !markup.includes('pk-status-text'), `no status at ${progress}`)
    assert.ok(
      [...markup.matchAll(/--emphasis:([\d.]+)/g)].every(match => Number(match[1]) === 0),
      `no tag tint at ${progress}`,
    )
  }
  const middle = renderToStaticMarkup(createElement(DatabaseRenderer, props(model, 0.75, 1)))
  assert.match(middle, /data-change-status="added"><span class="pk-icon" data-icon="added" aria-hidden="true"><\/span>Added/)
  // Keys and indexes are rows of their tables, never free-floating tags; every header and row reserves its status cell.
  assert.ok(!middle.includes('class="database-tags"'), 'no free-floating tags')
  assert.match(middle, /class="database-column database-row database-keyrow pk-part first"/)
  assert.equal(
    count(middle, /class="pk-change-status database-status/g),
    count(middle, /<header /g),
    'headers reserve a status cell with the word',
  )
  assert.equal(count(middle, /class="database-glyph"/g), count(middle, /class="database-column /g), 'column rows reserve a glyph cell')
  // A column row shows the icon; the word is there for assistive technology and as the cell's title.
  assert.match(
    middle,
    /<span class="database-glyph" data-change-footer="" title="Added"><span class="pk-status-text"[^>]*><span class="pk-status-part added" data-change-status="added" aria-hidden="true"><span class="pk-icon" data-icon="added" aria-hidden="true"><\/span><\/span><span class="sr-only">Added<\/span>/,
  )
  assert.match(
    middle,
    /data-entity-id="index:IX_Users_OrganizationId"[^>]*>.*?<span class="sr-only">Added<\/span>/,
    'a changed index row names its status',
  )
  const single = renderToStaticMarkup(createElement(DatabaseRenderer, props(extractionModel(after), 1, 0)))
  assert.ok(single.includes('Organizations') && !single.includes('class="badge') && !single.includes('pk-status-text'))
  assert.equal(count(single, /class="database-glyph"/g), count(single, /class="database-column /g), 'unchanged rows keep their status cell')
})

test('views are cards of their columns, labeled as views', () => {
  const extraction = {
    protocolVersion: 0,
    schema: 'database/v0',
    entities: [
      {id: 'table:/accounts', kind: 'table', label: 'accounts'},
      {id: 'view:/summary', kind: 'view', label: 'summary'},
      {id: 'column:summary/id', kind: 'column', label: 'id', data: {type: 'Int'}},
    ],
    relationships: [{id: 'contains:summary/id', kind: 'contains', from: 'view:/summary', to: 'column:summary/id'}],
  }
  const frame = createDatabaseTransition(extractionModel(extraction), [], {available: 1100})(1)
  const view = frame.tables.find(item => item.change.id === 'view:/summary')
  assert.deepEqual(
    view?.columns.map(column => column.entity.label),
    ['id'],
  )
  const markup = renderToStaticMarkup(createElement(DatabaseRenderer, props(extractionModel(extraction), 1, 0)))
  assert.match(markup, /aria-label="View summary"/)
  assert.match(markup, /class="database-kind">view</)
  assert.match(markup, /aria-label="Table accounts"/)
  // Table, column and type names are identifiers (monospace); the "view" kind stays sans.
  assert.match(markup, /data-projections-identifier=""><span class="database-line">summary<\/span>/)
  assert.match(markup, /data-projections-identifier=""><span class="database-line">id<\/span>/)
  assert.match(markup, /<code data-projections-identifier=""><span class="database-line">Int<\/span><\/code>/)
  assert.doesNotMatch(markup, /class="database-kind"[^>]*data-projections-identifier/)
})

test('Prisma and Django: keys live in their tables, single-column keys are column markers, and an enum is a card of its values', async () => {
  const {readFile} = await import('node:fs/promises')
  const load = async name => JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
  const prisma = await transitionOf(await load('prisma-shop-before'), await load('prisma-shop-after'))
  for (const progress of [0, 1]) {
    const frame = prisma.transition(progress)
    assert.deepEqual(frame.tags, [], `nothing floats free at ${progress}`)
    const line = tableCard(frame, '/OrderLine')
    const keys = line.columns.filter(row => row.kind === 'key').map(row => `${row.key.marker} ${row.key.text}`)
    assert.ok(keys.includes('PK orderId, productId'), `the composite primary key is a row of OrderLine: ${keys}`)
    // Its columns are foreign keys too: their markers read FK and stand for the foreign-key constraints.
    for (const column of line.columns.filter(row => row.kind === 'column' && row.role === 'pk-fk')) {
      assert.equal(column.marker.label, 'FK')
      assert.match(column.marker.key, /foreign-key/)
    }
    // Single-column primary keys are their column's PK marker, never a row.
    for (const card of frame.tables.filter(candidate => candidate.entity.kind === 'table')) {
      assert.ok(!card.columns.some(row => row.kind === 'key' && row.key.text === 'id'), `${card.entity.label} has no id key row`)
    }
  }
  const statusAt = progress => tableCard(prisma.transition(progress), 'enum:OrderStatus'.replace(/^table:/, ''))
  assert.deepEqual(
    statusAt(0).columns.map(row => row.entity.label),
    ['PENDING', 'PAID', 'SHIPPED'],
  )
  assert.deepEqual(
    statusAt(1).columns.map(row => [row.entity.label, row.change.status]),
    [
      ['PENDING', 'unchanged'],
      ['PAID', 'unchanged'],
      ['SHIPPED', 'unchanged'],
      ['CANCELLED', 'added'],
      ['REFUNDED', 'added'],
    ],
  )
  assert.ok(
    prisma.transition(1).links.some(link => link.type === 'enum' && link.principal === 'enum:OrderStatus'),
    'the status column links to its enum',
  )
  // The dropped unique on Customer.phone is a row of Customer that leaves.
  const customer = tableCard(prisma.transition(0), '/Customer')
  assert.ok(customer.columns.some(row => row.kind === 'key' && row.key.marker === 'UK' && row.key.text === 'phone'))

  const django = await transitionOf(await load('django-library-before'), await load('django-library-after'))
  const loan = tableCard(django.transition(1), 'catalog_loan')
  const rows = loan.columns.filter(row => row.kind === 'key').map(row => [row.key.marker, row.key.text, row.key.name])
  assert.deepEqual(rows.at(-1), ['IX', 'member_id, due', 'loan_member_due'])
  assert.deepEqual(django.transition(1).tags, [])
})

test('cards every stage shares keep their relative columns and order: added cards insert, nothing swaps', async () => {
  const {readFile} = await import('node:fs/promises')
  const read = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'))
  const scenarios = (await read('scenarios.json')).scenarios
  const pairs = await Promise.all(
    scenarios
      .filter(scenario => scenario.before && scenario.after)
      .map(async scenario => ({
        id: scenario.id,
        before: typeof scenario.before === 'string' ? await read(scenario.before) : scenario.before,
        after: typeof scenario.after === 'string' ? await read(scenario.after) : scenario.after,
      })),
  )
  assert.ok(pairs.some(pair => pair.id === 'prisma-shop') && pairs.some(pair => pair.id === 'django-library'))
  const sign = value => (Math.abs(value) < 0.5 ? 0 : Math.sign(value))
  for (const pair of pairs) {
    for (const available of [1100, 1440, 360]) {
      const {transition} = await transitionOf(pair.before, pair.after, {available})
      const layouts = transition.layouts
      for (const [a, b] of [...layouts.slice(1).map((layout, index) => [layouts[index], layout]), [layouts[0], layouts.at(-1)]]) {
        const shared = [...a.tables.keys()].filter(id => b.tables.has(id))
        for (const [index, first] of shared.entries()) {
          for (const second of shared.slice(index + 1)) {
            const box = (layout, id) => layout.tables.get(id)
            const column = layout => sign(box(layout, first).x - box(layout, second).x)
            const where = `${pair.id} at ${available}px: ${first} and ${second}`
            assert.equal(column(a), column(b), `${where} keep their relative columns`)
            if (column(a) === 0) {
              assert.equal(sign(box(a, first).y - box(a, second).y), sign(box(b, first).y - box(b, second).y), `${where} keep their order`)
            }
          }
        }
      }
    }
  }
  // The case that prompted this: Prisma's OrderStatus and Customer share a column and keep their order while Address arrives.
  const {transition} = await transitionOf(await read('fixtures/prisma-shop-before.json'), await read('fixtures/prisma-shop-after.json'))
  const order = progress => {
    const frame = transition(progress)
    const box = id => frame.tables.find(card => card.change.id === id).box
    assert.equal(box('enum:OrderStatus').x, box('table:/Customer').x)
    return Math.sign(box('enum:OrderStatus').y - box('table:/Customer').y)
  }
  assert.equal(order(0), order(1))
})

test('a key row is tall enough for its columns and name whole on a narrow card', async () => {
  const {readFile} = await import('node:fs/promises')
  const read = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'))
  const {transition} = await transitionOf(
    await read('fixtures/django-library-before.json'),
    await read('fixtures/django-library-after.json'),
    {
      available: 260,
    },
  )
  const loan = tableCard(transition(1), 'catalog_loan')
  const named = loan.columns.find(row => row.kind === 'key' && row.key.name === 'loan_member_due')
  assert.ok(named.height > schemaMetrics.row, 'the row grows to show its name under its columns')
  // Rows stack without overlapping, and the card holds them all.
  const rows = [...loan.columns].sort((a, b) => a.top - b.top)
  for (let index = 1; index < rows.length; index++) assert.ok(rows[index].top >= rows[index - 1].top + rows[index - 1].height - 1e-6)
  assert.ok(rows.at(-1).top + rows.at(-1).height <= loan.box.height + 1e-6)
})

test('every link in every frame is drafted from its tables where they are: legal ports, no reversal, no kink, no diagonal, no table crossed, turns as wide as the room allows', async () => {
  const {readFile} = await import('node:fs/promises')
  const {linkRadius, linkRoute} = await import('../node_modules/.cache/test/link-geometry.js')
  const {diagonalStraights, largestDeviation, largestKink, minimumRadius} = await import('../../kit/test/quality.mjs')
  const {arrowHeadReach} = await import('@githubnext/projections-renderer-kit')
  const load = async name => JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
  for (const name of ['prisma-shop', 'django-library']) {
    const [a, b] = await Promise.all([load(`${name}-before`), load(`${name}-after`)])
    // Desktop (columns) and a phone's width (one stack with gutter lanes), each way.
    for (const available of [1100, 360]) {
      for (const [from, to, direction] of [
        [a, b, 'forward'],
        [b, a, 'reverse'],
      ]) {
        const {transition} = await transitionOf(from, to, {available})
        const issues = new Set()
        for (let index = 0; index <= 100; index++) {
          const frame = transition(index / 100)
          const boxes = new Map(frame.tables.map(item => [item.change.id, item]))
          for (const link of frame.links) {
            const label = `${name} ${available} ${direction} ${link.key} at ${index}%`
            const route = linkRoute(link)
            const axis = {x: link.sides[0] === 'left' ? -1 : 1, y: 0}
            // A link between facing sides never doubles back; a lane or loop back to the same side turns twice the same way.
            if (link.sides[0] !== link.sides[1] && largestDeviation(route, axis) > 90.5) issues.add(`${label}: doubles back`)
            if (largestKink(route) >= 0.5) issues.add(`${label}: kink`)
            if (diagonalStraights(route).length) issues.add(`${label}: diagonal straight`)
            // Ports lie on the owning table's side, between its top and bottom, never on its top or bottom edge.
            for (const [point, table, side] of [
              [link.points[0], boxes.get(link.dependent), link.sides[0]],
              [link.points.at(-1), boxes.get(link.principal), link.sides[1]],
            ]) {
              if (!table) continue
              const x = side === 'left' ? table.box.x : table.box.x + table.box.width
              if (Math.abs(point.x - x) > 0.01 || point.y <= table.box.y || point.y >= table.box.y + table.box.height) {
                issues.add(`${label}: port off its table's ${side} side`)
              }
            }
            if (link.opacity < 0.05) continue
            // At rest, every turn is as wide as its room allows: a gap's S, or a lane's corner.
            if ((index === 0 || index === 100) && link.shape === 'curved' && link.points.length === 2) {
              const span = Math.abs(link.points[1].x - link.points[0].x) - arrowHeadReach
              const limit = Math.min(linkRadius, (span - 8) / 2 - Math.abs(link.tracks[0] ?? 0))
              if (Math.abs(link.points[1].y - link.points[0].y) > 0.5 && minimumRadius(route) < limit - 0.5) {
                issues.add(`${label}: radius ${minimumRadius(route).toFixed(1)} < ${limit.toFixed(1)}`)
              }
            }
            for (const other of frame.tables) {
              if (other.opacity < 0.05) continue
              const box = other.box
              const inside = route.some(
                (point, at) =>
                  at % 3 === 0 &&
                  point.x > box.x + 1 &&
                  point.x < box.x + box.width - 1 &&
                  point.y > box.y + 1 &&
                  point.y < box.y + box.height - 1,
              )
              if (inside) issues.add(`${label}: passes through ${other.change.id}`)
            }
          }
        }
        assert.deepEqual([...issues].slice(0, 10), [])
      }
    }
  }
})

test("diff mode's union draws every link as a revision does: legal ports, drafted S's on tracks, nothing crossed", async () => {
  const {readFile} = await import('node:fs/promises')
  const {linkRoute} = await import('../node_modules/.cache/test/link-geometry.js')
  const {createDatabaseDiff} = await import('../node_modules/.cache/test/diff.js')
  const {diagonalStraights, largestDeviation, largestKink} = await import('../../kit/test/quality.mjs')
  const load = async name => JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
  for (const name of ['prisma-shop', 'django-library']) {
    for (const available of [1100, 360]) {
      const [a, b] = await Promise.all([load(`${name}-before`), load(`${name}-after`)])
      const model = comparisonModel(a, b, await engine.compare(a, b))
      const {frame} = createDatabaseDiff(model, {available})
      assert.ok(frame.links.length > 0)
      const issues = []
      const boxes = new Map(frame.tables.map(item => [item.change.id, item.box]))
      for (const link of frame.links) {
        const label = `${name} ${available} diff ${link.key}`
        const route = linkRoute(link)
        if (link.sides[0] !== link.sides[1] && largestDeviation(route, {x: link.sides[0] === 'left' ? -1 : 1, y: 0}) > 90.5) {
          issues.push(`${label}: doubles back`)
        }
        if (largestKink(route) >= 0.5) issues.push(`${label}: kink`)
        if (diagonalStraights(route).length) issues.push(`${label}: diagonal straight`)
        if (link.shape === 'curved' && link.tracks.length !== link.points.length / 2) issues.push(`${label}: tracks`)
        for (const [point, id, side] of [
          [link.points[0], link.dependent, link.sides[0]],
          [link.points.at(-1), link.principal, link.sides[1]],
        ]) {
          const box = boxes.get(id)
          const x = side === 'left' ? box.x : box.x + box.width
          if (Math.abs(point.x - x) > 0.01 || point.y <= box.y || point.y >= box.y + box.height) issues.push(`${label}: port off its side`)
        }
        for (const [id, box] of boxes) {
          if (
            route.some(
              (point, at) =>
                at % 3 === 0 &&
                point.x > box.x + 1 &&
                point.x < box.x + box.width - 1 &&
                point.y > box.y + 1 &&
                point.y < box.y + box.height - 1,
            )
          ) {
            issues.push(`${label}: passes through ${id}`)
          }
        }
      }
      assert.deepEqual(issues.slice(0, 10), [])
    }
  }
})

test('links meeting one row on one side spread evenly over a band centred on its anchor, in the order they come from', async () => {
  const {readFile} = await import('node:fs/promises')
  const {createDatabaseDiff} = await import('../node_modules/.cache/test/diff.js')
  const {anchorY} = await import('../node_modules/.cache/test/geometry.js')
  const {portIssues} = await import('../../kit/test/quality.mjs')
  const {portSpacing} = await import('@githubnext/projections-renderer-kit')
  const load = async name => JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
  let spread = 0
  for (const name of ['prisma-shop', 'django-library']) {
    for (const available of [1100, 360]) {
      const [a, b] = await Promise.all([load(`${name}-before`), load(`${name}-after`)])
      const {transition, model} = await transitionOf(a, b, {available})
      const frames = [
        ['before', transition(0)],
        ['after', transition(1)],
        ['diff', createDatabaseDiff(model, {available}).frame],
      ]
      for (const [label, frame] of frames) {
        const tables = new Map(frame.tables.map(item => [item.change.id, item]))
        const groups = new Map()
        for (const link of frame.links) {
          for (const [end, table, column, side, point, next] of [
            ['from', link.dependent, link.dependentColumn, link.sides[0], link.points[0], link.points[1]],
            ['to', link.principal, link.principalColumn, link.sides[1], link.points.at(-1), link.points.at(-2)],
          ]) {
            const key = `${table}\u0000${column ?? ''}\u0000${side}`
            groups.set(key, [...(groups.get(key) ?? []), {table, column, y: point.y, approach: next.y, end, link: link.key}])
          }
        }
        for (const [key, ends] of groups) {
          const card = tables.get(ends[0].table)
          if (!card) continue
          const row = ends[0].column === undefined ? undefined : card.columns.find(item => item.change.id === ends[0].column)
          const anchor = anchorY(card.box, row?.top, card.header)
          const top = row ? card.box.y + row.top : card.box.y
          const ordered = [...ends].sort(
            (p, q) => p.approach - q.approach || (p.link < q.link ? -1 : p.link > q.link ? 1 : p.end < q.end ? -1 : 1),
          )
          if (ends.length > 1) spread++
          assert.deepEqual(
            portIssues(
              ordered.map(end => end.y),
              anchor,
              2 * (anchor - top),
              portSpacing,
              6,
            ),
            [],
            `${name} ${available} ${label}: ${key.replaceAll('\u0000', ' ')}`,
          )
        }
      }
    }
  }
  assert.ok(spread > 0, 'some row has several links')
})

test('tables that reference each other still take ranks of their own, so no link joins two cards of one rank', async () => {
  const {layerDepths} = await import('../node_modules/.cache/test/schema-model.js')
  // users ⇄ licenses and users ⇄ stores reference each other; purchases reference all three.
  const depth = layerDepths(
    ['licenses', 'purchases', 'stores', 'users'],
    [
      {from: 'users', to: 'licenses'},
      {from: 'licenses', to: 'users'},
      {from: 'users', to: 'stores'},
      {from: 'stores', to: 'users'},
      {from: 'users', to: 'purchases'},
      {from: 'stores', to: 'purchases'},
      {from: 'licenses', to: 'purchases'},
    ],
  )
  for (const [from, to] of [
    ['users', 'licenses'],
    ['users', 'stores'],
  ]) {
    assert.notEqual(depth.get(from), depth.get(to), `${from} and ${to} share a rank`)
  }
  assert.ok(depth.get('purchases') > Math.max(depth.get('users'), depth.get('stores'), depth.get('licenses')))
})

test('where a cycle is broken depends on the graph alone, not on the order its tables and links are listed', async () => {
  const {layerDepths} = await import('../node_modules/.cache/test/schema-model.js')
  // b ⇄ c in one revision, a → b and c → a added in the other: a comparison lists one revision's links first.
  const cycleLinks = [
    {from: 'b', to: 'c'},
    {from: 'c', to: 'b'},
  ]
  const brokenLinks = [
    {from: 'a', to: 'b'},
    {from: 'c', to: 'a'},
  ]
  const forward = layerDepths(['b', 'c', 'a'], [...cycleLinks, ...brokenLinks])
  const reverse = layerDepths(['a', 'c', 'b'], [...after, ...before].reverse())
  assert.deepEqual(new Map([...reverse].sort()), new Map([...forward].sort()))
})
