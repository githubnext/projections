// How many components an architecture draws before its unchanged boundaries collapse.
import type {ComparisonModel} from '@githubnext/projections-renderer-kit'

/** Above this many components (cards that aren't boundaries), a comparison's unchanged boundaries collapse. */
export const collapseAbove = 40
/**
 * Above this many components, one revision's boundaries collapse too. Up to it every component is drawn, and the
 * canvas opens at the readable text floor on its top row: one revision has no changes for collapsed boundaries to set
 * apart, and a row of summary cards would need a click on each to read. Past it, routing every relationship takes too
 * long to open, and far too long for `projections check`, which lays a document out dozens of times (an architecture
 * of 70 components and 180 relationships takes 0.8 s a layout in Node, several times that on a CI runner's browser).
 */
export const oneRevisionCollapseAbove = 60

/** The most components a document draws before its unchanged boundaries collapse: one revision's limit, or a comparison's. */
export const collapseLimit = (mode: ComparisonModel['mode']) => (mode === 'extraction' ? oneRevisionCollapseAbove : collapseAbove)
