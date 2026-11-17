// Unit tests of the agent's current view, loaded from source with Node's type stripping: what `current_view` says of
// the projection tab in front, and the projection and revisions the other tools take from it.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {currentViewText, noProjectionTab} from '../src/current-view/text.ts'
import {figureText} from '../src/current-view/page-text.ts'
import {tabDefaults} from '../src/current-view/tab-defaults.ts'
import {withTabDefaults} from '../src/current-view/tool-input.ts'

const before = 'caf6ab7e0123456789abcdef0123456789abcdef'
const after = 'd698c1620123456789abcdef0123456789abcdef'

/** The CI pipeline tab of the user's report: Branch changes, where the Test job is removed. */
const ci = {
  inFront: true,
  folder: 'acme',
  projection: 'ci-jobs',
  title: 'CI pipeline',
  definitionFile: '.github/projections/ci-jobs.json',
  parts: {extractor: 'github-actions-jobs', renderer: 'dag'},
  choice: {id: 'branch', name: 'Branch changes', detail: '2 commits'},
  pinned: false,
  before: {ref: before, commit: before, text: 'merge base with main · "Set up CI" · 3 days ago'},
  after: {ref: 'HEAD', commit: after, text: 'feature/ci · "Deploy after runtime policy checks" · just now'},
  definitionRevision: 'HEAD',
  page: {
    status: 'ok',
    compared: true,
    rows: 7,
    changes: {removed: 1, added: 5, unchanged: 1},
    items: [
      {id: 'job:test', label: 'Test', kind: 'job', status: 'removed'},
      {id: 'job:unit', label: 'Unit tests', kind: 'job', status: 'added'},
      {id: 'job:build', label: 'Build', kind: 'job', status: 'unchanged'},
    ],
    selection: {id: 'job:unit', label: 'Unit tests', kind: 'job', status: 'added'},
    figures: [{noun: {singular: 'job', plural: 'jobs'}, count: 7, added: 5, removed: 1, modified: 0}],
    mode: 'side-by-side',
    modes: ['diff', 'swipe', 'side-by-side', 'animated'],
    showAs: 'renderer',
    changesOnly: false,
  },
  others: ['Package dependencies'],
}

