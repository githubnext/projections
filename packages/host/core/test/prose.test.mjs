import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {Prose, TableView, TextView} from '../dist/ui/index.js'
import {subjectRows} from '../dist/index.js'

test('Prose draws marked inline code in the code font and never shows the markers', () => {
  const markup = renderToStaticMarkup(createElement(Prose, null, 'Parameter `currency` was renamed to `<b>`'))
  assert.equal(
    markup,
    'Parameter <code class="ph-code pj:font-mono pj:text-[0.92em]">currency</code> was renamed to <code class="ph-code pj:font-mono pj:text-[0.92em]">&lt;b&gt;</code>',
  )
})

test('the table and text views draw change and step summaries as prose with inline code', () => {
  const extraction = entities => ({protocolVersion: 0, schema: 'api/v0', entities, relationships: []})
  const before = extraction([{id: 'pay', kind: 'method', label: 'Pay', data: {signature: 'Pay(string currency)'}}])
  const after = extraction([{id: 'pay', kind: 'method', label: 'Pay', data: {signature: 'Pay(string currencyCode)'}}])
  const comparison = {
    protocolVersion: 0,
    changes: [
      {
        id: 'pay',
        collection: 'entities',
        before: ['pay'],
        after: ['pay'],
        status: 'modified',
        correspondence: 'exact',
        summary: 'Breaking: `currency` was renamed.',
      },
    ],
    steps: [{changes: ['pay'], summary: 'Rename `currency`'}],
  }
  const subject = {mode: 'comparison', before, after, comparison}
  const rows = subjectRows(subject)
  const props = {subject, rows, selectedId: null, onSelect() {}, progress: 1}
  const code = '<code class="ph-code pj:font-mono pj:text-[0.92em]">currency</code>'
  for (const view of [TableView, TextView]) {
    const markup = renderToStaticMarkup(createElement(view, props))
    assert.ok(markup.includes(code), `${view.name}: ${markup}`)
    assert.ok(!markup.includes('`'), `${view.name} shows a code marker`)
  }
})
