import {createNativeEngine} from '@githubnext/projections-engine/native'
import {comparisonModel, extractionModel, scheduleSteps, stepEnds, stepHolds} from '@githubnext/projections-renderer-kit'

/** Real default comparator, so tests see the same comparison a host would send. */
export const engine = createNativeEngine()

/** Pass `custom` to present another comparator's comparison of the same pair; it is validated like any other. */
export async function compared(before, after, custom) {
  const comparison = custom ? await engine.validateComparison(before, after, custom) : await engine.compare(before, after)
  return {comparison, model: comparisonModel(before, after, comparison)}
}
export {extractionModel, scheduleSteps, stepEnds, stepHolds}
