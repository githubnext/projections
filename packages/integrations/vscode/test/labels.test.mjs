// Unit tests of the Compare section's ref labels, loaded from source with Node's type stripping.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {isBackwards, pairTitle, relativeAge, sideLabel, sideText} from '../src/labels.ts'

const now = Date.parse('2026-11-08T12:00:00Z')
const main = 'a'.repeat(40)
const feature = 'b'.repeat(40)
const base = 'c'.repeat(40)
const names = {
  head: {branch: 'feature/auth', commit: feature},
  branches: [
    {name: 'main', commit: main},
    {name: 'feature/auth', commit: feature, current: true},
  ],
  tags: [{name: 'v1.0', commit: main}],
  mergeBase: base,
  defaultBranch: 'main',
}

test('relative ages', () => {
  assert.equal(relativeAge('2026-11-08T11:59:30Z', now), 'just now')
  assert.equal(relativeAge('2026-11-08T11:55:00Z', now), '5 minutes ago')
  assert.equal(relativeAge('2026-11-08T11:00:00Z', now), '1 hour ago')
  assert.equal(relativeAge('2026-11-07T12:00:00Z', now), 'yesterday')
  assert.equal(relativeAge('2026-11-06T12:00:00Z', now), '2 days ago')
  assert.equal(relativeAge('2026-10-18T12:00:00Z', now), '3 weeks ago')
  assert.equal(relativeAge('2024-11-08T12:00:00Z', now), '2 years ago')
  assert.equal(relativeAge(undefined, now), undefined)
  assert.equal(relativeAge('not a date', now), undefined)
})

test('a branch, a tag and HEAD are named as they are', () => {
  const date = '2026-11-06T12:00:00Z'
  assert.deepEqual(sideLabel({ref: 'main', commit: main, subject: 'Add auth package', date}, names, now), {
    ref: 'main',
    kind: 'branch',
    name: 'main',
    subject: 'Add auth package',
    date,
    commit: main,
    age: '2 days ago',
  })
  assert.equal(sideLabel({ref: 'v1.0', commit: main}, names, now).kind, 'tag')
  assert.equal(sideLabel({ref: 'refs/tags/v1.0', commit: main}, names, now).name, 'v1.0')
  assert.equal(sideLabel({ref: 'HEAD', commit: feature}, names, now).name, 'feature/auth')
})

test('a commit is named by the branch, tag or merge base at it, else its short commit', () => {
  assert.equal(sideLabel({ref: feature, commit: feature}, names, now).name, 'feature/auth')
  assert.equal(sideLabel({ref: main}, {...names, branches: []}, now).name, 'v1.0')
  const merge = sideLabel({ref: base, commit: base, subject: 'Initial'}, names, now)
  assert.equal(merge.kind, 'merge-base')
  assert.equal(merge.name, 'merge base with main')
  const plain = sideLabel({ref: 'd'.repeat(40), subject: 'Fix it', date: '2026-11-08T11:00:00Z'}, names, now)
  assert.equal(plain.name, 'dddddddd')
  assert.equal(sideText(plain), 'dddddddd · "Fix it" · 1 hour ago')
})

test('the working tree counts its uncommitted files', () => {
  const tree = sideLabel({ref: 'working-tree', changes: {changed: 0, untracked: 1}}, names, now)
  assert.equal(sideText(tree), 'Working tree · 1 untracked')
  assert.equal(
    sideText(sideLabel({ref: 'working-tree', changes: {changed: 2, untracked: 1}}, names, now)),
    'Working tree · 2 changed, 1 untracked',
  )
  assert.equal(sideText(sideLabel({ref: 'working-tree'}, names, now)), 'Working tree · no uncommitted changes')
  assert.equal(pairTitle(sideLabel({ref: 'main', commit: main}, names, now), tree), 'main ↔ Working tree')
})

test('a pair runs backwards when After is older than Before; the working tree is the newest', () => {
  const older = {ref: 'v1.0', date: '2026-11-01T00:00:00Z'}
  const newer = {ref: 'HEAD', date: '2026-11-06T00:00:00Z'}
  assert.equal(isBackwards(older, newer), false)
  assert.equal(isBackwards(newer, older), true)
  assert.equal(isBackwards(newer, {ref: 'working-tree'}), false)
  assert.equal(isBackwards({ref: 'working-tree'}, older), true)
  assert.equal(isBackwards(undefined, older), false)
  assert.equal(isBackwards({ref: 'main'}, older), false, 'an unknown date is not a warning')
})

test("a pair's direction comes from history, even when commit dates are out of order", async () => {
  const {execFileSync} = await import('node:child_process')
  const {mkdtempSync, writeFileSync} = await import('node:fs')
  const {tmpdir} = await import('node:os')
  const {join} = await import('node:path')
  const {historyOrder} = await import('../src/ancestry.ts')
  const cwd = mkdtempSync(join(tmpdir(), 'projections-backwards-'))
  const git = (args, env = {}) =>
    execFileSync('git', args, {cwd, env: {...process.env, ...env}, stdio: ['ignore', 'pipe', 'ignore']})
      .toString()
      .trim()
  git(['init', '--quiet', '--initial-branch=main'])
  git(['config', 'user.email', 'a@example.com'])
  git(['config', 'user.name', 'A'])
  git(['config', 'commit.gpgsign', 'false'])
  // The later commit is dated before the earlier one, as a rebase or an imported history can leave them.
  const commit = (message, date) => {
    writeFileSync(join(cwd, 'file.txt'), message)
    git(['add', '-A'])
    git(['commit', '--quiet', '-m', message], {GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date})
    return git(['rev-parse', 'HEAD'])
  }
  const first = commit('First', '2026-11-05T12:00:00Z')
  const second = commit('Second', '2026-11-01T12:00:00Z')
  assert.equal(await historyOrder(cwd, first, second), 'forward')
  assert.equal(await historyOrder(cwd, second, first), 'backwards')
  assert.equal(await historyOrder(cwd, first, first), undefined)
  // By date alone the forward pair would read as backwards.
  assert.equal(isBackwards({ref: first, date: '2026-11-05T12:00:00Z'}, {ref: second, date: '2026-11-01T12:00:00Z'}), true)
})
