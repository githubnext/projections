// Unit tests of the status bar item's readout of the Viewing choice (`choices/`): the mark and the choice's
// short name, no hashes or counts, subjects cut at about 24 characters, refs before hashes, a warning when the tab in front is out of date,
// a spinner instead while its job runs (shown after a moment, for at least a moment: `runningIndicator`), and the details in the
// tooltip; loaded from source with Node's type stripping.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {refreshPickLabel, statusItem, statusShown} from '../src/choices/status.ts'
import {statusName, truncate} from '../src/choices/status-names.ts'
import {runningIndicator} from '@githubnext/projections-host-vscode/running'

const head = 'a'.repeat(40)
const base = 'b'.repeat(40)
const other = 'c'.repeat(40)
const facts = {
  head,
  branch: 'feature/auth',
  defaultBranch: 'main',
  mergeBase: base,
  dirty: true,
  changes: 2,
  ahead: 3,
  suggestions: [{before: 'v1.0', after: 'HEAD', label: 'v1.0 → HEAD', source: 'tag'}],
  bookmarks: [{id: 'landed', before: 'v1.0', after: base, label: 'Move the session store into the auth package', source: 'bookmark'}],
}
const item = (choice, pair, extra = {}) => statusItem({defines: true, choice, facts, pair, ...extra})
const label = (ref, kind, name, commit) => ({ref, kind, name, ...(commit ? {commit} : {})})

test('each choice reads as its short name after the mark, with no hashes or counts', () => {
  assert.equal(item({id: 'now'}, {after: 'working-tree'}).text, '$(projections-mark) Current state')
  assert.equal(
    item({id: 'uncommitted'}, {before: 'HEAD', after: 'working-tree'}, {files: 2}).text,
    '$(projections-mark) Uncommitted changes',
  )
  assert.equal(item({id: 'branch'}, {before: base, after: 'working-tree'}, {files: 9}).text, '$(projections-mark) Branch changes')
  assert.equal(
    item({id: 'pr:123', pair: {before: base, after: head}, title: '#123 Fix the login'}, {before: base, after: head}).text,
    '$(projections-mark) PR #123',
  )
  assert.equal(item({id: 'last-commit'}, {before: 'HEAD~1', after: 'HEAD'}).text, '$(projections-mark) Last commit')
  assert.equal(item({id: 'release'}, {before: 'v1.0', after: 'HEAD'}).text, '$(projections-mark) Since v1.0')
})

test('a bookmark or a recent change is its subject, cut at about 24 characters with an ellipsis', () => {
  assert.equal(truncate('Add auth package', 24), 'Add auth package')
  assert.equal(truncate('x'.repeat(24), 24), 'x'.repeat(24))
  assert.equal(truncate('Move the session store into the auth package', 24), 'Move the session store…')
  assert.equal(Array.from(truncate('Move the session store into the auth package', 24)).length <= 24, true)
  assert.equal(item({id: 'bookmark:landed'}, {before: 'v1.0', after: base}).text, '$(projections-mark) Move the session store…')
  const recent = {id: `pair:${base}..${head}`, pair: {before: base, after: head}, title: 'Rename every package to its scope'}
  assert.equal(item(recent, recent.pair).text, '$(projections-mark) Rename every package to…')
  assert.doesNotMatch(item(recent, recent.pair).text, /[0-9a-f]{7}/u)
})

test('two revisions read by their ref names, a short commit only where nothing names one', () => {
  const custom = pair => ({id: 'custom', pair})
  const named = {before: label('main', 'branch', 'main', base), after: label('HEAD', 'branch', 'feature/x', head)}
  assert.equal(statusName(custom({before: 'main', after: 'HEAD'}), facts, {before: 'main', after: 'HEAD'}, named), 'main → feature/x')
  // Before git names them: the refs as given.
  assert.equal(statusName(custom({before: 'main', after: 'v2'}), facts, {before: 'main', after: 'v2'}), 'main → v2')
  const bare = {before: label(other, 'commit', other.slice(0, 8), other), after: label('working-tree', 'working-tree', 'Working tree')}
  assert.equal(
    statusName(custom({before: other, after: 'working-tree'}), facts, {before: other, after: 'working-tree'}, bare),
    'ccccccc → your files',
  )
  const long = {before: label('main', 'branch', 'main'), after: label('x', 'branch', 'feature/a-very-long-branch-name')}
  assert.equal(statusName(custom({before: 'main', after: 'x'}), facts, {before: 'main', after: 'x'}, long), 'main → feature/a-very-long…')
})

