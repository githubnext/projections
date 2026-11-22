// Unit tests of the side bar's sections without VS Code: the Viewing view's rows, short facts, tooltips and recent
// commits (`choices/`), the Projections rows' badges (`row-status.ts`) and the Testing view's tree
// (`test-items.ts`); loaded from source with Node's type stripping.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {choiceFact, choiceTooltip, pairFact} from '../src/choices/tooltips.ts'
import {flatRows, viewingRows} from '../src/choices/viewing-rows.ts'
import {recentChanges, recentTooltip, shortCommit} from '../src/choices/recent.ts'
import {badgeText, rowColors, rowDescription, rowPath, rowStatus} from '../src/row-status.ts'
import {checkOutcomes, defaultChecks, testTree} from '../src/test-items.ts'

const head = 'a'.repeat(40)
const base = 'b'.repeat(40)
const one = '1'.repeat(40)
const two = '2'.repeat(40)
/** A feature branch three commits ahead of main, with two uncommitted files, a v1.0 tag and a bookmark. */
const feature = {
  head,
  branch: 'feature/auth',
  defaultBranch: 'main',
  mergeBase: base,
  dirty: true,
  changes: 2,
  ahead: 3,
  suggestions: [
    {
      before: base,
      after: 'working-tree',
      label: 'feature/auth since main',
      source: 'merge-base',
    },
    {before: 'v1.0', after: 'HEAD', label: 'v1.0 → HEAD', source: 'tag'},
    {
      before: 'HEAD~1',
      after: 'HEAD',
      label: 'HEAD~1 → HEAD',
      source: 'parent',
    },
  ],
  bookmarks: [
    {
      id: 'auth-landed',
      before: 'v1.0',
      after: base,
      label: 'Auth landed',
      source: 'bookmark',
    },
  ],
}
/** On main, with one uncommitted file and nothing ahead. */
const main = {head, branch: 'main', defaultBranch: 'main', dirty: true, changes: 1, suggestions: [], bookmarks: []}
const none = {status: 'none', changes: []}

const shape = rows =>
  rows.map(row =>
    row.kind === 'group'
      ? [row.group, row.expanded, shape(row.children)]
      : row.kind === 'choice'
        ? [row.choice.id, row.selected]
        : row.kind === 'recent'
          ? [`recent:${row.change.title}`, row.selected]
          : row.kind === 'compare'
            ? ['compare', row.selected]
            : [row.kind],
  )

test('Viewing lists the choices, then Bookmarks and Recent changes, then Compare two revisions…, one selected', () => {
  assert.deepEqual(shape(viewingRows({facts: feature, current: {id: 'branch'}, recent: none})), [
    ['now', false],
    ['uncommitted', false],
    ['branch', true],
    ['pr'],
    ['bookmarks', false, [['bookmark:auth-landed', false]]],
    ['recent', false, [['last-commit', false], ['release', false], ['find']]],
    ['compare', false],
  ])
  // A bookmark chosen opens its group; two revisions select Compare two revisions….
  const bookmarked = viewingRows({facts: feature, current: {id: 'bookmark:auth-landed'}, recent: none})
  assert.deepEqual(bookmarked[4], {
    kind: 'group',
    group: 'bookmarks',
    expanded: true,
    children: [
      {
        kind: 'choice',
        choice: {id: 'bookmark:auth-landed'},
        selected: true,
      },
    ],
  })
  const custom = viewingRows({facts: feature, current: {id: 'custom', pair: {before: 'main', after: 'HEAD'}}, recent: none})
  assert.deepEqual(custom.at(-1), {kind: 'compare', selected: true})
  assert.equal(flatRows(custom).filter(row => row.selected).length, 1)
  // Equivalents hidden: on main, Branch changes is Uncommitted changes; no bookmarks, no Bookmarks group.
  assert.deepEqual(
    viewingRows({facts: main, current: {id: 'uncommitted'}, recent: none}).map(row => row.choice?.id ?? row.group ?? row.kind),
    ['now', 'uncommitted', 'pr', 'recent', 'compare'],
  )
})

