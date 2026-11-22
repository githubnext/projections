// The checks of a comparison's steps: still holds, and emphasis scoped to the steps so far.
import type {Comparison} from '@githubnext/projections-schemas'
import type {EntitySample, StageSubject} from '../../types.js'
import {Skip, limit, samples, label, type Checks} from '../support.js'
import {difference, looks, pick, touched, variedWithin} from './support.js'

const round = (value: number) => Math.round(value * 1e6) / 1e6

function steps(subject: StageSubject): Comparison['steps'] {
  return subject.mode === 'comparison' ? subject.comparison.steps : []
}

export const stepChecks: Pick<Checks, 'step-holds' | 'highlight-scope'> = {
  async 'step-holds'(driver, subject, {modes}) {
    if (subject.mode !== 'comparison') throw new Skip('Single extractions have no steps.')
    if (!modes.includes('animated')) throw new Skip('The renderer does not declare the animated comparison mode.')
    const state = await driver.load(subject, {progress: 0})
    const ends = state.steps.filter(end => end > 0 && end < 1)
    if (!ends.length) throw new Skip('The renderer reports no step holds.')
    const spacing = Math.min(...ends.slice(1).map((end, index) => end - ends[index]!), Infinity)
    const delta = round(Math.min(0.003, spacing / 12))
    const failures: string[] = []
    for (const end of pick(ends, 12)) {
      const frames: [string, Map<string, EntitySample>][] = []
      for (const progress of [round(end - delta), end, round(end + delta)]) {
        await driver.seek(progress, {highlighting: 1})
        frames.push([label(progress), await samples(driver)])
        if (progress === end) {
          await driver.sleep(250)
          frames.push([`${label(end)} 250 ms later`, await samples(driver)])
        }
      }
      const [, reference] = frames[1]!
      for (const [where, frame] of frames) {
        if (frame === reference) continue
        for (const key of new Set([...frame.keys(), ...reference.keys()])) {
          const a = reference.get(key),
            b = frame.get(key)
          if (failures.length >= limit) return failures
          if (!a || !b) failures.push(`In the hold at ${end}, "${key}" ${a ? 'disappears' : 'appears'} at ${where}.`)
          else if (a.box.join(',') !== b.box.join(',') || a.opacity !== b.opacity || looks(a) !== looks(b)) {
            failures.push(`In the hold at ${end}, "${key}" changes at ${where}: ${difference(a, b)}.`)
          }
        }
      }
    }
    return failures
  },

  async 'highlight-scope'(driver, subject, {modes}) {
    if (subject.mode !== 'comparison') throw new Skip('Single extractions have no steps.')
    if (!modes.includes('animated')) throw new Skip('The renderer does not declare the animated comparison mode.')
    const state = await driver.load(subject, {progress: 0})
    const ends = state.steps.filter(end => end > 0 && end < 1)
    const ordered = steps(subject)
    if (!ordered.length) throw new Skip('The comparison has no steps.')
    if (ends.length !== ordered.length) {
      throw new Skip(`The renderer reports ${ends.length} holds for ${ordered.length} steps, so holds can't be matched to steps.`)
    }
    const touches = touched(subject)
    const varied = variedWithin(subject)
    const stepOf = (id: string) => touches.findIndex(set => set.has(id))
    const failures: string[] = []
    const allowed = new Set<string>()
    for (const [index, end] of ends.entries()) {
      for (const id of touches[index]!) allowed.add(id)
      if (index >= 12 && index !== ends.length - 1) continue
      await driver.seek(end, {highlighting: 1})
      const on = await samples(driver)
      await driver.seek(end, {highlighting: 0})
      const off = await samples(driver)
      for (const [key, sample] of on) {
        const neutral = off.get(key)
        // A unit may show its parts' emphasis (a card tinting the zone of a changed part).
        if (!neutral || looks(neutral) === looks(sample) || allowed.has(sample.id) || sample.parts.some(part => allowed.has(part))) continue
        const step = stepOf(sample.id)
        failures.push(
          `After step ${index + 1} of ${ordered.length}, "${key}" is emphasized, but ${step < 0 ? (varied.has(sample.id) ? 'it varied only within tolerance, so it is unchanged' : 'no step changes it') : `step ${step + 1} changes it`}.`,
        )
        if (failures.length >= limit) return failures
      }
    }
    return failures
  },
}
