// The check that change and accent colors never nest: only the innermost changed element is colored.
import type {ComparisonMode} from '@githubnext/projections-renderer-sdk/protocol'
import type {AccentPaint, NestedAccent, StageSubject} from '../types.js'
import type {CheckDriver} from './catalog.js'
import {limit, progressModes} from './support.js'
import type {Checks} from './support.js'

/** Where the check looks: the diff, and the animation after each step (or midway through a progress mode). */
async function presentations(
  driver: CheckDriver,
  subject: StageSubject,
  modes: readonly ComparisonMode[],
): Promise<{where: string; load: () => Promise<unknown>}[]> {
  if (subject.mode === 'extraction') return [{where: 'The extraction', load: () => driver.load(subject, {progress: 1})}]
  const views: {where: string; load: () => Promise<unknown>}[] = []
  if (modes.includes('diff')) {
    views.push({where: 'In the diff', load: () => driver.load(subject, {progress: 1, comparisonMode: 'diff', highlighting: 1})})
  }
  if (modes.includes('animated')) {
    const {steps} = await driver.load(subject, {progress: 0, comparisonMode: 'animated'})
    const ends = steps.filter(end => end > 0 && end < 1)
    const at = ends.length ? ends.filter((_, index) => index % Math.ceil(ends.length / 8) === 0) : [0.5]
    // The first loads the animation (the diff may have been loaded since), the rest seek through it.
    at.forEach((progress, index) => {
      views.push({
        where: `At progress ${Math.round(progress * 1000) / 1000}`,
        load: () =>
          index ? driver.seek(progress, {highlighting: 1}) : driver.load(subject, {progress, comparisonMode: 'animated', highlighting: 1}),
      })
    })
  } else {
    const progressMode = modes.find(mode => progressModes.includes(mode))
    if (progressMode) {
      views.push({
        where: 'At progress 0.5',
        load: () => driver.load(subject, {progress: 0.5, comparisonMode: progressMode, highlighting: 1}),
      })
    }
  }
  return views
}

const named = (paint: AccentPaint) => `${paint.element} (${paint.family} ${paint.property})`

/**
 * Whether a nesting breaks the rule: a different hue inside a change color, or the same hue painted by another
 * entity. An item's own emphasis in its own hue (its status text, icon, or marks within its line) is one accent.
 */
const nests = ({outer, inner}: NestedAccent) =>
  inner.family !== outer.family || (inner.entity !== undefined && inner.entity !== outer.entity)

export const accentChecks: Pick<Checks, 'nested-accents'> = {
  async 'nested-accents'(driver, subject, {modes}) {
    const failures = new Map<string, {line: string; count: number}>()
    for (const {where, load} of await presentations(driver, subject, modes)) {
      await load()
      await driver.measure('settle')
      for (const {outer, inner} of (await driver.measure<NestedAccent[]>('accents')).filter(nests)) {
        const line = `${where}: ${named(inner)} is drawn inside ${named(outer)}`
        const key = `${where}|${line.replace(/\[data-entity-id="[^"]*"\]/gu, '')}`
        const found = failures.get(key)
        if (found) found.count += 1
        else failures.set(key, {line, count: 1})
      }
    }
    const lines = [...failures.values()].map(({line, count}) => (count > 1 ? `${line} (${count} like it)` : line))
    return lines.length > limit ? [...lines.slice(0, limit), `… and ${lines.length - limit} more.`] : lines
  },
}
