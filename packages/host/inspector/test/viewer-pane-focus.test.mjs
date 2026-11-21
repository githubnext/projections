// Focus between the viewer's projections pane and the title's menu (`viewer/pane-focus.ts`): pinning, closing, the page
// narrowing and widening past the pane's room, and the server going away.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {explore} from '@githubnext/projections-machine/testing'
import {paneFocusMachine} from '../dist/ui/viewer/pane-focus.js'

const places = ['pane', 'menu']
const events = [
  {type: 'pinned'},
  {type: 'closed'},
  {type: 'taken'},
  {type: 'stopped'},
  ...places.flatMap(place => [
    {type: 'entered', place},
    {type: 'left', place},
    ...[true, false].flatMap(lost => [true, false].map(replaced => ({type: 'gone', place, lost, replaced}))),
  ]),
]

test('focus moves between the pane and the menu only as the person or the page asks', () => {
  explore(paneFocusMachine, {
    from: {kind: 'elsewhere'},
    events,
    transitions: {
      'pinning asks the pane to take focus, closing the menu': ({event, to}) =>
        (event.type !== 'pinned' || to.kind === 'toPane') && (event.type !== 'closed' || to.kind === 'toMenu'),
      'a place that goes away holding focus hands it on only where it was lost and the other is there': ({from, event, to}) =>
        event.type !== 'gone' ||
        from.kind !== event.place ||
        (event.lost && event.replaced ? to.kind === (event.place === 'pane' ? 'toMenu' : 'toPane') : to.kind === 'elsewhere'),
      'a place that goes away without focus moves nothing': ({from, event, to}) =>
        event.type !== 'gone' || from.kind === event.place || to === from,
      'focus that left for elsewhere never waits to come back': ({from, event, to}) =>
        event.type !== 'left' || !['pane', 'menu'].includes(from.kind) || to.kind === 'elsewhere' || to === from,
      'nothing waits once the server stops': ({event, to}) => event.type !== 'stopped' || !to.kind.startsWith('to'),
    },
    complete: true,
  })
})

test("narrowing hands the pane's focus to the menu; widening hands it back", () => {
  const run = (...steps) => steps.reduce((state, event) => paneFocusMachine.transition(state, event).state, {kind: 'elsewhere'})
  assert.deepEqual(
    run({type: 'pinned'}, {type: 'entered', place: 'pane'}, {type: 'taken'}, {type: 'gone', place: 'pane', lost: true, replaced: true}),
    {kind: 'toMenu'},
  )
  assert.deepEqual(
    run({type: 'entered', place: 'menu'}, {type: 'gone', place: 'menu', lost: true, replaced: true}, {type: 'entered', place: 'pane'}),
    {kind: 'pane'},
  )
  // With the server gone, the menu isn't there to take it: nothing waits to steal focus later.
  assert.deepEqual(run({type: 'entered', place: 'pane'}, {type: 'gone', place: 'pane', lost: true, replaced: false}), {
    kind: 'elsewhere',
  })
})
