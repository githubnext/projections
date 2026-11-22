// The checks of a comparison's endpoints: neutral at progress 0 and 1, with no status text.
import {Skip, progressModes, limit, samples, label} from '../support.js'
import type {Checks} from '../support.js'
import {difference, looks} from './support.js'
import {statusWords} from './status.js'

export const endpointChecks: Pick<Checks, 'neutral-endpoints' | 'quiet-endpoints'> = {
  async 'neutral-endpoints'(driver, subject, {modes}) {
    if (subject.mode !== 'comparison') throw new Skip('Single extractions have no endpoints.')
    if (!modes.some(mode => progressModes.includes(mode))) {
      throw new Skip('The renderer presents comparisons only in diff mode, which has no endpoints.')
    }
    const failures: string[] = []
    let compared = 0
    // Categorical colours may be ranked over both revisions; what matters is that each keeps one colour.
    const palette = new Map<string, {color: string; at: string}>()
    for (const [progress, extraction] of [
      [0, subject.before],
      [1, subject.after],
    ] as const) {
      await driver.load(subject, {progress})
      const shown = await samples(driver)
      for (const sample of shown.values()) {
        for (const [category, color] of Object.entries(sample.categories)) {
          const seen = palette.get(category)
          if (!seen) palette.set(category, {color, at: label(progress)})
          else if (seen.color !== color) {
            failures.push(
              `Category "${category}" is painted ${seen.color} at ${seen.at} but ${color} at ${label(progress)}; a category keeps one colour for the whole transition.`,
            )
          }
        }
      }
      const unchanged = await driver.compare(extraction, extraction)
      await driver.load({mode: 'comparison', before: extraction, after: extraction, comparison: unchanged}, {progress})
      const neutral = await samples(driver)
      for (const [key, sample] of shown) {
        const reference = neutral.get(key)
        if (!reference) continue
        compared++
        if (looks(sample) !== looks(reference)) {
          failures.push(
            `At ${label(progress)}, "${key}" is emphasized: compared with an unchanged comparison, ${difference(reference, {...sample, box: reference.box, opacity: reference.opacity})}.`,
          )
        }
      }
    }
    if (!compared) throw new Skip('No entity is drawn in both the comparison and an unchanged comparison, so there is nothing to compare.')
    return failures
  },

  async 'quiet-endpoints'(driver, subject, {modes}) {
    if (subject.mode !== 'comparison') throw new Skip('Single extractions have no endpoints.')
    if (!modes.some(mode => progressModes.includes(mode))) {
      throw new Skip('The renderer presents comparisons only in diff mode, which has no endpoints.')
    }
    const failures: string[] = []
    for (const progress of [0, 1]) {
      await driver.load(subject, {progress})
      for (const sample of (await samples(driver)).values()) {
        const word = statusWords.exec(sample.text)?.[0]
        if (word) failures.push(`At ${label(progress)}, "${sample.key}" shows "${word}"; endpoints carry no status.`)
      }
    }
    return failures.slice(0, limit)
  },
}
