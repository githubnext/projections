import type {RouteMeasurement} from '../types.js'

/**
 * The routed links a renderer marks (`data-projections-route`): how many go around the cards, and each that had to
 * cross some (`crossing`), with the IDs of the cards it crosses (`data-projections-route-crosses`).
 */
export function linkRoutes(root: Element = document.body): RouteMeasurement {
  const routed = [...root.querySelectorAll('[data-projections-route]')]
  return {
    count: routed.length,
    crossing: routed
      .filter(element => element.getAttribute('data-projections-route') === 'crossing')
      .map(element => ({
        id: element.getAttribute('data-entity-id') ?? element.getAttribute('data-edge-key') ?? element.tagName.toLowerCase(),
        crosses: (element.getAttribute('data-projections-route-crosses') ?? '').split(' ').filter(Boolean),
      })),
  }
}
