import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {isChanged, presentedEmphasis, statusParts} from '../dist/index.js'
import {Badge, ChangeFooter, ChangeStatus, StatusTab, SvgChangeStatus, VariedMarker} from '../dist/react.js'

const beyond = {status: 'modified', varied: [{path: '/data/durationMs', within: false}]}
const withinModified = {status: 'modified', varied: [{path: '/data/durationMs', within: true}]}
const within = {status: 'unchanged', varied: [{path: '/data/durationMs', within: true}]}
const html = element => renderToStaticMarkup(element)
const markers = markup => (markup.match(/data-varied="beyond"/g) ?? []).length

test('a modified change with a volatile value beyond tolerance shows the neutral volatile marker beside its status', () => {
  for (const component of [ChangeFooter, ChangeStatus, StatusTab]) {
    const markup = html(createElement(component, {change: beyond, emphasis: 1}))
    assert.equal(markers(markup), 1, component.name)
    assert.match(markup, /data-icon="varied"/)
    assert.match(markup, /Modified/)
  }
  const footer = html(createElement(ChangeFooter, {change: beyond, emphasis: 1}))
  assert.match(footer, /role="img" aria-label="Volatile field changed beyond tolerance"/)
  // Neutral: no change hue on the marker itself.
  assert.doesNotMatch(footer, /pk-varied[^"]*(added|removed|modified|renamed)/)
  const badge = html(createElement(Badge, {status: 'modified', varied: beyond.varied}))
  assert.equal(markers(badge), 1)
  const svg = html(createElement('svg', null, createElement(SvgChangeStatus, {change: beyond, emphasis: 1, x: 0, y: 20})))
  assert.equal(markers(svg), 1)
  assert.match(svg, /<title>Volatile field changed beyond tolerance<\/title>/)
})

test('the marker is absent without a value beyond tolerance, and at zero emphasis', () => {
  for (const change of [withinModified, {status: 'modified'}, {status: 'added'}, within]) {
    for (const component of [ChangeFooter, ChangeStatus, StatusTab])
      assert.equal(markers(html(createElement(component, {change, emphasis: 1}))), 0, `${component.name} ${JSON.stringify(change)}`)
    const svg = html(createElement('svg', null, createElement(SvgChangeStatus, {change, emphasis: 1, x: 0, y: 20})))
    assert.equal(markers(svg), 0)
  }
  for (const component of [ChangeFooter, ChangeStatus])
    assert.equal(markers(html(createElement(component, {change: beyond, emphasis: 0}))), 0)
  assert.equal(html(createElement(VariedMarker, {emphasis: 0})), '')
  assert.equal(html(createElement(VariedMarker, {change: withinModified})), '')
})

test('an item that varied only within tolerance is neutral: no status, no emphasis', () => {
  assert.equal(isChanged(within), false)
  assert.deepEqual(statusParts(within), [])
  assert.equal(presentedEmphasis(within, 1), 0)
  for (const component of [ChangeFooter, ChangeStatus]) {
    const markup = html(createElement(component, {change: within, emphasis: 1}))
    assert.doesNotMatch(markup, /data-change-status|data-varied/)
  }
  assert.equal(html(createElement(Badge, {status: 'unchanged', varied: within.varied, emphasis: 0})), '')
})
