/*
 * Measurements that run inside a renderer document: through the check probe
 * the Inspector injects in fixtures mode, or from Playwright with
 * `frame.locator('body').evaluate(fn)`. `affordanceFailures` must stay
 * self-contained (no imports, closures or module helpers) so Playwright can
 * serialize it; the others are bundled into the probe.
 */
export {entitySamples, visibleEntities, identifierFonts, contentTop, entityTexts, legends} from './measure/entities.js'
export {horizontalOverflow, clippedContent} from './measure/overflow.js'
export {opening} from './measure/opening.js'
export {selectedEntities, hoveredEntities, clickEntity, clickBackground, settle} from './measure/interaction.js'
export {affordanceFailures} from './measure/affordances.js'
export {focusFailures} from './measure/focus.js'
export {ringNeutral, ringFailures, ringFocusFailures} from './measure/rings.js'
export {styleTokens, styleSystem} from './measure/styles.js'
export {stageSurface} from './measure/stage-surface.js'
