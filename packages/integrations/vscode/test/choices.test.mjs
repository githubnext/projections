// Unit tests of what a projection tab looks at (`choices/`): the automatic choice, a choice → its pair, its name and
// detail, and a pair → the choice it is; loaded from source with Node's type stripping.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {isChoice, pairChoiceId, sameChoice} from '../src/choices/model.ts'
import {automaticChoice, effectiveChoice, identifyPair, isAhead, resolveChoice, unavailableReason} from '../src/choices/resolve.ts'
import {branchDetail, choiceDetail, choiceIcon, choiceName, choiceText} from '../src/choices/names.ts'
import {visibleChoices} from '../src/choices/listing.ts'
import {parsePullRequests} from '../src/pulls.ts'
import {statusText} from '../src/projections/rows.ts'

const head = 'a'.repeat(40)
const base = 'b'.repeat(40)
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
    {before: base, after: 'working-tree', label: 'feature/auth since main', source: 'merge-base'},
    {before: 'v1.0', after: 'HEAD', label: 'v1.0 → HEAD', source: 'tag'},
    {before: 'HEAD~1', after: 'HEAD', label: 'HEAD~1 → HEAD', source: 'parent'},
    {before: 'HEAD', after: 'working-tree', label: 'Your uncommitted changes', source: 'working-tree'},
  ],
  bookmarks: [{id: 'auth-landed', before: 'v1.0', after: base, label: 'Auth landed', source: 'bookmark'}],
}
/** On main, nothing ahead. */
const main = {head, branch: 'main', defaultBranch: 'main', dirty: false, suggestions: [], bookmarks: []}

test('the automatic choice: My branch when ahead, else Uncommitted with edits, else Now', () => {
  assert.equal(isAhead(feature), true)
  assert.deepEqual(automaticChoice(feature), {id: 'branch'})
  // On a branch whose merge base is HEAD (nothing committed yet), with edits.
  assert.deepEqual(automaticChoice({...feature, mergeBase: head, ahead: 0}), {id: 'uncommitted'})
  assert.deepEqual(automaticChoice({...main, dirty: true, changes: 1}), {id: 'uncommitted'})
  assert.deepEqual(automaticChoice(main), {id: 'now'})
  // No commits yet: the working tree alone, even with files.
  assert.deepEqual(automaticChoice({dirty: true, suggestions: [], bookmarks: []}), {id: 'now'})
})

test('a choice resolves to its pair', () => {
  assert.deepEqual(resolveChoice({id: 'now'}, feature), {after: 'working-tree'})
  assert.deepEqual(resolveChoice({id: 'uncommitted'}, feature), {before: 'HEAD', after: 'working-tree'})
  assert.deepEqual(resolveChoice({id: 'branch'}, feature), {before: base, after: 'working-tree'})
  assert.deepEqual(resolveChoice({id: 'last-commit'}, feature), {before: 'HEAD~1', after: 'HEAD'})
  assert.deepEqual(resolveChoice({id: 'release'}, feature), {before: 'v1.0', after: 'HEAD'})
  assert.deepEqual(resolveChoice({id: 'bookmark:auth-landed'}, feature), {before: 'v1.0', after: base})
  const pr = {id: 'pr:12', pair: {before: base, after: head}, title: '#12 Fix login'}
  assert.deepEqual(resolveChoice(pr, feature), pr.pair)
  assert.deepEqual(resolveChoice({id: 'custom', pair: {before: 'main', after: 'HEAD'}}, feature), {before: 'main', after: 'HEAD'})
  // Choices that don't apply here.
  assert.equal(resolveChoice({id: 'branch'}, main), undefined)
  assert.equal(unavailableReason({id: 'branch'}, main), "you're on main")
  assert.equal(resolveChoice({id: 'release'}, main), undefined)
  assert.equal(unavailableReason({id: 'release'}, main), 'no earlier tag')
  assert.equal(resolveChoice({id: 'bookmark:gone'}, feature), undefined)
  assert.equal(unavailableReason({id: 'uncommitted'}, {dirty: true, suggestions: [], bookmarks: []}), 'no commits yet')
  assert.equal(unavailableReason({id: 'uncommitted'}, feature), undefined)
})

