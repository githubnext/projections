import {test} from 'node:test'
import assert from 'node:assert/strict'
import {statusText} from '../dist/ui/viewer/state.js'

const state = {projection: 'di-hero'}

test("an extraction leaves the viewer's status line empty: the stage says so", () => {
  assert.equal(statusText(state, {status: 'extracting'}), '')
})

test('a failed extraction and a missing trust still say so in the status line', () => {
  assert.match(statusText(state, {status: 'failed'}), /extractor didn't run/u)
  assert.equal(statusText(state, {status: 'trust'}), 'Needs trust')
})
