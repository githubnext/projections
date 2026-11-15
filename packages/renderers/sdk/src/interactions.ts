// Hover, anchors, scroll mirroring, the host's filter and annotation badges for a renderer's DOM (`interactions/`).
export {
  hoveredAttribute,
  unitAttribute,
  filteredAttribute,
  annotationAnchorAttribute,
  annotationAnchors,
  scrollAttribute,
  annotatedAttribute,
  annotationAttribute,
  pulseAttribute,
} from './interactions/attributes.js'
export type {AnnotationAnchor} from './interactions/attributes.js'
export {annotationName} from './interactions/names.js'
export {interactionCapabilities, connectInteractions} from './interactions/connect.js'
export type {InteractionOptions, InteractionController} from './interactions/connect.js'
