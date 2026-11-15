// What stands in a boundary card's place once the person activates it, which the next view keeps where the card was.
import {collapsePrefix, restPrefix, summaryPrefix} from './collapse.js'
import type {BoundaryCard} from './collapse.js'

/**
 * What stands in a boundary card's place once it is activated: the boundary a summary card expands into, the card that
 * collapses what a `rest` card opens, and the summary or `rest` card a collapse card leaves.
 */
export function replacement(card: BoundaryCard): string {
  if (!card.open) return card.rest ? `${collapsePrefix}${card.boundary}` : card.boundary
  return `${card.rest ? restPrefix : summaryPrefix}${card.boundary}`
}
