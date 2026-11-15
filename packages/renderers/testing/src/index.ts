// Browser-safe entry: types, the built-in checks and the in-document measurements.
export {allChecks, checkDescriptions, checkTitles, declaredModes, runChecks} from './checks.js'
export type {CheckDriver, CheckOptions} from './checks.js'
export {
  affordanceFailures,
  clickEntity,
  clippedContent,
  contentTop,
  entityTexts,
  identifierFonts,
  entitySamples,
  hoveredEntities,
  horizontalOverflow,
  legends,
  selectedEntities,
  settle,
  stageSurface,
  styleSystem,
  styleTokens,
  visibleEntities,
} from './measure.js'
export type * from './types.js'