test('the current view names the projection, its choice and revisions, mode, counts, changes and selection', () => {
  const text = currentViewText(ci)
  assert.match(text, /^The projection tab in front is "CI pipeline" \(projection ci-jobs\) in acme\.$/m)
  assert.match(
    text,
    /^Definition: \.github\/projections\/ci-jobs\.json; extractor `github-actions-jobs`, renderer `dag`, the default comparator\.$/m,
  )
  assert.match(text, /^Showing: Branch changes \(2 commits\)\. Before caf6ab7e \(merge base with main/m)
  assert.match(text, /→ After d698c162 \(feature\/ci/)
  assert.match(text, new RegExp(`^Revisions: before ${before}, after ${after}\\.$`, 'm'))
  assert.match(text, /^Mode: Side by side \(of Diff, Side by side, Animated, Swipe\)\.$/m)
  assert.match(text, /^Summary bar: 7 jobs \(\+5 −1\)\.$/m)
  assert.match(text, /^Changes: 1 removed, 5 added of 7 items\.$/m)
  assert.match(text, /^- removed job Test \[job:test\]$/m)
  assert.doesNotMatch(text, /Build/, 'unchanged items are only counted')
  assert.match(text, /^Selected: job Unit tests \[job:unit\], added\.$/m)
  assert.match(text, /^Up to date\.$/m)
  assert.match(text, /^Definition: the committed one\.$/m)
  assert.match(text, /^Other projection tabs: Package dependencies\.$/m)
})

test('the current view says when the tab is out of date, uses edits, shows one revision or is hidden', () => {
  const stale = currentViewText({
    ...ci,
    inFront: false,
    pinned: true,
    edits: 'yours',
    stale: {why: 'working tree', tier: 'extraction', files: 2},
    page: undefined,
  })
  assert.match(stale, /^No projection tab is in front; the one shown last is "CI pipeline"/m)
  assert.match(stale, /, pinned to this tab\./)
  assert.match(stale, /^Out of date: working tree \(2 files changed since\)/m)
  assert.match(stale, /uses the person's uncommitted edits/)
  assert.match(stale, /page isn't loaded/)
  assert.doesNotMatch(stale, /^Mode:/m)
  const now = currentViewText({
    ...ci,
    choice: {id: 'now', name: 'Current state'},
    before: undefined,
    after: {ref: 'working-tree', text: 'Working tree · no uncommitted changes'},
    edits: 'committed',
    page: {status: 'extracting', figures: [{noun: {singular: 'job', plural: 'jobs'}, count: 1}]},
  })
  assert.match(
    now,
    /^Showing: Current state\. One revision, working-tree \(Working tree · no uncommitted changes\): nothing is compared\.$/m,
  )
  assert.doesNotMatch(now, /^Revisions:/m)
  assert.match(now, /^Status: extracting/m)
  assert.match(now, /^Summary bar: 1 job\.$/m)
  assert.match(now, /chose Show committed: this result applies the committed one/)
  assert.match(noProjectionTab, /No projection tab is open/)
  assert.equal(figureText({noun: {singular: 'step', plural: 'steps'}, count: 3, modified: 2}), '3 steps (~2)')
})

test("compare without revisions compares the tab's, and says so; given ones say whether they are the tab's", () => {
  const tab = tabDefaults(ci)
  assert.deepEqual(tab.pair, {before, after})
  const omitted = withTabDefaults('compare', {}, tab)
  // The tab's pair compares with the definition the tab applies, as on screen.
  assert.deepEqual(omitted.input, {projection: 'ci-jobs', before, after, definitionRevision: 'HEAD'})
  assert.match(omitted.note, /^Projection: ci-jobs, the one the "CI pipeline" tab shows\./)
  assert.match(
    omitted.note,
    /Revisions: caf6ab7e → d698c162, the ones the "CI pipeline" tab shows \(Branch changes\)\. This is the comparison on the person's screen\./,
  )
  // Another projection on the tab's revisions, with the working tree's definition, as a tab would apply it.
  assert.deepEqual(withTabDefaults('compare', {projection: 'deps'}, tab).input, {
    projection: 'deps',
    before,
    after,
    definitionRevision: 'working-tree',
  })
  // A chosen definition stands.
  assert.deepEqual(withTabDefaults('compare', {definition: 'head'}, tab).input, {
    projection: 'ci-jobs',
    before,
    after,
    definition: 'head',
  })
  const same = withTabDefaults('compare', {projection: 'ci-jobs', before: 'caf6ab7e', after}, tab)
  assert.match(same.note, /^Revisions: caf6ab7e → d698c162, the ones the "CI pipeline" tab shows\.$/)
  const other = withTabDefaults('compare', {projection: 'ci-jobs', before: 'HEAD~1', after: 'HEAD'}, tab)
  assert.deepEqual(other.input, {projection: 'ci-jobs', before: 'HEAD~1', after: 'HEAD'})
  assert.match(
    other.note,
    /Not the comparison the "CI pipeline" tab shows \(Branch changes: caf6ab7e → d698c162\): don't present it as the one on screen\./,
  )
  // A pinned tab's pair, named as pinned.
  assert.match(withTabDefaults('compare', {}, {...tab, pinned: true}).note, /\(Branch changes, pinned to the tab\)/)
  // One revision: the suggested pair, said not to be what's on screen.
  const single = withTabDefaults('compare', {}, {...tab, choice: 'Current state', pair: {after: 'working-tree'}})
  assert.deepEqual(single.input, {projection: 'ci-jobs'})
  assert.match(
    single.note,
    /shows one revision \(Current state: working-tree\) and compares nothing, so these are the revisions Projections suggests: not what is on the person's screen\./,
  )
  // No tab: the suggested pair, and a projection is needed.
  assert.deepEqual(withTabDefaults('compare', {projection: 'deps'}, undefined), {
    input: {projection: 'deps'},
    note: 'Revisions: the ones Projections suggests (no projection tab is open).',
  })
  assert.throws(() => withTabDefaults('compare', {}, undefined), /Name a projection: no projection tab is open/)
})

test('check, open_projection, set_part and describe_part take the tab’s projection; others are left alone', () => {
  const tab = tabDefaults(ci)
  const checked = withTabDefaults('check', {render: true}, tab)
  assert.deepEqual(checked.input, {render: true, projections: ['ci-jobs']})
  assert.match(checked.note, /name projections to check others/)
  assert.deepEqual(withTabDefaults('check', {projections: ['deps']}, tab), {input: {projections: ['deps']}})
  assert.deepEqual(withTabDefaults('check', {}, undefined), {input: {}})
  assert.deepEqual(withTabDefaults('open_projection', {entity: 'job:test'}, tab).input, {entity: 'job:test', projection: 'ci-jobs'})
  assert.deepEqual(withTabDefaults('set_part', {renderer: 'graph'}, tab).input, {renderer: 'graph', projection: 'ci-jobs'})
  assert.throws(() => withTabDefaults('set_part', {renderer: 'graph'}, undefined), /Name a projection/)
  const described = withTabDefaults('describe_part', {part: 'renderer'}, tab)
  assert.deepEqual(described.input, {part: 'renderer'})
  assert.match(described.note, /uses the renderer `dag`; pass its ID to describe it\./)
  assert.match(withTabDefaults('describe_part', {part: 'comparator'}, tab).note, /uses the default comparator; pass its ID/)
  assert.deepEqual(withTabDefaults('describe_part', {part: 'renderer', id: 'graph'}, tab), {input: {part: 'renderer', id: 'graph'}})
  assert.deepEqual(withTabDefaults('sweep', {}, tab), {input: {}})
  assert.deepEqual(withTabDefaults('run_comparator_tests', {}, tab), {input: {}})
})

test("a screenshot takes the tab's projection, revisions, mode, playback, theme and size", () => {
  const facts = {...ci, page: {...ci.page, mode: 'animated', progress: 0.25, colorMode: 'dark', width: 3000, height: 700}}
  const {input, note} = withTabDefaults('screenshot', {}, tabDefaults(facts))
  assert.deepEqual(input, {projection: 'ci-jobs', before, after, mode: 'animated', progress: 0.25, theme: 'dark', width: 2560, height: 700})
  assert.match(note, /^Projection: ci-jobs, the one the "CI pipeline" tab shows\. Revisions: caf6ab7e → d698c162/)
  // Given values win; swipe has no image of its own; another projection keeps the tab's revisions but not its view.
  assert.equal(withTabDefaults('screenshot', {theme: 'light'}, tabDefaults(facts)).input.theme, 'light')
  const swiped = {...facts, page: {...facts.page, mode: 'swipe'}}
  assert.equal(withTabDefaults('screenshot', {}, tabDefaults(swiped)).input.mode, undefined)
  const other = withTabDefaults('screenshot', {projection: 'deps'}, tabDefaults(facts)).input
  assert.deepEqual(other, {projection: 'deps', before, after})
  const single = withTabDefaults('screenshot', {}, {...tabDefaults(facts), pair: {after: 'working-tree'}})
  assert.equal(single.input.after, 'working-tree')
  assert.match(single.note, /Revision: working-tree, the one the "CI pipeline" tab shows/)
  assert.throws(() => withTabDefaults('screenshot', {}, undefined), /Name a projection/)
})

test('the current view says the notices the tab shows, such as a declared input missing before', () => {
  const notice = "`.github/workflows/ci.yml` doesn't exist at `caf6ab7e`, so its contents show as added."
  const text = currentViewText({...ci, page: {...ci.page, notices: [notice]}})
  assert.ok(text.includes(`\nNotice: ${notice}\n`), text)
  assert.doesNotMatch(currentViewText(ci), /^Notice:/m)
})
