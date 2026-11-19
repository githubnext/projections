import type {Extraction, Relationship} from '@githubnext/projections-schemas'
export * from './generated.js'
export * from './quantities.js'
export * from './steps.js'
export * from './schedule.js'
export * from './summary.js'

export * from './presentation/viewer.js'
export * from './presentation/varied.js'
export * from './presentation/changes.js'
export * from './presentation/progress.js'
export * from './presentation/frame.js'
export * from './presentation/filter.js'
export * from './presentation/context.js'

/**
 * Marks an element whose text is a code identifier or symbol (a function,
 * type or package name, a path, route, event name, resource address or ID),
 * which renderers draw in the theme's monospace font
 * (`--projections-font-family-mono`) while human-language labels stay in the
 * sans font. The built-in `identifiers` check verifies that every marked
 * element computes a monospace font.
 */
export const identifierAttribute = 'data-projections-identifier'
/** Spread onto an element (HTML or SVG) to mark it as an identifier: `<span {...identifier}>`. */
export const identifier = {[identifierAttribute]: ''} as const

/**
 * The smallest text, in CSS px, a zoomable canvas (a scroll container marked
 * `data-zoom`) opens with. It opens fitted, everything in view, unless that
 * draws its smallest text below this: then it opens zoomed until that text is
 * this size, at the content's start (its top left, or the top centre of a
 * centred layout), and the person scrolls and pans the rest; a diff, or a host's
 * focus (`RendererFocus`), opens on its changes instead. Fit to view still
 * shows everything, however small. The kit's `useStageZoom` applies it and the
 * built-in `opens-fitted` check verifies it. Added on 2026-11-10, the day
 * always fitting was adopted, after fitting drew the largest graphs' text at
 * 2-6 px.
 */
export const openingFloorPx = 8

/** Relationship kinds too generic to add anything to a label. */
const genericKinds = new Set(['', 'relationship', 'relation', 'edge', 'link', 'reference'])

/**
 * A readable name for a relationship: its own `label` when it has one, else
 * its endpoints' labels joined by an arrow, with the kind when it says
 * something, for example "api → queue (publishes)". `entityLabel` looks up an
 * entity's label in the extraction the relationship comes from; endpoints it
 * doesn't know show their IDs.
 */
export function relationshipLabel(
  relationship: Pick<Relationship, 'from' | 'to' | 'kind' | 'label'>,
  entityLabel?: (id: string) => string | undefined,
): string {
  if (relationship.label) return relationship.label
  const endpoint = (id: string) => entityLabel?.(id) ?? id
  const kind = relationship.kind?.trim() ?? ''
  return `${endpoint(relationship.from)} → ${endpoint(relationship.to)}${genericKinds.has(kind.toLowerCase()) ? '' : ` (${kind})`}`
}

/** Looks up entity labels in extractions, the first that has the entity winning (for example after, then before). */
export function entityLabels(...extractions: readonly (Pick<Extraction, 'entities'> | undefined)[]): (id: string) => string | undefined {
  const labels = new Map<string, string>()
  for (const extraction of [...extractions].reverse())
    for (const entity of extraction?.entities ?? []) labels.set(entity.id, entity.label ?? entity.id)
  return id => labels.get(id)
}
