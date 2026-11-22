import {expect, test} from '@playwright/test'
import {openRenderer, samples} from '@githubnext/projections-renderer-harness/playwright'
import type {FixturePair} from './fixtures.js'
import {arrowContacts, contactIssues} from './invariants/contacts.js'
import {measureFrame, type FrameMeasurement} from './invariants/frame.js'
import {scrubFailures} from './invariants/scrub.js'

const ids = (frame: FrameMeasurement) =>
  [...new Set([...frame.cards.filter(card => card.opacity > 0.999).map(card => card.id), ...frame.groups])].sort()

/**
 * Dense-scrub suite for staged graph-family renderers in the real host frame:
 * 1% steps from Before to After and back, plus 0.25% steps through the first
 * step window. Every painted frame must keep cards apart, arrows attached (each
 * head's painted tip touching its card's painted border) and framing fixed; endpoints show exactly their revision with no change
 * decoration; each progress renders the same frame from either direction.
 */
export function scrubSuite(pairs: readonly FixturePair[]) {
  for (const pair of pairs) {
    test(`${pair.name}: dense scrubbing keeps staged motion coherent`, async ({page}) => {
      test.setTimeout(180_000)
      const renderer = await openRenderer(page, {renderer: pair.renderer, before: pair.before, after: pair.after, progress: 0})
      const root = renderer.frame.locator('.pk')
      const state = await renderer.state()
      // One graph bundle presents every staged-graph renderer name.
      expect(state.bundle).toBe(
        ['graph-horizontal', 'dag', 'architecture', 'infrastructure'].includes(pair.renderer) ? 'graph' : pair.renderer,
      )
      expect(state.steps.length, 'the renderer reports where a host may hold').toBeGreaterThan(0)
      expect(state.steps).toEqual([...state.steps].sort((a, b) => a - b))

      const frames: FrameMeasurement[] = []
      await renderer.scrub(samples(100, {roundTrip: true}), async () => {
        const frame = await root.evaluate(measureFrame)
        frame.issues.push(...contactIssues(await root.evaluate(arrowContacts)))
        frames.push(frame)
      })
      const first = state.steps[0]!
      const fine = Array.from({length: 41}, (_, index) => Math.round((Math.max(0, first - 0.2) + index * 0.005) * 1e6) / 1e6).filter(
        value => value <= 1,
      )
      await renderer.scrub([...fine, ...[...fine].reverse()], async () => {
        const frame = await root.evaluate(measureFrame)
        frame.issues.push(...contactIssues(await root.evaluate(arrowContacts)))
        frames.push(frame)
      })
      expect(scrubFailures(frames)).toEqual([])

      const at = (progress: number) => frames.find(frame => frame.progress === progress)!
      // Rows are identified by their after ID when a declared rename (previousIds) carries a before entity on.
      const renamed = new Map(pair.after.entities.flatMap(entity => (entity.previousIds ?? []).map(previous => [previous, entity.id])))
      const changedIds = (side: 'before' | 'after') =>
        pair[side].entities.map(entity => (side === 'before' ? (renamed.get(entity.id) ?? entity.id) : entity.id)).sort()
      expect(ids(at(0))).toEqual(changedIds('before'))
      expect(ids(at(1))).toEqual(changedIds('after'))
      expect(
        frames.some(frame => frame.decorated.length > 0),
        'changes are emphasized mid-transition',
      ).toBe(true)
    })
  }
}

/** Selection round trip: clicking a card reports it, and a host selection marks it. */
export function selectionSuite(pair: FixturePair, id: string) {
  test(`${pair.name}: selection is reported to and accepted from the host`, async ({page}) => {
    const renderer = await openRenderer(page, {renderer: pair.renderer, before: pair.before, after: pair.after, progress: 1})
    const card = renderer.frame.locator(`[data-entity-id="${id}"]`).first()
    await card.click()
    await expect.poll(async () => (await renderer.state()).selections.at(-1)).toBe(id)
    await renderer.select(null)
    await expect(renderer.frame.locator('.selected')).toHaveCount(0)
    await renderer.select(id)
    await expect(renderer.frame.locator(`.selected[data-entity-id="${id}"]`)).toHaveCount(1)
  })
}
