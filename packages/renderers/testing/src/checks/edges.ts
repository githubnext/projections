// The check that a rounded, edged box draws its edge over what fills its corners (probe call `frames`).
import type {CoveredFrame} from '../types.js'
import {limit, primaryMode, type Checks} from './support.js'

export const edgeChecks: Pick<Checks, 'frame-edges'> = {
  async 'frame-edges'(driver, subject, {modes}) {
    const failures = new Map<string, {line: string; count: number}>()
    for (const colorMode of ['light', 'dark'] as const) {
      await driver.load(subject, {progress: 1, colorMode, ...primaryMode(subject, modes)})
      await driver.measure('settle')
      for (const {element, fill} of await driver.measure<CoveredFrame[]>('frames')) {
        const line = `${fill} fills a rounded corner of ${element} over its edge: draw the edge over it (the kit's \`pk-frame\`)`
        const key = line.replaceAll(/\[data-entity-id="[^"]*"\]/gu, '')
        const found = failures.get(key)
        if (found) found.count += 1
        else failures.set(key, {line, count: 1})
      }
    }
    const lines = [...failures.values()].map(({line, count}) => (count > 1 ? `${line} (${count} like it)` : line))
    return lines.length > limit ? [...lines.slice(0, limit), `… and ${lines.length - limit} more.`] : lines
  },
}
