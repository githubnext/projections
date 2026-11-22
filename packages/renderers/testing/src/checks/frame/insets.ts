// The check that cards, panels and tables sit evenly on the stage: the same inset from the frame on all four sides.
import type {StageInsetsMeasurement} from '../../types.js'
import {Skip, primaryMode, type Checks} from '../support.js'

/** How far apart, CSS px, the four insets may be: sub-pixel layout rounds each edge. */
const tolerance = 1
const fix =
  "inset them equally: pad the content root by the stage padding on all four sides (the kit's ContentView or class " +
  'pk-stage, else var(--projections-stage-inset, 12px), and at the top at least the stage-inset-top) and give the ' +
  'outer cards no margins.'

export const insetChecks: Pick<Checks, 'stage-insets'> = {
  async 'stage-insets'(driver, subject, {modes, phoneWidth}) {
    const failures: string[] = []
    let measured = 0
    for (const width of [undefined, phoneWidth]) {
      await driver.load(subject, {progress: 1, ...primaryMode(subject, modes), ...(width !== undefined && width !== 0 ? {width} : {})})
      await driver.measure('settle')
      const found = await driver.measure<StageInsetsMeasurement>('stageInsets')
      if (found.fitted) throw new Skip(`The renderer centres a fitted drawing (${found.fitted}) instead of standing cards on its stage.`)
      if (!found.insets) continue
      measured++
      const {top, right, bottom, left} = found.insets
      // The top keeps clear of what the host overlays there: the larger of the other sides' inset and stage-inset-top.
      const sides = [right, bottom, left]
      const expectedTop = Math.max(Math.min(...sides), found.overlaid ?? 0)
      if (Math.max(...sides) - Math.min(...sides) <= tolerance && Math.abs(top - expectedTop) <= tolerance) continue
      const where = width !== undefined && width !== 0 ? `At ${width}px` : 'At full width'
      const cards = `${found.first}${found.cards > 1 ? ` and ${found.cards - 1} more` : ''}`
      failures.push(
        `${where}, the cards on the stage (${cards}) are ${top}px from the frame's top, ${right}px from its right, ` +
          `${bottom}px from the content's end and ${left}px from its left` +
          `${found.overlaid !== undefined && found.overlaid !== 0 ? ` (the host overlays the top ${found.overlaid}px: stage-inset-top)` : ''}; ${fix}`,
      )
    }
    if (!measured) throw new Skip('The renderer stands no cards, panels or tables on its stage.')
    return failures
  },
}
