// The checks of diff mode: every change shown, unchanged items neutral, nothing clipped.
import type {Extraction} from '@githubnext/projections-schemas'
import type {ComparisonMode} from '@githubnext/projections-renderer-sdk/protocol'
import type {EntitySample, StageSubject} from '../../types.js'
import type {CheckDriver} from '../catalog.js'
import {Skip, limit, samples} from '../support.js'
import type {Checks} from '../support.js'
import {changedEntities, difference, looks, touched, variedWithin} from './support.js'

async function diffSamples(driver: CheckDriver, subject: StageSubject, width?: number): Promise<Map<string, EntitySample>> {
  await driver.load(subject, {progress: 1, comparisonMode: 'diff', ...(width !== undefined && width !== 0 ? {width} : {})})
  return samples(driver)
}

async function unchangedDiff(driver: CheckDriver, extraction: Extraction): Promise<Map<string, EntitySample>> {
  return diffSamples(driver, {
    mode: 'comparison',
    before: extraction,
    after: extraction,
    comparison: await driver.compare(extraction, extraction),
  })
}

function requireDiff(
  subject: StageSubject,
  modes: readonly ComparisonMode[],
): asserts subject is Extract<StageSubject, {mode: 'comparison'}> {
  if (subject.mode !== 'comparison') throw new Skip('Single extractions have no diff mode.')
  if (!modes.includes('diff')) throw new Skip('The renderer does not declare the diff comparison mode.')
}

export const diffChecks: Pick<Checks, 'diff-changes' | 'diff-neutral' | 'diff-clipping'> = {
  async 'diff-changes'(driver, subject, {modes}) {
    requireDiff(subject, modes)
    const changes = changedEntities(subject.comparison)
    if (!changes.length) throw new Skip('The comparison changes no entities.')
    const shown = [...(await diffSamples(driver, subject)).values()]
    const references = {before: await unchangedDiff(driver, subject.before), after: await unchangedDiff(driver, subject.after)}
    const failures: string[] = []
    for (const change of changes) {
      const ids = new Set([change.id, ...change.before, ...change.after])
      const drawn = shown.filter(sample => ids.has(sample.id))
      const describe = `${change.status}${change.before.join() !== change.after.join() && change.before.length && change.after.length ? ' (renamed)' : ''} "${change.id}"`
      if (!drawn.length) {
        failures.push(
          `The ${describe} change isn't drawn: no visible element has data-entity-id ${[...ids].map(id => `"${id}"`).join(' or ')}.`,
        )
      } else {
        const side = change.after.length ? references.after : references.before
        const reference = [...side.values()].find(sample => (change.after.length ? change.after : change.before).includes(sample.id))
        if (reference && drawn.every(sample => looks(sample) === looks(reference))) {
          failures.push(`The ${describe} change is drawn exactly as an unchanged comparison draws it, so nothing marks it as changed.`)
        }
      }
      if (failures.length >= limit) break
    }
    return failures
  },

  async 'diff-neutral'(driver, subject, {modes}) {
    requireDiff(subject, modes)
    const touches = new Set(touched(subject).flatMap(set => [...set]))
    for (const change of subject.comparison.changes) {
      if (change.status !== 'unchanged') for (const id of [change.id, ...change.before, ...change.after]) touches.add(id)
    }
    const shown = await diffSamples(driver, subject)
    const reference = await unchangedDiff(driver, subject.after)
    const varied = variedWithin(subject)
    const failures: string[] = []
    let compared = 0
    for (const [key, sample] of shown) {
      if (touches.has(sample.id) || sample.parts.some(part => touches.has(part))) continue
      const neutral = reference.get(key)
      if (!neutral) continue
      compared++
      if (looks(sample) !== looks(neutral)) {
        failures.push(
          `"${key}" is unchanged${varied.has(sample.id) ? ' (it varied only within tolerance)' : ''} but emphasized: compared with an unchanged comparison, ${difference(neutral, {...sample, box: neutral.box, opacity: neutral.opacity})}.`,
        )
      }
      if (failures.length >= limit) break
    }
    if (!compared) throw new Skip('Every drawn entity is touched by a change, so there is nothing unchanged to compare.')
    return failures
  },

  async 'diff-clipping'(driver, subject, {modes, phoneWidth}) {
    requireDiff(subject, modes)
    const failures: string[] = []
    for (const width of [undefined, phoneWidth]) {
      await driver.load(subject, {progress: 1, comparisonMode: 'diff', ...(width !== undefined && width !== 0 ? {width} : {})})
      await driver.measure('settle')
      const where = width !== undefined && width !== 0 ? `At ${width}px, ` : ''
      for (const clipped of await driver.measure<string[]>('clipping')) failures.push(`${where}${clipped}.`)
    }
    return failures.slice(0, limit)
  },
}
