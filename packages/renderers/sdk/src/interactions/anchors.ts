// Reporting where items are drawn (`anchor`): the selected and hovered items always, visible annotated items at a
// bounded rate.
import type {RendererClient} from '../client.js'
import type {AnchorRect} from '../protocol.js'
import {sameRect} from './geometry.js'

/** Most annotated items whose anchors are reported, among those visible. */
const annotatedAnchorLimit = 200
/** Sustained and burst rate of anchors for annotated items, within the host's message budget. */
const annotatedAnchorRate = 40
const annotatedAnchorBurst = 80

export interface AnchorReport {
  /** The selected and hovered items, reported whenever they move. */
  primary: Set<string>
  /** Where a primary item is visible, or `null`. */
  rectOf(id: string): AnchorRect | null
  /** Where each visible annotated item is, in document order. */
  annotated: Map<string, AnchorRect>
  /** Whether an item is annotated. */
  isAnnotated(id: string): boolean
}

export interface AnchorReporter {
  /** Reports the anchors that changed since the last report; retries what the rate deferred with `schedule`. */
  report(report: AnchorReport): void
  dispose(): void
}

/** Reports anchors to `client`, calling `schedule` to measure again when it had to defer some. */
export function createAnchorReporter(view: Window, client: RendererClient, schedule: () => void): AnchorReporter {
  const anchors = new Map<string, AnchorRect | null>()
  /** Annotated IDs whose last reported anchor was a rectangle; they get `null` when they stop being reported. */
  const annotatedAnchors = new Set<string>()
  let budget = annotatedAnchorBurst
  let budgetAt = view.performance.now()
  let retry = 0

  /** Spends one annotated-anchor message from the budget, if any is left. */
  function spend(): boolean {
    const now = view.performance.now()
    budget = Math.min(annotatedAnchorBurst, budget + ((now - budgetAt) * annotatedAnchorRate) / 1000)
    budgetAt = now
    if (budget < 1) return false
    budget -= 1
    return true
  }
  const unchanged = (id: string, rect: AnchorRect | null) => anchors.has(id) && sameRect(anchors.get(id), rect)

  /** Forgets the items no longer tracked; returns whether the rate deferred any. */
  function forget(tracked: Set<string>): boolean {
    let deferred = false
    for (const id of anchors.keys()) {
      if (tracked.has(id)) continue
      // An annotated item that scrolled out of view or lost its annotation gets an explicit `null`.
      if (annotatedAnchors.has(id) && anchors.get(id)) {
        if (!spend()) {
          deferred = true
          continue
        }
        client.anchor(id, null)
      }
      annotatedAnchors.delete(id)
      anchors.delete(id)
    }
    return deferred
  }

  /** Reports the visible annotated items' anchors that changed; returns whether the rate deferred any. */
  function reportSecondary(secondary: string[], annotated: Map<string, AnchorRect>): boolean {
    for (const id of secondary) {
      const rect = annotated.get(id) ?? null
      if (unchanged(id, rect)) continue
      if (!spend()) return true
      anchors.set(id, rect)
      annotatedAnchors.add(id)
      client.anchor(id, rect)
    }
    return false
  }

  return {
    report({primary, rectOf, annotated, isAnnotated}) {
      const secondary = [...annotated.keys()].filter(id => !primary.has(id)).slice(0, annotatedAnchorLimit)
      let deferred = forget(new Set([...primary, ...secondary]))
      for (const id of primary) {
        const rect = rectOf(id)
        if (unchanged(id, rect)) continue
        anchors.set(id, rect)
        if (isAnnotated(id) && rect) annotatedAnchors.add(id)
        client.anchor(id, rect)
      }
      if (reportSecondary(secondary, annotated)) deferred = true
      if (deferred && !retry) {
        retry = view.setTimeout(
          () => {
            retry = 0
            schedule()
          },
          Math.ceil(1000 / annotatedAnchorRate),
        )
      }
    },
    dispose: () => view.clearTimeout(retry),
  }
}
