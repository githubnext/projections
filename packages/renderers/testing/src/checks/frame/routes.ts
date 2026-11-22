// The check that routed links go around the cards, or report the ones that can't.
import type {RouteMeasurement} from '../../types.js'
import {Skip, limit, primaryMode, type Checks} from '../support.js'

export const routeChecks: Pick<Checks, 'link-routes'> = {
  async 'link-routes'(driver, subject, {modes}) {
    const failures: string[] = []
    let count = 0
    const views =
      subject.mode === 'comparison' && modes.includes('diff')
        ? [
            {where: 'In the diff', options: {progress: 1, comparisonMode: 'diff' as const}},
            {where: 'At the end', options: {progress: 1, ...primaryMode(subject, modes)}},
          ]
        : [{where: 'At the end', options: {progress: 1, ...primaryMode(subject, modes)}}]
    for (const {where, options} of views) {
      await driver.load(subject, options)
      await driver.measure('settle')
      const measured = await driver.measure<RouteMeasurement | undefined>('routes')
      if (!measured) throw new Skip("The probe doesn't measure link routes (the 'routes' call).")
      count += measured.count
      for (const link of measured.crossing) {
        failures.push(
          `${where}, no route around the cards exists for ${link.id}: it is drawn across ${link.crosses.join(', ') || 'a card'}, the way that overlaps them least.`,
        )
      }
    }
    if (!count) throw new Skip('The renderer routes no links between cards (data-projections-route).')
    return failures.slice(0, limit)
  },
}
