import {test} from 'node:test'
import assert from 'node:assert/strict'
import {customRendererPrefix, snapshotSettings} from '../dist/ui/snapshot/settings.js'

test('snapshot settings come from the query string, with light theme, the card frame and no explicit mode or progress by default', () => {
  assert.deepEqual(snapshotSettings('?view=snapshot'), {theme: 'light', frame: 'card', withheld: false})
  const commit = 'a'.repeat(40)
  assert.deepEqual(snapshotSettings(`?view=snapshot&theme=dark&mode=side-by-side&progress=0.25&definition=${commit}&withheld=1`), {
    theme: 'dark',
    frame: 'card',
    withheld: true,
    progress: 0.25,
    mode: 'side-by-side',
    definition: commit,
  })
  assert.equal(snapshotSettings('?progress=0').progress, 0)
  assert.equal(snapshotSettings('?definition=working-tree').definition, 'working-tree')
  // --focus, --entity and --fit become the renderers' focus.
  assert.deepEqual(snapshotSettings('?focus=changes&fit=1').focus, {on: 'changes', fit: true})
  assert.deepEqual(snapshotSettings('?entity=service%3Aapi').focus, {id: 'service:api'})
  assert.equal(snapshotSettings('?frame=none').frame, 'none')
  assert.equal(snapshotSettings('?frame=card&matte=%230d1117').matte, '#0d1117')
  assert.equal(snapshotSettings('?direction=backward').direction, -1)
  assert.equal(snapshotSettings('?direction=forward').direction, 1)
  assert.equal(snapshotSettings('?turn=80').turnFrameMs, 80)
})

test('snapshot settings reject anything the CLI never sends', () => {
  assert.throws(() => snapshotSettings('?theme=sepia'), /theme/)
  assert.throws(() => snapshotSettings('?mode=swipe'), /mode/)
  for (const progress of ['2', '-0.1', '', 'NaN', 'one']) assert.throws(() => snapshotSettings(`?progress=${progress}`), /progress/)
  assert.throws(() => snapshotSettings('?definition=HEAD'), /full commit/)
  assert.throws(() => snapshotSettings('?focus=middle'), /focus/)
  assert.throws(() => snapshotSettings('?entity='), /entity/)
  assert.throws(() => snapshotSettings('?frame=polaroid'), /frame/)
  for (const matte of ['white', '#12345', '0d1117']) assert.throws(() => snapshotSettings(`?matte=${encodeURIComponent(matte)}`), /matte/)
  assert.throws(() => snapshotSettings('?frame=none&matte=%23fff'), /matte/)
  assert.throws(() => snapshotSettings('?direction=sideways'), /direction/)
  for (const turn of ['0', '', 'NaN', '1001']) assert.throws(() => snapshotSettings(`?turn=${turn}`), /turn/)
})

test('the custom renderer prefix must be a same-origin directory, and is absent when the server serves none', () => {
  const origin = 'http://127.0.0.1:4100'
  assert.equal(
    customRendererPrefix({renderers: [], customRendererBase: '/custom-renderers/ab12/'}, origin),
    `${origin}/custom-renderers/ab12/`,
  )
  assert.equal(customRendererPrefix({renderers: [], customRendererBase: null}, origin), undefined)
  assert.equal(customRendererPrefix({renderers: []}, origin), undefined)
  for (const base of ['https://example.com/x/', '/custom-renderers/ab12', '/x/?q=1', 7])
    assert.throws(() => customRendererPrefix({customRendererBase: base}, origin), /custom renderer base/)
})
