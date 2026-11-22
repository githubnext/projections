// The checks of selection, hover and keyboard focus.
import type {ComparisonMode} from '@githubnext/projections-renderer-sdk/protocol'
import {Skip, primaryMode, limit, until} from './support.js'
import type {Checks} from './support.js'

export const interactionChecks: Pick<Checks, 'affordances' | 'rings' | 'selection'> = {
  async affordances(driver, subject, {maxEntities, modes}) {
    // The primary mode, then the diff when the renderer also offers one: a comparison opens in it.
    const passes: {mode: {comparisonMode?: ComparisonMode}; where: string; count: number}[] = [
      {mode: primaryMode(subject, modes), where: '', count: maxEntities},
    ]
    if (subject.mode === 'comparison' && modes.includes('diff') && primaryMode(subject, modes).comparisonMode !== 'diff') {
      passes.push({mode: {comparisonMode: 'diff'}, where: 'In diff mode, ', count: Math.ceil(maxEntities / 2)})
    }
    const failures: string[] = []
    let drawn = 0
    for (const {mode, where, count} of passes) {
      const state = await driver.load(subject, {progress: 1, ...mode})
      const ids = (await driver.measure<string[]>('entities')).slice(0, count)
      drawn += ids.length
      const lower = (text: string) => (where ? text[0]!.toLowerCase() + text.slice(1) : text)
      for (const id of ids) {
        if (state.capabilities?.hover) {
          await driver.hover(id)
          if (!(await until(async () => (await driver.measure<string[]>('hovered')).includes(id), driver))) {
            failures.push(`${where}${lower(`Hovering "${id}" from the host isn't shown (no data-projections-hovered element).`)}`)
          } else failures.push(...(await driver.measure<string[]>('affordances')).map(failure => `${where}${lower('Hover')}: ${failure}.`))
          await driver.hover(null)
        }
        // Keyboard focus before selection: focus must show on its own.
        failures.push(...(await driver.measure<string[]>('focus', id)).map(failure => `${where}${lower('Keyboard focus')}: ${failure}.`))
        await driver.select(id)
        await driver.measure('settle')
        failures.push(...(await driver.measure<string[]>('affordances')).map(failure => `${where}${lower('Selection')}: ${failure}.`))
        await driver.select(null)
        if (failures.length >= limit) break
      }
      if (failures.length >= limit) break
    }
    if (!drawn) throw new Skip('The renderer draws no entities (elements with data-entity-id).')
    await driver.select(null)
    return failures.slice(0, limit)
  },

  async rings(driver, subject, {maxEntities, modes}) {
    const failures: string[] = []
    const at = (state: string, where: string) => (failure: string) => `${where}${state[0]!.toUpperCase()}${state.slice(1)}: ${failure}.`
    // The primary mode, then the diff when the renderer also offers one (fewer entities there).
    const passes: {mode: {comparisonMode?: ComparisonMode}; where: string; count: number}[] = [
      {mode: primaryMode(subject, modes), where: '', count: maxEntities},
    ]
    if (subject.mode === 'comparison' && modes.includes('diff') && primaryMode(subject, modes).comparisonMode !== 'diff') {
      passes.push({mode: {comparisonMode: 'diff'}, where: 'In diff mode, ', count: Math.ceil(maxEntities / 2)})
    }
    let drawn = 0
    for (const {mode, where, count} of passes) {
      const state = await driver.load(subject, {progress: 1, ...mode})
      const ids = (await driver.measure<string[]>('entities')).slice(0, count)
      drawn += ids.length
      for (const id of ids) {
        if (state.capabilities?.hover) {
          await driver.measure('ringNeutral', id)
          await driver.hover(id)
          if (await until(async () => (await driver.measure<string[]>('hovered')).includes(id), driver)) {
            await driver.measure('settle')
            failures.push(...(await driver.measure<string[]>('rings', {id, state: 'hover'})).map(at('hover', where)))
          }
          await driver.hover(null)
          await driver.measure('settle')
        }
        failures.push(...(await driver.measure<string[]>('ringFocus', id)).map(at('keyboard focus', where)))
        await driver.measure('ringNeutral', id)
        await driver.select(id)
        await driver.measure('settle')
        failures.push(...(await driver.measure<string[]>('rings', {id, state: 'selected'})).map(at('selection', where)))
        await driver.select(null)
        await driver.measure('settle')
        if (failures.length >= limit) break
      }
      if (failures.length >= limit) break
    }
    if (!drawn) throw new Skip('The renderer draws no entities (elements with data-entity-id).')
    return failures.slice(0, limit)
  },

  async selection(driver, subject, {modes}) {
    await driver.load(subject, {progress: 1, ...primaryMode(subject, modes)})
    const ids = (await driver.measure<string[]>('entities')).toReversed()
    if (!ids.length) throw new Skip('The renderer draws no entities (elements with data-entity-id).')
    const id = ids[0]!
    const reports = async () => (await driver.state()).selections
    // Whether the renderer reports `expected` to the host after the first `from` reports.
    const reportsAfter = (from: number, expected: string | null) =>
      until(async () => {
        const selections = await reports()
        return selections.length > from && selections.at(-1) === expected
      }, driver)
    const cleared = () => until(async () => !(await driver.measure<string[]>('selected')).includes(id), driver)
    let before = (await reports()).length
    if (!(await driver.measure<boolean>('click', id))) return [`"${id}" could not be clicked.`]
    const failures: string[] = []
    if (!(await reportsAfter(before, id))) {
      failures.push(`Clicking "${id}" didn't report it to the host (reported: ${JSON.stringify((await reports()).slice(before))}).`)
    } else {
      // Clicking the selected item again clears the selection, as a toggle does; so does a click on the background.
      before = (await reports()).length
      await driver.measure<boolean>('click', id)
      if (!(await reportsAfter(before, null)) || !(await cleared())) {
        failures.push(`Clicking the selected "${id}" again doesn't clear the selection.`)
      }
      before = (await reports()).length
      await driver.measure<boolean>('click', id)
      if (await reportsAfter(before, id)) {
        before = (await reports()).length
        const background = await driver.measure<boolean>('clickBackground')
        if (background && (!(await reportsAfter(before, null)) || !(await cleared()))) {
          failures.push(`Clicking the background doesn't clear the selection of "${id}".`)
        }
      }
    }
    await driver.select(null)
    if (!(await until(async () => !(await driver.measure<string[]>('selected')).includes(id), driver))) {
      failures.push(`Clearing the host's selection leaves "${id}" marked as selected.`)
    }
    await driver.select(id)
    if (!(await until(async () => (await driver.measure<string[]>('selected')).includes(id), driver))) {
      failures.push(
        `The host's selection of "${id}" isn't shown (no .selected, aria-pressed, aria-current, aria-selected or data-projections-selected).`,
      )
    }
    await driver.select(null)
    return failures
  },
}
