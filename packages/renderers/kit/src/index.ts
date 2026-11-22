// The renderer kit's framework-free entry: the comparison model, step timeline and staged motion, ELK graph layout,
// arrow routing, diff mode, card text metrics, change status, palettes and presentation helpers. Nothing here (or
// anything it imports) imports React; the components and hooks are `./react` (src/react.ts).
export * from './model.js'
export * from './timeline.js'
export * from './stages.js'
export * from './motion.js'
export * from './layout.js'
export {boxEdgeTurn, type EdgeTurn} from './edge-arrows/corridor.js'
export {NoRouteError, boxEdge, routeBoxEdge, type BlockedBoxEdge, type BoxEdge} from './edge-arrows/box-edge.js'
export * from './edge-arrows.js'
export * from './arrowhead.js'
export * from './border.js'
export * from './splines.js'
export * from './routes/s-bend.js'
export * from './routes/ports.js'
export * from './routes/tracks.js'
export * from './routes/smooth.js'
export * from './routes/crossings.js'
export * from './routes/turns.js'
export {createGraphTransition} from './graph-transition/create.js'
export {smoothJoins} from './graph-transition/morph.js'
export type * from './graph-transition.js'
export * from './emphasis.js'
export * from './domain.js'
export * from './diff/model.js'
export * from './diff/fields.js'
export * from './diff/lines.js'
export * from './card-text.js'
export * from './diff-card/metrics.js'
export {diffCardText} from './diff-card/text.js'
export {svgStatusWidth} from './svg-status.js'
export * from './counts.js'
export * from './card-icons.js'
export * from './wrap.js'
export * from './legend.js'
export * from './identifiers.js'
export {focusedIds, placedAttribute} from './focus.js'
export {changesScope, foldList, foldPrefix, isFold, scopedModel} from './scope.js'
export {followContext} from './scope-context.js'
export {layoutFilter, partOwners} from './scope-filter.js'
export type {ContextPaths} from './scope-context.js'
export type {ChangesScope, Folded, ScopedModel, ScopedParts, ScopeView} from './scope.js'
export * from './summary.js'
export {cardBox, drawnEdge, raisedEdges, type OrderedEdge} from './graph-canvas/edges.js'
export {badgeMetrics, badgeText, pillMetrics, placeBadges, textPill} from './graph-canvas/badges.js'
export type {CardAccent, CardBadge} from './graph-canvas/badges.js'
export * from './controls.js'
export * from './table.js'
export * from './table-controls.js'
export * from './fit.js'
export * from './zoom.js'
export * from './palette.js'
export {
  variedBeyond,
  variedBeyondLabel,
  variedName,
  variedValue,
  variedWithin,
  variedWords,
} from '@githubnext/projections-renderer-sdk/presentation'
export {plainProse, proseSpans} from '@githubnext/projections-schemas'
export type {ProseSpan} from '@githubnext/projections-schemas'
export {token, tokenVar} from '@githubnext/projections-renderer-sdk/protocol'
export type {
  ColorTokenName,
  FontSizeStep,
  FontWeightStep,
  IconName,
  RadiusStep,
  SpaceStep,
} from '@githubnext/projections-renderer-sdk/protocol'