test('Recent changes: the commits that change any projection, with what each changes; the last commit is Last commit', () => {
  const changes = [
    {before: base, after: head, title: 'Add auth package', kind: 'commit'},
    {before: one, after: base, title: 'Docs only', kind: 'commit'},
    {
      before: two,
      after: one,
      title: 'Split billing',
      kind: 'merge',
      date: '2026-11-01T10:00:00Z',
    },
    {before: 'v1.0', after: one, title: 'A bookmark', kind: 'pair'},
  ]
  const cells = [
    {
      projection: 'packages',
      before: base,
      after: head,
      status: 'changed',
      changes: 3,
    },
    {
      projection: 'packages',
      before: one,
      after: base,
      status: 'unchanged',
      changes: 0,
    },
    {
      projection: 'packages',
      before: two,
      after: one,
      status: 'changed',
      changes: 1,
    },
    {
      projection: 'cards',
      before: two,
      after: one,
      status: 'changed',
      changes: 2,
    },
    {
      projection: 'packages',
      before: 'v1.0',
      after: one,
      status: 'changed',
      changes: 9,
    },
  ]
  const titles = {packages: 'Packages', cards: 'Package cards'}
  const found = recentChanges({changes, cells, title: id => titles[id]})
  assert.deepEqual(
    found.map(change => [change.title, change.projections.map(item => `${item.title}:${item.changes}`)]),
    [
      ['Add auth package', ['Packages:3']],
      ['Split billing', ['Packages:1', 'Package cards:2']],
    ],
  )
  assert.deepEqual(recentChanges({changes, cells, hidden: new Set([`${two}..${one}`])}).length, 1)
  const recent = {status: 'done', changes: found}
  const rows = viewingRows({facts: feature, current: {id: 'branch'}, recent})
  const group = rows.find(row => row.group === 'recent')
  // The commit at HEAD is listed once: as the commit, which says what it changes, unless Last commit is the choice.
  assert.deepEqual(shape(group.children), [
    ['release', false],
    ['recent:Add auth package', false],
    ['recent:Split billing', false],
  ])
  assert.deepEqual(
    shape(viewingRows({facts: feature, current: {id: 'last-commit'}, recent}).find(row => row.group === 'recent').children),
    [
      ['last-commit', true],
      ['release', false],
      ['recent:Split billing', false],
    ],
  )
  // Chosen, its row is selected and its group open.
  const chosen = viewingRows({
    facts: feature,
    current: {id: `pair:${two}..${one}`, title: 'Split billing'},
    recent,
  })
  assert.deepEqual(chosen.find(row => row.group === 'recent').expanded, true)
  assert.equal(chosen.at(-1).selected, false)
  const tooltip = recentTooltip(found[1], 'data:image/png;base64,AAAA')
  assert.match(tooltip, /^\*\*Split billing\*\*/u)
  assert.match(tooltip, /\x602222222\x60 → \x601111111\x60 · 2026-11-01/u)
  assert.match(tooltip, /Changes Packages \\\(1 change\\\), Package cards \\\(2 changes\\\)\./u)
  assert.match(tooltip, /!\[What it changes in Packages\]\(data:image\/png;base64,AAAA\)/u)
  // Running, with nothing found yet: a progress row; done with nothing: says so.
  assert.deepEqual(
    shape(
      viewingRows({
        facts: main,
        current: {id: 'now'},
        recent: {status: 'running', changes: [], progress: 'Checking… 1 of 4'},
      }),
    )[3][2],
    [['last-commit', false], ['progress']],
  )
  assert.deepEqual(shape(viewingRows({facts: main, current: {id: 'now'}, recent: {status: 'done', changes: []}}))[3][2].at(-1), ['find'])
})

