// The check that a chip, bar or button centres its text on its capitals (probe call `labels`).
import type {OffCentreLabel, OffPixelChild} from '../types.js'
import {limit, primaryMode, type Checks} from './support.js'

export const labelChecks: Pick<Checks, 'label-centring' | 'centred-pixels'> = {
  async 'label-centring'(driver, subject, {modes}) {
    await driver.load(subject, {progress: 1, ...primaryMode(subject, modes)})
    await driver.measure('settle')
    const failures = new Map<string, {line: string; count: number}>()
    for (const {element, above, below} of await driver.measure<OffCentreLabel[]>('labels')) {
      const where = above < below ? 'high' : 'low'
      const line = `${element} sets its text ${Math.round(Math.abs(above - below) * 50) / 100}px ${where} of its centre (${above}px above the capitals, ${below}px below the baseline): put the text in the kit's \`pk-label\``
      const key = line.replaceAll(/\[data-entity-id="[^"]*"\]/gu, '').replaceAll(/[\d.]+px/gu, '')
      const found = failures.get(key)
      if (found) found.count += 1
      else failures.set(key, {line, count: 1})
    }
    const lines = [...failures.values()].map(({line, count}) => (count > 1 ? `${line} (${count} like it)` : line))
    return lines.length > limit ? [...lines.slice(0, limit), `… and ${lines.length - limit} more.`] : lines
  },

  async 'centred-pixels'(driver, subject, {modes}) {
    await driver.load(subject, {progress: 1, ...primaryMode(subject, modes)})
    await driver.measure('settle')
    const failures = new Map<string, {line: string; count: number}>()
    for (const {element, holder, axis, before, after} of await driver.measure<OffPixelChild[]>('pixels')) {
      const sides = axis === 'vertical' ? ['above', 'below'] : ['left', 'right']
      const line = `${element} sits ${before}px ${sides[0]} and ${after}px ${sides[1]} in ${holder}: centre it on whole pixels, in whole, even room (the kit's \`pk-label\` and even icons)`
      const key = line.replaceAll(/\[data-entity-id="[^"]*"\]/gu, '').replaceAll(/[\d.]+px/gu, '')
      const found = failures.get(key)
      if (found) found.count += 1
      else failures.set(key, {line, count: 1})
    }
    const lines = [...failures.values()].map(({line, count}) => (count > 1 ? `${line} (${count} like it)` : line))
    return lines.length > limit ? [...lines.slice(0, limit), `… and ${lines.length - limit} more.`] : lines
  },
}
