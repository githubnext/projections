import {expect, test} from '@playwright/test'
import {openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import type {FixturePair} from './fixtures.js'

interface CardStatus {
  id: string
  box: [number, number, number, number]
  change?: string
  status: string
}

/**
 * Every graph card's box, emphasized change class and footer status text. The box is the card's own surface: the
 * group's box is the union of its children, and highlighting adds a footer band whose path bounds WebKit computes a
 * hundred-thousandth of a pixel off the surface's, which rounding can turn into a hundredth.
 */
function measureCards(root: Element): CardStatus[] {
  return [...root.querySelectorAll<SVGGElement>('svg.graph .graph-node[data-entity-id]')].map(node => {
    const {x, y, width, height} = (node.querySelector(':scope > .node-surface') ?? node).getBoundingClientRect()
    const emphasis = node.querySelector(':scope > .node-emphasis')
    const change = emphasis ? [...emphasis.classList].find(name => name !== 'node-emphasis') : undefined
    const status = [...node.querySelectorAll(':scope > .node-status .pk-svg-status, :scope > .pk-svg-status')]
      .map(text => text.textContent)
      .join(' ')
    return {
      id: node.dataset.entityId!,
      box: [x, y, width, height].map(value => Math.round(value * 100) / 100) as CardStatus['box'],
      ...(change ? {change} : {}),
      status,
    }
  })
}

const words: Record<string, RegExp> = {added: /Added/u, removed: /Removed/u, modified: /Modified/u, renamed: /Renamed/u}

/**
 * Change status on graph cards: while a change is emphasized its card states
 * it as text (an icon and a word) in the card's reserved footer; highlighting
 * never moves or resizes a card; and neither endpoint shows any status.
 */
export function statusSuite(pair: FixturePair) {
  test(`${pair.name}: cards state change status as text in a reserved footer`, async ({page}) => {
    const renderer = await openRenderer(page, {renderer: pair.renderer, before: pair.before, after: pair.after, progress: 0})
    const root = renderer.frame.locator('.pk')
    const {steps} = await renderer.state()
    let emphasized = 0
    for (const progress of [0, 0.25, 0.5, 0.75, 1, ...steps]) {
      await renderer.seek(progress, {highlighting: 'off'})
      const plain = await root.evaluate(measureCards)
      await renderer.seek(progress, {highlighting: 1})
      const highlighted = await root.evaluate(measureCards)
      expect(
        highlighted.map(card => [card.id, card.box]),
        `highlighting moves no card at ${progress}`,
      ).toEqual(plain.map(card => [card.id, card.box]))
      expect(
        plain.filter(card => card.status),
        `no status without highlighting at ${progress}`,
      ).toEqual([])
      for (const card of highlighted) {
        if (card.change) {
          emphasized++
          expect(card.status, `${card.id} (${card.change}) at ${progress}`).toMatch(words[card.change]!)
        } else expect(card.status, `${card.id} at ${progress}`).toBe('')
      }
    }
    expect(emphasized, 'changes are emphasized at their steps').toBeGreaterThan(0)
    for (const progress of [0, 1]) {
      await renderer.seek(progress, {highlighting: 'auto'})
      await expect(root.locator('.pk-svg-status'), `quiet endpoint ${progress}`).toHaveCount(0)
    }
  })
}

/**
 * Side by side (and swipe) holds each revision in its own pane: a static comparison, not a moment of the transition.
 * With highlighting on, the Before pane marks every removed card it draws as removed, and the After pane every added
 * one as added, in the same footer status as anywhere else; with highlighting off, neither pane marks anything.
 */
export function paneStatusSuite(pair: FixturePair) {
  test(`${pair.name}: side by side marks removals in Before and additions in After`, async ({page}) => {
    const ids = (extraction: FixturePair['before']) => new Set(extraction.entities.map(entity => entity.id))
    const [before, after] = [ids(pair.before), ids(pair.after)]
    let checked = 0
    for (const [pane, progress, change, expected] of [
      ['before', 0, 'removed', [...before].filter(id => !after.has(id))],
      ['after', 1, 'added', [...after].filter(id => !before.has(id))],
    ] as const) {
      const renderer = await openRenderer(page, {
        renderer: pair.renderer,
        before: pair.before,
        after: pair.after,
        progress,
        comparisonMode: 'side-by-side',
        pane,
        highlighting: 1,
      })
      const root = renderer.frame.locator('.pk')
      const cards = await root.evaluate(measureCards)
      const marked = cards.filter(card => expected.includes(card.id))
      expect(marked.length, `${pane}: draws ${change} cards`).toBeGreaterThan(expected.length ? 0 : -1)
      checked += marked.length
      for (const card of marked) {
        expect(card.change, `${pane}: ${card.id} is drawn as ${change}`).toBe(change)
        expect(card.status, `${pane}: ${card.id} says so`).toMatch(words[change]!)
        await expect(
          root.locator(`.graph-node[data-entity-id="${card.id}"] [data-change-status="${change}"]`),
          `${pane}: ${card.id} carries data-change-status="${change}"`,
        ).toHaveCount(1)
      }
      await renderer.seek(progress, {highlighting: 'off'})
      await expect(root.locator('.pk-svg-status'), `${pane}: no status with highlighting off`).toHaveCount(0)
    }
    expect(checked, 'the comparison removes or adds a card').toBeGreaterThan(0)
  })
}
