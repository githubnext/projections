// Unit tests of how one switch of the Viewing choice becomes one update (`updates.ts`): a burst of requests runs once,
// only changes are passed on, summaries are kept by pair, and a report about an earlier switch is stale.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {changed, coalesce, PairSummaries, Switches} from '../src/updates.ts'

/** Timers run by hand. */
function manual() {
  const pending = new Set()
  return {
    timers: {
      set: run => {
        const timer = {run}
        pending.add(timer)
        return timer
      },
      clear: timer => pending.delete(timer),
    },
    tick() {
      for (const timer of [...pending]) {
        pending.delete(timer)
        timer.run()
      }
    },
    get size() {
      return pending.size
    },
  }
}

test('a burst of requests runs once, after it', () => {
  const clock = manual()
  let runs = 0
  const update = coalesce(() => runs++, {timers: clock.timers})
  update.request()
  update.request()
  update.request()
  assert.equal(runs, 0)
  assert.equal(clock.size, 1)
  clock.tick()
  assert.equal(runs, 1)
  // A request made while it runs (an update that causes another) is the next burst's.
  update.request()
  clock.tick()
  assert.equal(runs, 2)
  clock.tick()
  assert.equal(runs, 2)
})

test('flush runs a requested update at once, and only then', () => {
  const clock = manual()
  let runs = 0
  const update = coalesce(() => runs++, {timers: clock.timers})
  update.flush()
  assert.equal(runs, 0)
  update.request()
  assert.equal(update.pending, true)
  update.flush()
  assert.equal(runs, 1)
  assert.equal(update.pending, false)
  clock.tick()
  assert.equal(runs, 1)
  update.request()
  update.dispose()
  clock.tick()
  assert.equal(runs, 1)
})

test('only a change is passed on', () => {
  const shown = changed()
  assert.equal(shown([{label: 'Current state', checked: true}]), true)
  assert.equal(shown([{label: 'Current state', checked: true}]), false)
  assert.equal(shown([{label: 'Current state', checked: false}]), true)
  assert.equal(shown(undefined), true)
  assert.equal(shown(undefined), false)
})

test('summaries are kept by pair, so a pair shown again has its counts at once', () => {
  const summaries = new PairSummaries(2)
  const uncommitted = {before: 'HEAD', after: 'working-tree'}
  const now = {after: 'working-tree'}
  summaries.set('packages', {pair: uncommitted, status: 'ok', comparison: {compared: true, rows: 4, changes: {added: 1}}})
  // Switching to a pair never reported: extracting, until its tab reports it.
  assert.equal(summaries.switching('packages', now), true)
  assert.equal(summaries.get('packages', now).status, 'extracting')
  summaries.set('packages', {pair: now, status: 'ok'})
  // Switching back: its counts at once, nothing changes.
  assert.equal(summaries.switching('packages', uncommitted), false)
  assert.deepEqual(summaries.get('packages', uncommitted).comparison.changes, {added: 1})
  assert.equal(summaries.get('packages', {before: 'main', after: 'working-tree'}), undefined)
  assert.equal(summaries.get('other', uncommitted), undefined)
  assert.equal(summaries.get('packages', undefined), undefined)
  // The most recent pairs are kept.
  summaries.set('packages', {pair: {before: 'main', after: 'HEAD'}, status: 'ok'})
  assert.equal(summaries.get('packages', now), undefined)
  assert.ok(summaries.get('packages', uncommitted))
  // A change in the repository keeps the shown pair's only; a closing tab forgets the pairs it was extracting.
  summaries.keepOnly(uncommitted)
  assert.equal(summaries.get('packages', {before: 'main', after: 'HEAD'}), undefined)
  assert.ok(summaries.get('packages', uncommitted))
  summaries.switching('packages', now)
  summaries.delete('packages', summary => summary.status === 'extracting')
  assert.equal(summaries.get('packages', now), undefined)
  assert.ok(summaries.get('packages', uncommitted))
  summaries.delete('packages')
  assert.equal(summaries.get('packages', uncommitted), undefined)
})

test("a report about an earlier switch is stale; a page that wasn't switched since it loaded is current", () => {
  const switches = new Switches()
  assert.equal(switches.current(undefined), true)
  const first = switches.next()
  const second = switches.next()
  assert.equal(second, first + 1)
  assert.equal(switches.current(first), false)
  assert.equal(switches.current(second), true)
  assert.equal(switches.current(undefined), true)
})