test('the tooltip carries the exact revisions with their commits, the span and the files changed', () => {
  const labels = {
    before: label(base, 'merge-base', 'merge base with main', base),
    after: label('working-tree', 'working-tree', 'Working tree'),
  }
  const {tooltip, accessibility} = item({id: 'branch'}, {before: base, after: 'working-tree'}, {labels, files: 9})
  assert.match(tooltip, /^\*\*Branch changes\*\*/u)
  assert.match(tooltip, /merge base with main \x60bbbbbbb\x60 → your files/u)
  assert.match(tooltip, /3 commits \+ 2 uncommitted · 9 files changed/u)
  assert.match(tooltip, /Click to choose what projections show\.$/u)
  assert.equal(accessibility, 'Projections: viewing Branch changes')
  const pull = item({id: 'pr:123', title: '#123 Fix the login'}, {before: base, after: head})
  assert.match(pull.tooltip, /^\*\*PR \\#123\*\*\n\nFix the login\n\n\x60bbbbbbb\x60 → \x60aaaaaaa\x60/u)
  assert.match(item({id: 'now'}, {after: 'working-tree'}).tooltip, /your files, as they are now/u)
  assert.match(
    item({id: 'bookmark:landed'}, {before: 'v1.0', after: base}).tooltip,
    /^\*\*Bookmark: Move the session store into the auth package\*\*/u,
  )
  const pinned = item({id: 'branch'}, {before: base, after: 'working-tree'}, {pinned: {title: 'Packages', name: 'PR #7'}})
  assert.match(pinned.tooltip, /Packages is pinned to PR \\#7; it doesn't follow this\./u)
})

test('the tab in front out of date ends the item with a warning; the tooltip says why and how many', () => {
  const stale = item({id: 'branch'}, {before: base, after: 'working-tree'}, {stale: 2, front: {title: 'Packages', files: 19}})
  assert.equal(stale.text, '$(projections-mark) Branch changes $(warning)')
  assert.match(stale.tooltip, /Packages is out of date: 19 files changed since its result\. Click to refresh it\./u)
  assert.match(stale.tooltip, /2 projections are out of date: the files changed since their result\. Refresh their tabs/u)
  assert.equal(stale.accessibility, 'Projections: viewing Branch changes, out of date')
  // Other tabs out of date, the one in front current: no warning, the count stays in the tooltip.
  const others = item({id: 'branch'}, {before: base, after: 'working-tree'}, {stale: 1})
  assert.equal(others.text, '$(projections-mark) Branch changes')
  assert.equal(others.accessibility, 'Projections: viewing Branch changes')
  assert.match(others.tooltip, /1 projection is out of date/u)
})

test("the tab in front's job ends the item with a spinner, in the warning's place; the tooltip and label say what it does", () => {
  const pair = {before: base, after: 'working-tree'}
  const extracting = item({id: 'branch'}, pair, {
    running: {title: 'Packages', kind: 'extracting'},
  })
  assert.equal(extracting.text, '$(projections-mark) Branch changes $(sync~spin)')
  assert.match(extracting.tooltip, /\n\nPackages: Extracting…\n/u)
  assert.equal(extracting.accessibility, 'Projections: viewing Branch changes, extracting')
  const comparing = item({id: 'branch'}, pair, {
    running: {title: 'Packages', kind: 'comparing'},
  })
  assert.match(comparing.tooltip, /Packages: Comparing…/u)
  assert.equal(comparing.accessibility, 'Projections: viewing Branch changes, comparing')
  // Running takes precedence over out of date (a Refresh): no warning, and no "Click to refresh it" meanwhile.
  const refreshing = item({id: 'branch'}, pair, {
    running: {title: 'Packages', kind: 'extracting'},
    front: {title: 'Packages', files: 19},
    stale: 1,
  })
  assert.equal(refreshing.text, '$(projections-mark) Branch changes $(sync~spin)')
  assert.doesNotMatch(refreshing.tooltip, /Click to refresh it/u)
  assert.match(refreshing.tooltip, /1 projection is out of date/u)
  assert.equal(refreshing.accessibility, 'Projections: viewing Branch changes, extracting')
  // Under reduced motion the icon holds still.
  assert.equal(
    item({id: 'branch'}, pair, {
      running: {title: 'Packages', kind: 'extracting', still: true},
    }).text,
    '$(projections-mark) Branch changes $(sync)',
  )
  // Other tabs' jobs don't spin it; the tooltip counts them.
  const others = item({id: 'branch'}, pair, {
    others: ['extracting', 'comparing'],
  })
  assert.equal(others.text, '$(projections-mark) Branch changes')
  assert.equal(others.accessibility, 'Projections: viewing Branch changes')
  assert.match(others.tooltip, /\n\n2 other tabs extracting\.\n/u)
  assert.match(item({id: 'branch'}, pair, {others: ['comparing']}).tooltip, /\n\n1 other tab comparing\.\n/u)
})

/** Timers on a clock the test moves (`advance`), for `runningIndicator`. */
function fakeClock() {
  let now = 0
  let timers = []
  return {
    timers: {
      now: () => now,
      set: (run, ms) => {
        const timer = {at: now + ms, run}
        timers.push(timer)
        return timer
      },
      clear: timer => (timers = timers.filter(pending => pending !== timer)),
    },
    /** Moves the clock to `to`, firing the timers due on the way, in order. */
    advance(to) {
      for (;;) {
        const next = timers.filter(timer => timer.at <= to).sort((a, b) => a.at - b.at)[0]
        if (!next) break
        timers = timers.filter(timer => timer !== next)
        now = next.at
        next.run()
      }
      now = to
    },
  }
}

/** What the indicator shows at each of `times` (ms), for a job that starts at 0 and ends at `end`. */
function shownAt(end, times) {
  const clock = fakeClock()
  const indicator = runningIndicator(() => {}, {timers: clock.timers})
  indicator.set('extracting')
  const events = [...times.map(at => ({at, read: true})), {at: end, read: false}].sort((a, b) => a.at - b.at || a.read - b.read)
  const shown = {}
  for (const event of events) {
    clock.advance(event.at)
    if (event.read) shown[event.at] = indicator.current ?? null
    else indicator.set(undefined)
  }
  return shown
}

test('a job shows after 300 ms, so a 200 ms job never does; once shown it stays at least 400 ms', () => {
  assert.deepEqual(shownAt(200, [0, 100, 199, 250, 300, 1000]), {
    0: null,
    100: null,
    199: null,
    250: null,
    300: null,
    1000: null,
  })
  // A 350 ms job shows from 300 ms to 700 ms.
  assert.deepEqual(shownAt(350, [299, 300, 350, 699, 700]), {
    299: null,
    300: 'extracting',
    350: 'extracting',
    699: 'extracting',
    700: null,
  })
  // A long job shows until it ends.
  assert.deepEqual(shownAt(2000, [1999, 2000]), {
    1999: 'extracting',
    2000: null,
  })
})

test('a job that starts again while shown keeps it; a new kind of work shows at once; onChange only from the timers', () => {
  const clock = fakeClock()
  let changes = 0
  const indicator = runningIndicator(() => changes++, {timers: clock.timers})
  indicator.set('extracting')
  assert.equal(changes, 0)
  clock.advance(300)
  assert.deepEqual([indicator.current, changes], ['extracting', 1])
  indicator.set('comparing')
  assert.deepEqual([indicator.current, changes], ['comparing', 1])
  indicator.set(undefined)
  clock.advance(500)
  // Again before the minimum ended: still shown, and it isn't hidden at 700.
  indicator.set('extracting')
  clock.advance(1000)
  assert.equal(indicator.current, 'extracting')
  // Ending after the minimum hides it at once.
  indicator.set(undefined)
  assert.equal(indicator.current, undefined)
  // Another tab in front: forgotten at once.
  indicator.set('extracting')
  clock.advance(1400)
  indicator.reset()
  assert.equal(indicator.current, undefined)
  clock.advance(5000)
  assert.equal(indicator.current, undefined)
})

test('the quick pick starts with Refresh only while the tab in front is out of date', () => {
  assert.equal(refreshPickLabel(undefined), undefined)
  assert.equal(refreshPickLabel({files: 19}), '$(refresh) Refresh · 19 files changed')
  assert.equal(refreshPickLabel({files: 1}), '$(refresh) Refresh · 1 file changed')
  // A definition edit changes no file count: Refresh alone.
  assert.equal(refreshPickLabel({}), '$(refresh) Refresh')
})

test('hidden while the folder has no projections or no pair; a subject cannot draw an icon', () => {
  assert.equal(statusItem({defines: false, choice: {id: 'now'}, facts, pair: {after: 'working-tree'}}), undefined)
  assert.equal(statusItem({defines: true, choice: {id: 'now'}, facts, pair: undefined}), undefined)
  const sneaky = {id: `pair:${base}..${head}`, title: 'Use $(warning) here'}
  assert.equal(item(sneaky, {before: base, after: head}).text, '$(projections-mark) Use \\$(warning) here')
})

test('shown only where projections are in view: a projection tab in front, or any Projections view visible', () => {
  const closed = [false, false, false, false]
  // Editing other files with the side bar closed: hidden.
  assert.equal(statusShown(true, {projectionTab: false, views: closed}), false)
  // A projection tab is the active editor tab, the side bar closed.
  assert.equal(statusShown(true, {projectionTab: true, views: closed}), true)
  // A text editor in front, any section of the side bar visible (Suggested alone counts too).
  assert.equal(statusShown(true, {projectionTab: false, views: [true, true, false, false]}), true)
  assert.equal(statusShown(true, {projectionTab: false, views: [false, false, false, true]}), true)
  // Nothing to read out (no projections or no pair): hidden even in view.
  assert.equal(statusShown(false, {projectionTab: true, views: [true, true, true, true]}), false)
})