test('a remembered choice resolves again as refs move, else the automatic one stands in', () => {
  assert.deepEqual(effectiveChoice(undefined, feature), {
    choice: {id: 'branch'},
    pair: {before: base, after: 'working-tree'},
    automatic: true,
  })
  assert.deepEqual(effectiveChoice({id: 'uncommitted'}, feature), {
    choice: {id: 'uncommitted'},
    pair: {before: 'HEAD', after: 'working-tree'},
    automatic: false,
  })
  // The merge base moved (a rebase): My branch follows it.
  const moved = 'c'.repeat(40)
  assert.deepEqual(effectiveChoice({id: 'branch'}, {...feature, mergeBase: moved}).pair, {before: moved, after: 'working-tree'})
  // Back on main, My branch doesn't apply: the automatic choice, until the branch is checked out again.
  assert.deepEqual(effectiveChoice({id: 'branch'}, main), {choice: {id: 'now'}, pair: {after: 'working-tree'}, automatic: true})
})

test('a pair is the choice that resolves to it, else a custom pair', () => {
  assert.deepEqual(identifyPair({after: 'working-tree'}, feature), {id: 'now'})
  assert.deepEqual(identifyPair({before: 'HEAD', after: 'working-tree'}, feature), {id: 'uncommitted'})
  assert.deepEqual(identifyPair({before: base, after: 'working-tree'}, feature), {id: 'branch'})
  assert.deepEqual(identifyPair({before: 'HEAD~1', after: 'HEAD'}, feature), {id: 'last-commit'})
  assert.deepEqual(identifyPair({before: 'v1.0', after: 'HEAD'}, feature), {id: 'release'})
  assert.deepEqual(identifyPair({before: 'v1.0', after: base}, feature), {id: 'bookmark:auth-landed'})
  assert.deepEqual(identifyPair({before: 'main', after: 'HEAD'}, feature), {id: 'custom', pair: {before: 'main', after: 'HEAD'}})
  assert.equal(sameChoice({id: 'custom', pair: {before: 'a', after: 'b'}}, {id: 'custom', pair: {before: 'a', after: 'b'}}), true)
  assert.equal(sameChoice({id: 'custom', pair: {before: 'a', after: 'b'}}, {id: 'custom', pair: {before: 'b', after: 'a'}}), false)
  assert.equal(sameChoice({id: 'branch'}, {id: 'uncommitted'}), false)
})

test('a choice is named for people, not by its refs', () => {
  // Each says its span with real ref names, then its size.
  assert.equal(choiceText({id: 'branch'}, feature), 'Branch changes · main → your files · 3 commits + 2 uncommitted')
  assert.equal(branchDetail({...feature, dirty: false}), '3 commits')
  assert.equal(branchDetail({...feature, ahead: 1, dirty: false}), '1 commit')
  assert.equal(branchDetail({...feature, ahead: 0}), '2 uncommitted')
  assert.equal(choiceText({id: 'uncommitted'}, feature), 'Uncommitted changes · last commit → your files · 2 files')
  assert.equal(choiceText({id: 'uncommitted'}, {...feature, changes: 1}), 'Uncommitted changes · last commit → your files · 1 file')
  assert.equal(choiceText({id: 'now'}, main), 'Current state · your files as they are now')
  assert.equal(choiceText({id: 'last-commit'}, feature), 'Last commit · previous commit → last commit')
  assert.equal(choiceName({id: 'release'}, feature), 'Since v1.0')
  assert.equal(choiceDetail({id: 'release'}, feature), 'v1.0 → HEAD')
  assert.equal(choiceName({id: 'last-commit'}, feature), 'Last commit')
  assert.equal(choiceName({id: 'bookmark:auth-landed'}, feature), 'Bookmark: Auth landed')
  // A recent commit chosen in the Viewing view: named by its revisions (or its commit subject), resolved from its identity.
  const a = 'a1b2c3d4'.padEnd(40, '0')
  const b = 'e4f5a6b7'.padEnd(40, '0')
  const pair = {id: pairChoiceId({before: a, after: b})}
  assert.equal(pair.id, `pair:${a}..${b}`)
  assert.equal(choiceName(pair, feature), 'a1b2c3d4 → e4f5a6b7')
  assert.deepEqual(resolveChoice(pair, feature), {before: a, after: b})
  assert.equal(choiceName({...pair, title: 'Add auth package'}, feature), 'Add auth package')
  assert.equal(choiceIcon(pair), 'git-commit')
  assert.ok(isChoice(pair))
  assert.equal(
    choiceText({id: 'pr:12', pair: {before: base, after: head}, title: '#12 Fix login'}, feature),
    'PR #12 · #12 Fix login · bbbbbbbb → aaaaaaaa',
  )
  // Two revisions (`custom`) by their sides' names, once git named them, else by short refs.
  const custom = {id: 'custom', pair: {before: base, after: 'working-tree'}}
  assert.equal(choiceText(custom, feature), 'Two revisions · bbbbbbbb → your files')
  assert.equal(
    choiceText(custom, feature, {
      before: {ref: base, kind: 'branch', name: 'main'},
      after: {ref: 'working-tree', kind: 'working-tree', name: 'Working tree'},
    }),
    'Two revisions · main → Working tree',
  )
  assert.deepEqual(
    ['now', 'uncommitted', 'branch', 'pr:1', 'last-commit', 'release', 'bookmark:x', 'custom'].map(id => choiceIcon({id})),
    ['eye', 'edit', 'git-branch', 'git-pull-request', 'git-commit', 'tag', 'bookmark', 'git-compare'],
  )
})

