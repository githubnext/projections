import {expect, test} from '@playwright/test'
import type {FrameLocator} from '@playwright/test'
import {readFileSync} from 'node:fs'
import type {Extraction} from '@githubnext/projections-schemas'
import {openRenderer} from '@githubnext/projections-renderer-harness/playwright'

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8')) as Extraction
const before = fixture('gallery-before')
const after = fixture('gallery-after')
const id = (document: string, scenario?: string) =>
  scenario ? `scenario:${encodeURIComponent(document)}:${scenario}` : `scenarios:${encodeURIComponent(document)}`

/** The nested frame of a scenario's card. */
const nested = (frame: FrameLocator, scenario: string) => frame.locator(`[data-entity-id="${scenario}"] iframe[data-embedded-renderer]`)

test('each scenario is drawn by its own built-in renderer, nested in a sandboxed frame', async ({page}) => {
  test.slow()
  const gallery = await openRenderer(page, {renderer: 'gallery', extraction: before, width: 1200})
  const cards = gallery.frame.locator('.pk-entity-card')
  await expect(cards).toHaveCount(5)
  for (const [scenario, renderer] of [
    [id('graph/scenarios.json', 'shop'), 'graph'],
    [id('graph/scenarios.json', 'payments-split'), 'graph'],
    // A name the graph bundle handles: the host supplies that bundle, which draws its dag presentation.
    [id('graph/scenarios.json', 'release-pipeline'), 'dag'],
    [id('text-diff/scenarios.json', 'status'), 'text-diff'],
  ] as const) {
    // Frames load as their cards near the view.
    await gallery.frame.locator(`[data-entity-id="${scenario}"]`).scrollIntoViewIfNeeded()
    const frame = nested(gallery.frame, scenario)
    await expect(frame, scenario).toHaveAttribute('data-revealed', 'true', {timeout: 15_000})
    await expect(frame).toHaveAttribute('data-embedded-renderer', renderer)
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    await expect(gallery.frame.locator(`[data-entity-id="${scenario}"] .gl-stage`)).toHaveAttribute('data-state', 'ready')
  }
  // The nested renderer draws the scenario's own entities. A card far from the view lets its frame go, and loads it again.
  const card = gallery.frame.locator(`[data-entity-id="${id('graph/scenarios.json', 'shop')}"]`)
  await card.scrollIntoViewIfNeeded()
  await expect(card.frameLocator('iframe').locator('[data-entity-id="orders"]').first()).toBeVisible()
  // The pipeline's group gets a heading of its own; the others are the document's.
  await expect(gallery.frame.locator('.gl-run-title')).toHaveText(['Pipelines'])
  await expect(gallery.frame.locator('.pk-group-title, .pk-group header').first()).toContainText('Graph')
})

test('selecting inside a nested renderer selects its scenario', async ({page}) => {
  const gallery = await openRenderer(page, {renderer: 'gallery', extraction: before, width: 1200})
  const scenario = id('graph/scenarios.json', 'shop')
  await expect(nested(gallery.frame, scenario)).toHaveAttribute('data-revealed', 'true', {timeout: 15_000})
  await gallery.frame.frameLocator(`[data-entity-id="${scenario}"] iframe`).locator('[data-entity-id="orders"]').first().click()
  await expect.poll(async () => (await gallery.state()).selection).toBe(scenario)
})

test('the host theme reaches nested renderers, and a custom bundle is named, never run', async ({page}) => {
  const gallery = await openRenderer(page, {renderer: 'gallery', extraction: after, width: 1200, colorMode: 'dark'})
  const scenario = id('graph/scenarios.json', 'shop')
  await expect(nested(gallery.frame, scenario)).toHaveAttribute('data-revealed', 'true', {timeout: 15_000})
  const root = gallery.frame.frameLocator(`[data-entity-id="${scenario}"] iframe`).locator('html')
  await expect(root).toHaveAttribute('data-color-mode', 'dark')
  await gallery.setEnvironment({colorMode: 'light'})
  await expect(root).toHaveAttribute('data-color-mode', 'light')
  const cards = gallery.frame.locator(`[data-entity-id="${id('cards/scenarios.json', 'cards')}"]`)
  await expect(cards.locator('.gl-stage')).toHaveAttribute('data-state', 'custom')
  await expect(cards.locator('.gl-stage-note')).toHaveText(
    'Drawn by the custom renderer in cards/dist. Hosts nest only built-in renderers.',
  )
  await expect(cards.locator('iframe')).toHaveCount(0)
})

test('a comparison marks the scenarios a change added, removed and redrew, and offers both revisions of a redrawn one', async ({page}) => {
  const gallery = await openRenderer(page, {renderer: 'gallery', before, after, comparisonMode: 'diff', width: 1200})
  const card = (document: string, scenario: string) => gallery.frame.locator(`[data-entity-id="${id(document, scenario)}"]`)
  await expect(card('cards/scenarios.json', 'cards')).toHaveAttribute('data-change', /added/u)
  await expect(card('text-diff/scenarios.json', 'banner')).toHaveAttribute('data-change', /removed/u)
  const shop = card('graph/scenarios.json', 'shop')
  await expect(shop).toHaveAttribute('data-change', /modified/u)
  await expect(card('graph/scenarios.json', 'payments-split')).not.toHaveAttribute('data-change', /./u)
  // A redrawn scenario draws its after revision (with the cache), and its before revision on request.
  const drawn = gallery.frame.frameLocator(`[data-entity-id="${id('graph/scenarios.json', 'shop')}"] iframe`)
  await expect(drawn.locator('[data-entity-id="cache"]').first()).toBeAttached({timeout: 15_000})
  await shop.getByRole('button', {name: 'Before'}).click()
  await expect(shop.getByRole('button', {name: 'Before'})).toHaveAttribute('aria-pressed', 'true')
  await expect(drawn.locator('[data-entity-id="orders"]').first()).toBeAttached({timeout: 15_000})
  await expect(drawn.locator('[data-entity-id="cache"]')).toHaveCount(0)
  // A removed scenario draws the revision it was in.
  await card('text-diff/scenarios.json', 'banner').scrollIntoViewIfNeeded()
  const banner = gallery.frame.frameLocator(`[data-entity-id="${id('text-diff/scenarios.json', 'banner')}"] iframe`)
  await expect(banner.locator('[data-entity-id="out"]').first()).toBeAttached({timeout: 15_000})
})
