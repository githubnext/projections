import {test} from 'node:test'
import assert from 'node:assert/strict'
// `npm test` compiles src/ (without the browser entry) to this cache directory first.
import {createTextSizer, estimateText, segments, subsegments, textMetrics, wrapText} from '../node_modules/.cache/test/text.js'

const mono = text => text.length * 8

test('names break after separators first, then at case and digit changes, and rejoin to themselves', () => {
  assert.deepEqual(segments('loan_member_due'), ['loan_', 'member_', 'due'])
  assert.deepEqual(segments('OrderStatus'), ['OrderStatus'])
  assert.deepEqual(subsegments('OrderStatus'), ['Order', 'Status'])
  assert.deepEqual(segments('varchar(200)'), ['varchar', '(200)'])
  assert.deepEqual(segments('IX_Users_OrganizationId'), ['IX_', 'Users_', 'OrganizationId'])
  assert.deepEqual(subsegments('line12'), ['line', '12'])
  assert.deepEqual(segments('app.kubernetes.io/part-of'), ['app.', 'kubernetes.', 'io/', 'part-', 'of'])
  for (const text of ['ExternalSettlementReferenceIdentifierFromUpstreamClearingHouse', 'member_id, due', 'x', 'enum:OrderStatus']) {
    assert.equal(segments(text).join(''), text)
  }
})

test('wrapping fills lines greedily at break points, and breaks a piece longer than a line between characters', () => {
  assert.deepEqual(wrapText('OrderStatus', 200, mono), ['OrderStatus'])
  assert.deepEqual(wrapText('loan_member_due', 64, mono), ['loan_', 'member_', 'due'])
  assert.deepEqual(wrapText('loan_member_due', 100, mono), ['loan_member_', 'due'])
  assert.deepEqual(wrapText('Supercalifragilistic', 64, mono), ['Supercal', 'ifragili', 'stic'])
  // A separator wins over a case change: `orderId, productId` breaks after the comma, not inside `productId`.
  assert.deepEqual(wrapText('orderId, productId', 128, mono), ['orderId, ', 'productId'])
  assert.deepEqual(wrapText('shippingAddressId', 96, mono), ['shipping', 'AddressId'])
  for (const room of [24, 40, 64, 100, 300]) {
    const lines = wrapText('ExternalSettlementReferenceIdentifier_FromUpstream', room, mono)
    assert.equal(lines.join(''), 'ExternalSettlementReferenceIdentifier_FromUpstream')
    for (const line of lines) assert.ok(mono(line) <= room || line.length === 1, `${line} fits ${room}`)
  }
})

test('a card is sized for its header (name, kind label and status cell) and rows on one line; narrower, rows and headers grow', () => {
  const sizer = createTextSizer(
    id => (id === 'enum' ? [{label: 'OrderStatus', kind: 'enum'}] : [{label: 'catalog_loan'}]),
    id =>
      id === 'key'
        ? [{kind: 'key', text: 'member_id, due', name: 'loan_member_due'}]
        : [
            {kind: 'column', name: 'title', type: 'varchar(120)'},
            {kind: 'column', name: 'title', type: 'varchar(200)'},
          ],
    estimateText,
  )
  const need = sizer.cardNeed('enum', ['column'])
  // Wide enough: one-line header and rows.
  assert.equal(sizer.header('enum', need), textMetrics.header)
  assert.equal(sizer.row('column', need), 2 * textMetrics.rowPad + textMetrics.line)
  // The OrderStatus header needs its name, the enum label and the status cell: more than its name alone.
  assert.ok(need > estimateText('name', 'OrderStatus') + estimateText('kind', 'enum'))
  // Narrow: the header wraps with its kind and status under the name; the key row puts its name under its columns.
  assert.ok(sizer.header('enum', 140) > textMetrics.header)
  assert.ok(sizer.row('key', 180) >= 2 * textMetrics.rowPad + 2 * textMetrics.line)
})
