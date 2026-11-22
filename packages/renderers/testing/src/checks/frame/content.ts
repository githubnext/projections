// The checks of what a renderer draws in its frame: legend, overflow, relationships, content top and identifiers.
import type {ContentTop, IdentifierMeasurement, OverflowMeasurement} from '../../types.js'
import type {CheckDriver} from '../catalog.js'
import {Skip, progressModes, primaryMode, limit, label, type Checks} from '../support.js'

export const contentChecks: Pick<Checks, 'legend' | 'phone-overflow' | 'relationships' | 'content-top' | 'identifiers'> = {
  async legend(driver, subject, {modes}) {
    const mode = primaryMode(subject, modes)
    // A renderer presented as a diff has no progress to scrub.
    const progresses = subject.mode === 'comparison' && !mode.comparisonMode ? [0, 0.5, 1] : [1]
    await driver.load(subject, {progress: progresses[0]!, ...mode})
    const failures: string[] = []
    const sent: [number, string][] = []
    for (const progress of progresses) {
      if (progresses.length > 1) await driver.seek(progress)
      await driver.measure('settle')
      // The legend message travels beside the paint acknowledgement; give it a moment.
      await driver.sleep(50)
      const found = await driver.measure<string[]>('legends')
      if (found.length) {
        failures.push(
          `At ${label(progress)}, the renderer draws ${found.length} legend${found.length === 1 ? '' : 's'} in its frame (${found.join(', ')}); send it to the host instead, which draws it once beside every pane.`,
        )
      }
      sent.push([progress, JSON.stringify((await driver.state()).legend ?? null)])
    }
    const [first] = sent
    for (const [progress, legend] of sent.slice(1)) {
      if (legend !== first![1]) {
        failures.push(`The legend changes while scrubbing: ${first![1]} at ${label(first![0])} but ${legend} at ${label(progress)}.`)
      }
    }
    return failures
  },

  async 'phone-overflow'(driver, subject, {phoneWidth, modes}) {
    const failures: string[] = []
    const measure = async (where: string) => {
      await driver.measure('settle')
      const overflow = await driver.measure<OverflowMeasurement>('overflow')
      if (overflow.scrollWidth > overflow.clientWidth + 1) {
        failures.push(
          `At ${where} and ${phoneWidth}px, the document is ${overflow.scrollWidth}px wide for a ${overflow.clientWidth}px viewport${overflow.offenders.length ? `: ${overflow.offenders.join(', ')}` : ''}.`,
        )
      }
    }
    if (subject.mode === 'comparison' && modes.includes('diff')) {
      await driver.load(subject, {progress: 1, width: phoneWidth, comparisonMode: 'diff'})
      await measure('the diff')
    }
    const progresses =
      subject.mode !== 'comparison'
        ? [1]
        : modes.includes('animated')
          ? [0, 0.5, 1]
          : modes.some(mode => progressModes.includes(mode))
            ? [0, 1]
            : []
    if (!progresses.length) return failures
    await driver.load(subject, {progress: progresses[0]!, width: phoneWidth})
    for (const progress of progresses) {
      await driver.seek(progress)
      await measure(label(progress))
    }
    return failures
  },

  async relationships(driver, subject, {modes, rendererOptions}) {
    if (rendererOptions.showRelationships === false) throw new Skip('The presentation turns relationships off (showRelationships: false).')
    const state = await driver.load(subject, {progress: 1, ...primaryMode(subject, modes)})
    if (state.capabilities?.drawsRelationships === false) {
      throw new Skip('The renderer declares drawsRelationships: false: it deliberately draws no relationships.')
    }
    await driver.measure('settle')
    const drawn = new Set(await driver.measure<string[]>('entities'))
    const shown = subject.mode === 'comparison' ? subject.after : subject.extraction
    // A presentation that draws one relationship kind expects only that kind.
    const kind =
      typeof rendererOptions.relationships === 'string' && rendererOptions.relationships !== 'all'
        ? rendererOptions.relationships
        : undefined
    const expected = shown.relationships.filter(link => drawn.has(link.from) && drawn.has(link.to) && (!kind || link.kind === kind))
    if (!expected.length) {
      throw new Skip(
        kind
          ? `No ${kind} relationship, the kind the presentation draws, connects two entities the renderer draws.`
          : 'No relationship connects two entities the renderer draws.',
      )
    }
    if (expected.some(link => drawn.has(link.id))) return []
    return [
      `The extraction has ${expected.length} relationship${expected.length === 1 ? '' : 's'} between drawn entities (for example "${expected[0]!.id}"), but no element is marked as one: put the relationship's ID in data-entity-id on what draws it, or declare capabilities.drawsRelationships: false if the renderer deliberately draws none.`,
    ]
  },

  async 'content-top'(driver, subject, {modes, phoneWidth}) {
    const failures: string[] = []
    for (const width of [undefined, phoneWidth]) {
      await driver.load(subject, {progress: 1, ...primaryMode(subject, modes), ...(width ? {width} : {})})
      await driver.measure('settle')
      const top = await driver.measure<ContentTop>('contentTop')
      if (Number.isFinite(top.top) && top.top > top.allowance + 0.5) {
        failures.push(
          `${width ? `At ${width}px` : 'At full width'}, the content starts ${top.top}px below the frame top (${top.element}); keep it within the stage padding, ${top.allowance}px.`,
        )
      }
    }
    return failures
  },

  async identifiers(driver, subject, {modes, phoneWidth}) {
    let count = 0
    const failures: string[] = []
    for (const width of [undefined, phoneWidth]) {
      await driver.load(subject, {progress: 1, ...primaryMode(subject, modes), ...(width ? {width} : {})})
      const measured = await identifiersAt(driver, width ? `At ${width}px` : 'At full width')
      count += measured.count
      failures.push(...measured.failures)
    }
    if (!count) throw new Skip('The renderer marks no identifiers (data-projections-identifier).')
    return failures.slice(0, limit)
  },
}

async function identifiersAt(driver: CheckDriver, where: string): Promise<{count: number; failures: string[]}> {
  await driver.measure('settle')
  const measured = await driver.measure<IdentifierMeasurement>('identifiers')
  return {count: measured.count, failures: measured.proportional.map(item => `${where}: ${item}, not a monospace font.`)}
}
