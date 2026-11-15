// The checks of change status: in reserved space, and stated as text.
import type {ComparisonMode} from '@githubnext/projections-renderer-sdk/protocol'
import type {EntitySample, EntityText, OpeningMeasurement, StageSubject} from '../../types.js'
import {Skip, progressModes, limit, samples, label} from '../support.js'
import type {CheckDriver} from '../catalog.js'
import type {Checks} from '../support.js'
import {changedEntities, pick, touched} from './support.js'

export const statusChecks: Pick<Checks, 'stable-layout' | 'status-text'> = {
  async 'stable-layout'(driver, subject, {modes}) {
    if (subject.mode !== 'comparison') throw new Skip('Single extractions show no change status.')
    const failures: string[] = []
    if (modes.includes('diff')) {
      await driver.load(subject, {progress: 1, comparisonMode: 'diff', highlighting: 1})
      const on = await samples(driver)
      const framedOn = await framed(driver)
      await driver.load(subject, {progress: 1, comparisonMode: 'diff', highlighting: 'off'})
      const moved = shifted(on, await samples(driver), 'In the diff')
      // Two loads of one diff that differ: say how each was framed, so a difference the frame makes shows.
      if (moved.length) moved.push(`In the diff, the frame with highlighting ${framedOn}; without it ${await framed(driver)}.`)
      failures.push(...moved)
    }
    const progresses = progressSamples(modes)
    if (progresses.length) await driver.load(subject, {progress: progresses[0]!})
    for (const progress of progresses) {
      await driver.seek(progress, {highlighting: 1})
      const on = await samples(driver)
      await driver.seek(progress, {highlighting: 0})
      failures.push(...shifted(on, await samples(driver), `At ${label(progress)}`))
      if (failures.length >= limit) break
    }
    return failures.slice(0, limit)
  },

  async 'status-text'(driver, subject, {modes}) {
    if (subject.mode !== 'comparison') throw new Skip('Single extractions show no change status.')
    if (!changedEntities(subject.comparison).length) throw new Skip('The comparison changes no entities.')
    const failures: string[] = []
    if (modes.includes('diff')) {
      await driver.load(subject, {progress: 1, comparisonMode: 'diff', highlighting: 1})
      await driver.measure('settle')
      failures.push(...missingStatus(await driver.measure<EntityText[]>('statusText'), statusOf(subject), subject, 'In the diff'))
    }
    if (modes.includes('animated')) {
      const state = await driver.load(subject, {progress: 0})
      const ends = state.steps.filter(end => end > 0 && end < 1)
      const touches = touched(subject)
      if (ends.length === touches.length) {
        for (const [index, end] of pick([...ends.entries()], 12)) {
          await driver.seek(end, {highlighting: 1})
          await driver.measure('settle')
          failures.push(
            ...missingStatus(
              await driver.measure<EntityText[]>('statusText'),
              statusOf(subject, touches[index]),
              subject,
              `After step ${index + 1}`,
            ),
          )
          if (failures.length >= limit) break
        }
      }
    } else if (modes.some(mode => progressModes.includes(mode))) {
      // Two panes: the after pane names additions and changes, the before pane removals.
      for (const progress of [0, 1]) {
        await driver.load(subject, {progress, highlighting: 1})
        await driver.measure('settle')
        const expected = new Map([...statusOf(subject)].filter(([, word]) => (word === 'Removed') === (progress === 0)))
        failures.push(
          ...missingStatus(await driver.measure<EntityText[]>('statusText'), expected, subject, `At ${label(progress)} with highlighting`),
        )
      }
    }
    return failures.slice(0, limit)
  },
}

export const statusWords = /\b(Added|Removed|Modified|Renamed|Moved)\b/

/** Progress values a renderer is presented at in its progress modes: through the transition when animated, else the endpoints. */
function progressSamples(modes: readonly ComparisonMode[]): number[] {
  return modes.includes('animated') ? [0, 0.25, 0.5, 0.75, 1] : modes.some(mode => progressModes.includes(mode)) ? [0, 1] : []
}

/** How the stage is framed now: the frame's size, the height the renderer asked for, and each zoomable canvas's visible area and drawn content. */
async function framed(driver: CheckDriver): Promise<string> {
  const {viewport, canvases} = await driver.measure<OpeningMeasurement>('opening')
  const asked = (await driver.state()).height
  const areas = canvases.map(
    canvas => `canvas [${canvas.area.join(', ')}] drawing [${canvas.content?.join(', ') ?? ''}] at zoom ${canvas.zoom}`,
  )
  return `${viewport.width}×${viewport.height}${asked === undefined ? '' : ` (asked for ${asked})`}${areas.length ? `, ${areas.join('; ')}` : ''}`
}

function shifted(on: Map<string, EntitySample>, off: Map<string, EntitySample>, where: string): string[] {
  const failures: string[] = []
  for (const [key, sample] of on) {
    const other = off.get(key)
    if (other && other.box.join() !== sample.box.join()) {
      failures.push(
        `${where}, "${key}" is at [${other.box.join(', ')}] without highlighting but [${sample.box.join(', ')}] with it: status must not move or resize anything.`,
      )
    }
  }
  return failures
}

/** Entities whose change a status should name, with the word expected. */
function statusOf(subject: Extract<StageSubject, {mode: 'comparison'}>, ids?: ReadonlySet<string>): Map<string, string> {
  const result = new Map<string, string>()
  for (const change of changedEntities(subject.comparison)) {
    if (ids && ![change.id, ...change.before, ...change.after].some(id => ids.has(id))) continue
    const word = change.status === 'unchanged' ? 'Renamed' : change.status[0]!.toUpperCase() + change.status.slice(1)
    result.set(change.id, word)
  }
  return result
}

function missingStatus(
  texts: EntityText[],
  expected: Map<string, string>,
  subject: Extract<StageSubject, {mode: 'comparison'}>,
  where: string,
): string[] {
  const failures: string[] = []
  for (const [id, word] of expected) {
    const change = subject.comparison.changes.find(item => item.id === id)!
    const ids = new Set([id, ...change.before, ...change.after])
    const drawn = texts.filter(text => ids.has(text.id))
    if (!drawn.length) continue
    if (!drawn.some(text => statusWords.test(text.text)))
      failures.push(`${where}, the ${word.toLowerCase()} "${id}" states no status as text (expected "${word}" or another status word).`)
  }
  return failures
}
