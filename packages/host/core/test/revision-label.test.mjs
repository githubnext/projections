import {test} from 'node:test'
import assert from 'node:assert/strict'
import {formatRevisionLabel, parseRevisionLabel, revisionAge, revisionLabelName} from '../dist/index.js'

test('a revision label is its name, detail and age, and reads back into them', () => {
  const label = formatRevisionLabel({name: 'main', detail: '"Add auth · login"', when: '2 days ago'})
  assert.equal(label, 'main · "Add auth · login" · 2 days ago')
  assert.deepEqual(parseRevisionLabel(label), {name: 'main', detail: '"Add auth · login"', subject: 'Add auth · login', when: '2 days ago'})
  assert.deepEqual(parseRevisionLabel('feature/x · 1a2b3c4d'), {name: 'feature/x', detail: '1a2b3c4d'})
  assert.deepEqual(parseRevisionLabel('Working tree'), {name: 'Working tree'})
  assert.equal(revisionLabelName('v3 · latest push'), 'v3')
})

test('a revision’s age is coarse, and absent without a date', () => {
  const now = Date.parse('2026-11-20T12:00:00Z')
  assert.equal(revisionAge('2026-11-20T11:59:30Z', now), 'just now')
  assert.equal(revisionAge('2026-11-20T11:55:00Z', now), '5 minutes ago')
  assert.equal(revisionAge('2026-11-18T12:00:00Z', now), '2 days ago')
  assert.equal(revisionAge(undefined, now), undefined)
  assert.equal(revisionAge('not a date', now), undefined)
})