test('Viewing rows say short facts; their tooltips explain', () => {
  assert.equal(choiceFact({id: 'now'}, feature), '')
  assert.equal(choiceFact({id: 'uncommitted'}, feature), '2 files')
  assert.equal(choiceFact({id: 'uncommitted'}, {...feature, changes: 1}), '1 file')
  assert.equal(choiceFact({id: 'branch'}, feature), '3 commits')
  assert.equal(choiceFact({id: 'last-commit'}, feature), 'aaaaaaa')
  assert.equal(choiceFact({id: 'release'}, feature), '')
  assert.equal(choiceFact({id: 'bookmark:auth-landed'}, feature), 'bbbbbbb')
  assert.equal(choiceFact({id: 'custom', pair: {before: one, after: two}}, feature), '1111111 → 2222222')
  assert.equal(choiceFact({id: 'branch'}, main), 'unavailable')
  // Every fact fits a narrow side bar.
  for (const id of ['now', 'uncommitted', 'branch', 'last-commit', 'release', 'bookmark:auth-landed']) {
    assert.ok(choiceFact({id}, feature).length <= 12, id)
  }
  assert.equal(pairFact({before: 'main', after: 'working-tree'}), 'main → working tree')
  assert.equal(shortCommit(head), 'aaaaaaa')
  const tooltip = choiceTooltip({id: 'uncommitted'}, feature, {detail: 'last commit → your files · 2 files', selected: true})
  assert.deepEqual(tooltip.split('\n'), [
    '**Uncommitted changes** · last commit → your files · 2 files',
    '',
    'What your uncommitted edits change: the last commit compared with your files.',
    '',
    'Every projection tab shows this, unless it is pinned.',
  ])
  assert.match(choiceTooltip({id: 'branch'}, main), /Not available here: you're on main\./u)
})

test('a Projections row: its change count as a badge in the modified color, muted until compared', () => {
  assert.deepEqual(rowStatus('3 changes', 'Uncommitted changes'), {
    badge: '3',
    color: 'gitDecoration.modifiedResourceForeground',
    tooltip: '3 changes (Uncommitted changes)',
  })
  assert.equal(rowStatus('1 change').badge, '1')
  assert.equal(rowStatus('12 changes').badge, '9+')
  assert.deepEqual([badgeText(9), badgeText(10), badgeText(250)], ['9', '9+', '9+'])
  // No changes: no badge, no color, no description.
  assert.deepEqual(rowStatus('no change', 'Branch changes'), {tooltip: 'No changes (Branch changes)'})
  // Not compared yet: no badge, a muted label, no description.
  assert.deepEqual(rowStatus('not compared'), {color: rowColors.muted, tooltip: 'Not compared yet'})
  assert.equal(rowStatus('not extracted').color, rowColors.muted)
  assert.equal(rowStatus('extracted').color, undefined)
  // What is unusual stays a short description.
  assert.equal(rowStatus('Out of date').description, 'Out of date')
  assert.equal(rowStatus('needs trust').description, 'needs trust')
  assert.deepEqual([rowStatus('failed').description, rowStatus('failed').color], ['failed', 'list.errorForeground'])
  assert.equal(rowStatus('comparing…').description, 'comparing…')
  assert.equal(rowDescription(rowStatus('3 changes'), true), 'edited')
  assert.equal(rowDescription(rowStatus('Out of date'), true), 'Out of date · edited')
  assert.equal(rowDescription(rowStatus('no change'), false), '')
  assert.equal(rowPath('file:///repo', 'a b'), '/file%3A%2F%2F%2Frepo/a%20b')
})

test('the Testing view: a projection with its checks and its comparator cases at their lines; unused files alone', () => {
  const files = [
    {
      path: 'tools/first.comparator.test.yaml',
      comparator: 'tools/first.comparator.yaml',
      projections: ['packages'],
      cases: [
        {
          id: 'core leads',
          name: 'core leads',
          location: {path: 'tools/first.comparator.test.yaml', line: 6, column: 5},
        },
        {
          id: 'billing leads',
          name: 'billing leads',
          location: {path: 'tools/first.comparator.test.yaml', line: 11, column: 5},
        },
      ],
      diagnostics: [],
    },
    {
      path: 'other.comparator.test.yaml',
      comparator: 'other.comparator.yaml',
      projections: [],
      cases: [{id: 'x', name: 'x'}],
      diagnostics: [],
    },
  ]
  const projections = [
    {id: 'packages', title: 'Packages'},
    {id: 'cards', title: 'Package cards'},
  ]
  const tree = testTree({projections, files})
  const brief = nodes => nodes.map(node => [node.id, node.label, node.line ?? null, brief(node.children)])
  assert.deepEqual(brief(tree), [
    [
      'projection:packages',
      'Packages',
      null,
      [
        ['check:definition', 'Definition valid', null, []],
        ['check:extract', 'Extraction', null, []],
        ['check:determinism', 'Determinism', null, []],
        ['check:scope', 'Scope', null, []],
        ['check:renderer', 'Renderer checks', null, []],
        ['case:tools/first.comparator.test.yaml#core leads', 'core leads', 6, []],
        ['case:tools/first.comparator.test.yaml#billing leads', 'billing leads', 11, []],
      ],
    ],
    [
      'projection:cards',
      'Package cards',
      null,
      [
        ['check:definition', 'Definition valid', null, []],
        ['check:extract', 'Extraction', null, []],
        ['check:determinism', 'Determinism', null, []],
        ['check:scope', 'Scope', null, []],
        ['check:renderer', 'Renderer checks', null, []],
      ],
    ],
    ['file:other.comparator.test.yaml', 'other.comparator.test.yaml', null, [['case:other.comparator.test.yaml#x', 'x', null, []]]],
  ])
  // A case keeps its file and column for the gutter.
  assert.deepEqual(
    [tree[0].children[5].path, tree[0].children[5].column, tree[0].children[5].case],
    ['tools/first.comparator.test.yaml', 5, 'core leads'],
  )
  // Steps a run reported that the defaults don't list become items; the comparator tests' step is its cases'.
  const reported = new Map([
    ['packages', ['definition', 'extract', 'compare', 'comparator-tests', 'renderer', 'diff']],
    ['cards', ['definition', 'comparator-tests']],
  ])
  const after = testTree({projections, files, reported})
  assert.deepEqual(
    after[0].children.filter(node => node.kind === 'check').map(node => node.check),
    [...defaultChecks, 'compare'],
  )
  assert.deepEqual(
    after[1].children.map(node => node.check),
    [...defaultChecks, 'comparator-tests'],
  )
})

test("a check run's steps as each item's outcome: renderer steps merge, warnings pass, unreported ones skip", () => {
  const steps = [
    {id: 'definition', title: 'Definition', status: 'pass', message: 'Valid'},
    {id: 'extract', title: 'Working tree', status: 'fail', message: 'boom'},
    {
      id: 'renderer',
      title: 'Renderer',
      status: 'pass',
      message: 'Built-in renderer graph',
    },
    {id: 'diff', title: 'Diff mode', status: 'warn', message: 'No diff mode'},
    {
      id: 'render',
      title: 'Renderer checks',
      status: 'skip',
      message: '--no-render',
    },
  ]
  const outcomes = checkOutcomes(steps, ['definition', 'extract', 'scope', 'renderer'])
  assert.deepEqual(outcomes.get('definition'), {state: 'passed', messages: ['Valid'], warning: false})
  assert.deepEqual(outcomes.get('extract'), {state: 'failed', messages: ['boom'], warning: false})
  assert.deepEqual(outcomes.get('scope'), {state: 'skipped', messages: ['Not checked'], warning: false})
  assert.deepEqual(outcomes.get('renderer'), {
    state: 'passed',
    messages: ['Renderer: Built-in renderer graph', 'Diff mode: No diff mode', 'Renderer checks: --no-render'],
    warning: true,
  })
})
