import {readFileSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import type {Page} from '@playwright/test'
import type {Comparison, Extraction} from '@githubnext/projections-schemas'
import {compare, compareWithComparator, openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import type {RendererHandle} from '@githubnext/projections-renderer-harness/playwright'

const fixture = (name: string): Extraction =>
  JSON.parse(readFileSync(new URL(`../../../extractors/github-agentic-workflows/tests/fixtures/${name}`, import.meta.url), 'utf8'))
const before = fixture('docs-bot/before.expected.json')
const after = fixture('docs-bot/after.expected.json')
const comparator = new URL('../../../comparators/agentic-workflows/agentic-workflows.comparator.yaml', import.meta.url)
const bot = 'workflow:.github/workflows/docs-bot.md'
const triage = 'workflow:.github/workflows/issue-triage.md'

async function open(page: Page, request: {comparison: Comparison; mode: 'diff' | 'before' | 'after'; view?: 'cards' | 'matrix'}) {
  return openRenderer(page, {
    renderer: 'agentic-workflows',
    before,
    after,
    comparison: request.comparison,
    ...(request.view ? {options: {view: request.view}} : {}),
    ...(request.mode === 'diff'
      ? {comparisonMode: 'diff' as const}
      : {comparisonMode: 'side-by-side' as const, progress: request.mode === 'before' ? 0 : 1}),
  })
}

/** The facts the renderer sends the host's summary bar, as the bar words them. */
async function facts(renderer: RendererHandle) {
  const sent = (await renderer.state()).summary ?? []
  return sent.flatMap(item => (item.type === 'fact' ? [`${item.count} ${item.count === 1 ? item.noun.singular : item.noun.plural}`] : []))
}

/** Every card's box, checked for overlap and sideways overflow. */
async function layout(renderer: RendererHandle) {
  const read = await renderer.frame.locator('.aw-view').evaluate(view => ({
    cards: [...view.querySelectorAll<HTMLElement>('.pk-entity-card')].map(card => {
      const box = card.getBoundingClientRect()
      return {id: card.dataset.entityId ?? '', top: box.top, bottom: box.bottom, left: box.left, right: box.right}
    }),
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
  }))
  for (const [index, card] of read.cards.entries()) {
    for (const other of read.cards.slice(index + 1)) {
      const apart =
        card.right <= other.left + 0.5 || other.right <= card.left + 0.5 || card.bottom <= other.top + 0.5 || other.bottom <= card.top + 0.5
      expect(apart, `${card.id} overlaps ${other.id}`).toBe(true)
    }
  }
  expect(read.overflow, 'horizontal overflow').toBe(false)
  return read
}

test('the diff draws each workflow once in its group, with each section’s direction in words', async ({page}) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const comparison = await compareWithComparator(before, after, comparator)
  const renderer = await open(page, {comparison, mode: 'diff'})
  const state = await renderer.state()
  expect(state.bundle).toBe('agentic-workflows')
  expect(state.capabilities?.comparisonModes).toEqual(['side-by-side', 'diff'])
  const view = await layout(renderer)
  expect(view.cards.map(card => card.id).toSorted()).toEqual(
    [
      triage,
      bot,
      'workflow:.github/workflows/docs-bot-links.md',
      'workflow:.github/workflows/docs-bot-examples.md',
      'workflow:.github/workflows/docs-bot-digest.md',
    ].toSorted(),
  )
  await expect
    .poll(() => facts(renderer))
    .toEqual([
      '1 lock file out of date',
      '1 gate removed',
      '1 repository scope widened',
      '1 permissions widened',
      '1 bash widened',
      '1 network widened',
      '2 outputs widened',
      '1 tools widened',
      '1 budget raised',
    ])
  const card = renderer.frame.locator(`[data-entity-id="${bot}"]`)
  const section = (id: string) => card.locator(`.aw-section[data-section="${id}"]`)
  await expect(section('loads').locator('.aw-direction')).toHaveText('Widened')
  await expect(section('loads').locator('.pk-change-pill[data-change="removed"]')).toContainText('skills/check-links')
  await expect(section('repos').locator('.pk-change-pill[data-change="added"]')).toHaveText(/octo-org\/docs-site/)
  // A limit that moves reads old → new: in one pill when short, as the old pill leaving and the new arriving when not.
  const examples = renderer.frame.locator('[data-entity-id="workflow:.github/workflows/docs-bot-examples.md"]')
  await expect(examples.locator('.aw-section[data-section="budgets"] .pk-value-change')).toHaveText(/60 min.*30 min/)
  await expect(section('budgets').locator('.pk-change-pill[data-change="removed"]')).toHaveText(/2,000/)
  await expect(section('budgets').locator('.pk-change-pill[data-change="added"]')).toHaveText(/5,000/)
  // A lock state that changes reads old → new on the card's meta line.
  const lock = renderer.frame.locator(`[data-entity-id="${triage}"] .aw-meta .pk-value-change`)
  await expect(lock.locator('[data-change="removed"] .aw-lock')).toHaveText('Lock current')
  await expect(lock.locator('[data-change="added"] .aw-lock')).toHaveText('Lock stale')
  await renderer.iframe.screenshot({path: test.info().outputPath('diff.png')})
  expect(errors).toEqual([])
})

test('side by side, each pane draws its own revision without the diff’s signs, and neutral endpoints mark nothing', async ({page}) => {
  const comparison = await compareWithComparator(before, after, comparator)
  const renderer = await open(page, {comparison, mode: 'after'})
  await layout(renderer)
  const card = renderer.frame.locator(`[data-entity-id="${bot}"]`)
  await expect(card.locator('.aw-section[data-section="loads"] .pk-change-pill')).not.toContainText(['check-links'])
  await expect(card.locator('.pk-pill-sign').first()).toBeHidden()
  await renderer.seek(1, {highlighting: 0})
  await expect(card.locator('.aw-direction')).toHaveCount(0)
})

test('the default comparator still marks every entry, without directions', async ({page}) => {
  const comparison = await compare(before, after)
  const renderer = await open(page, {comparison, mode: 'diff'})
  await expect.poll(() => facts(renderer)).toEqual(['1 lock file out of date'])
  const card = renderer.frame.locator(`[data-entity-id="${bot}"]`)
  await expect(card.locator('.aw-direction')).toHaveCount(0)
  await expect(card.locator('.pk-change-pill[data-change="added"]').first()).toBeVisible()
})

test('the matrix marks capabilities that arrive and leave, and selects a workflow from its row', async ({page}) => {
  const comparison = await compareWithComparator(before, after, comparator)
  const renderer = await open(page, {comparison, mode: 'diff', view: 'matrix'})
  const row = renderer.frame.locator(`tr[data-entity-id="${bot}"]`)
  await expect(row.locator('[data-cell="removed"]')).toHaveCount(1)
  await expect(row.locator('[data-cell="added"]')).toHaveCount(2)
  await expect(row.locator('.pk-change-status')).toContainText('Modified')
  await row.locator('.aw-matrix-select').click()
  await expect.poll(async () => (await renderer.state()).selection).toBe(bot)
  const overflow = await renderer.frame.locator('html').evaluate(root => root.scrollWidth - root.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