test('remembered choices are checked before use', () => {
  assert.equal(isChoice({id: 'branch'}), true)
  assert.equal(isChoice({id: 'bookmark:auth-landed'}), true)
  assert.equal(isChoice({id: 'custom', pair: {before: 'a', after: 'b'}}), true)
  assert.equal(isChoice({id: 'custom'}), false)
  assert.equal(isChoice({id: 'pr:x', pair: {after: 'b'}}), false)
  assert.equal(isChoice({id: 'something-else'}), false)
  assert.equal(isChoice(null), false)
})

test('a row on Now says whether it was extracted, not how much changed', () => {
  assert.equal(statusText({executionAuthorized: true, single: true}), 'not extracted')
  assert.equal(statusText({executionAuthorized: true, single: true, summary: {status: 'extracting'}}), 'extracting…')
  assert.equal(statusText({executionAuthorized: true, single: true, summary: {status: 'ok'}}), 'extracted')
  assert.equal(
    statusText({executionAuthorized: true, summary: {status: 'ok', comparison: {compared: true, rows: 3, changes: {added: 7}}}}),
    '7 changes',
  )
})

test('pull requests from gh', () => {
  const pulls = parsePullRequests(
    JSON.stringify([
      {
        number: 12,
        title: 'Fix login',
        headRefName: 'feature/auth',
        baseRefName: 'main',
        headRefOid: head,
        isDraft: false,
        author: {login: 'mona'},
      },
      {number: 13, title: 'No head', baseRefName: 'main'},
    ]),
  )
  assert.deepEqual(pulls, [
    {number: 12, title: 'Fix login', headRefName: 'feature/auth', baseRefName: 'main', headRefOid: head, isDraft: false, author: 'mona'},
  ])
})

test('the Viewing quick pick lists equivalent choices once, the selected one always', () => {
  const all = ['now', 'uncommitted', 'branch', 'last-commit', 'release']
  // A branch ahead of main: Branch changes differs from Uncommitted changes, so both show.
  assert.deepEqual(
    visibleChoices(
      all.map(id => ({id})),
      feature,
    ).map(choice => choice.id),
    all,
  )
  // On main, nothing ahead: Branch changes (no merge base) is Uncommitted changes, so it is left out.
  const onMain = {...main, dirty: true, changes: 1, suggestions: [{before: 'HEAD~1', after: 'HEAD', source: 'parent', label: ''}]}
  assert.deepEqual(
    visibleChoices(
      all.map(id => ({id})),
      onMain,
    ).map(choice => choice.id),
    ['now', 'uncommitted', 'last-commit', 'release'],
  )
  // A branch with no commits ahead (its merge base is HEAD): the same.
  const fresh = {...feature, mergeBase: head, ahead: 0}
  assert.deepEqual(
    visibleChoices(
      all.map(id => ({id})),
      fresh,
    ).map(choice => choice.id),
    ['now', 'uncommitted', 'last-commit', 'release'],
  )
  // Selected, it stays, in place of its equivalent.
  assert.deepEqual(
    visibleChoices(
      all.map(id => ({id})),
      fresh,
      {id: 'branch'},
    ).map(choice => choice.id),
    ['now', 'branch', 'last-commit', 'release'],
  )
  // The automatic choice is never a hidden one: Branch changes only when ahead.
  assert.deepEqual(automaticChoice(fresh), {id: 'uncommitted'})
})
