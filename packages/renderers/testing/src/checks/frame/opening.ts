// The opening check: a zoomable canvas opens fitted, or at the readable text floor on the start of its content.
import {openingFloorPx} from '@githubnext/projections-renderer-sdk/presentation'
import type {ComparisonMode} from '@githubnext/projections-renderer-sdk/protocol'
import type {OpeningCanvas, OpeningMeasurement} from '../../types.js'
import {Skip, Passed, limit, label, type Checks} from '../support.js'

/** The frame a zoomable renderer must open fitted in: about a VS Code tab at full width, and a phone. */
const openingFrame = {height: 650, phoneHeight: 700}
/** Rounding slack in a measured text size, CSS px. */
const floorTolerance = 0.05
/**
 * How far above the floor a canvas opened at it may draw its smallest visible text: the floor also counts text that
 * fades in later (a status tab, say), which can be a little smaller than what is drawn as it opens.
 */
const floorReach = 1.25

type Finding = {failure: string} | {note: string}

/**
 * How one canvas opens, at `where`; `opening` when this is the first progress the presentation shows, `diff` in diff
 * mode, which may open on its changes instead of its start.
 */
function canvasFinding(canvas: OpeningCanvas, where: string, opening: boolean, diff = false): Finding {
  const text = canvas.smallestText === null ? 'no text' : `smallest text ${canvas.smallestText}px`
  if (!(canvas.zoom >= 1)) {
    return {
      failure: `${where}, ${canvas.element} opens at zoom ${canvas.zoom}, below the fit (${text}); open fitted (the kit's useStageZoom).`,
    }
  }
  if (canvas.zoom === 1) return fittedFinding(canvas, where, text)
  return diff && canvas.changes.count ? changesFinding(canvas, where, text) : zoomedFinding(canvas, where, text, opening)
}

/**
 * A diff opened zoomed on its changes (see `RendererFocus`): text no smaller than the floor, a change in view, and
 * zoomed past the floor only when every change fits the view.
 */
function changesFinding(canvas: OpeningCanvas, where: string, text: string): Finding {
  const {count, inView, whole} = canvas.changes
  if (canvas.smallestText !== null && canvas.smallestText < openingFloorPx - floorTolerance) {
    return {
      failure: `${where}, ${canvas.element} opens zoomed (${canvas.zoom}) with ${text}, below the ${openingFloorPx}px floor; open at the scale where the smallest text is ${openingFloorPx}px (the kit's useOpeningFloor).`,
    }
  }
  if (canvas.smallestText !== null && canvas.smallestText / canvas.zoom >= openingFloorPx - floorTolerance) {
    return {
      failure: `${where}, ${canvas.element} opens zoomed (${canvas.zoom}) although fitted its smallest text would be ${Math.round((canvas.smallestText / canvas.zoom) * 100) / 100}px, at least the ${openingFloorPx}px floor; open fitted.`,
    }
  }
  if (!inView) {
    return {
      failure: `${where}, ${canvas.element} opens zoomed (${canvas.zoom}) with none of its ${count} changes in view; a diff that doesn't fit opens on its changes (the graph canvas's focusArea).`,
    }
  }
  if (canvas.smallestText !== null && canvas.smallestText > openingFloorPx * floorReach && whole < count) {
    return {
      failure: `${where}, ${canvas.element} opens zoomed (${canvas.zoom}) further than the ${openingFloorPx}px floor (${text}) with ${count - whole} of its ${count} changes not wholly in view; zoom past the floor only to fit every change.`,
    }
  }
  return {note: `${where}: on its changes (zoom ${canvas.zoom}), ${whole} of ${count} wholly in view, ${text}.`}
}

/** Opened fitted (zoom 1): everything it draws must be in view. */
function fittedFinding(canvas: OpeningCanvas, where: string, text: string): Finding {
  if (canvas.outside.length) {
    return {
      failure: `${where}, ${canvas.outside.length === 5 ? 'at least 5' : canvas.outside.length} of ${canvas.entities} entities are outside the visible canvas [${canvas.area.join(', ')}], for example ${canvas.outside[0]}; fit all of the content to the stage (the kit's useFitScale), or open at the ${openingFloorPx}px text floor when the fit is smaller.`,
    }
  }
  return {note: `${where}: fitted, ${canvas.entities} entities in view, ${text}.`}
}

/** Opened zoomed in: only to the text floor, no further, and on the start of its content. */
function zoomedFinding(canvas: OpeningCanvas, where: string, text: string, opening: boolean): Finding {
  if (canvas.smallestText === null) {
    return {failure: `${where}, ${canvas.element} opens zoomed (${canvas.zoom}) with no text; open fitted (the kit's useStageZoom).`}
  }
  if (canvas.smallestText < openingFloorPx - floorTolerance) {
    return {
      failure: `${where}, ${canvas.element} opens zoomed (${canvas.zoom}) with ${text}, below the ${openingFloorPx}px floor, and not everything fits; open at the scale where the smallest text is ${openingFloorPx}px (the kit's useOpeningFloor).`,
    }
  }
  if (canvas.smallestText / canvas.zoom >= openingFloorPx - floorTolerance) {
    return {
      failure: `${where}, ${canvas.element} opens zoomed (${canvas.zoom}) although fitted its smallest text would be ${Math.round((canvas.smallestText / canvas.zoom) * 100) / 100}px, at least the ${openingFloorPx}px floor; open fitted.`,
    }
  }
  if (canvas.smallestText > openingFloorPx * floorReach) {
    return {
      failure: `${where}, ${canvas.element} opens zoomed (${canvas.zoom}) further than the ${openingFloorPx}px floor (${text}); open at the floor, the least zoom whose text is readable.`,
    }
  }
  if (opening && !canvas.start?.inView) {
    return {
      failure:
        `${where}, ${canvas.element} opens at the ${openingFloorPx}px floor scrolled away from the start of its content: ${canvas.start ? `${canvas.start.element} at [${canvas.start.corner.join(', ')}] is outside the visible canvas [${canvas.area.join(', ')}]` : 'no entity is drawn'}; ` +
        "open at its top left (or the top centre of a centred layout, or the drawing's top left where the top row can't be in view without cutting a card).",
    }
  }
  if (opening && canvas.cut.length) {
    const count = canvas.cut.length === 5 ? 'at least 5 entities' : canvas.cut.length === 1 ? 'an entity' : `${canvas.cut.length} entities`
    return {
      failure:
        `${where}, ${canvas.element} opens at the ${openingFloorPx}px floor with ${count} cut off at the left or top edge of the visible canvas [${canvas.area.join(', ')}], for example ${canvas.cut[0]}; ` +
        "open at its top left (or the top centre of a centred layout whose top row fits) with the view's left and top edges between cards rather than through them, else at the drawing's top left (the kit's contentStart).",
    }
  }
  return {
    note: `${where}: at the ${openingFloorPx}px floor (zoom ${canvas.zoom}, fitted text would be ${Math.round((canvas.smallestText / canvas.zoom) * 100) / 100}px), ${opening ? `opens on its ${canvas.start?.inView} (${canvas.start?.element}), ` : ''}${canvas.outside.length ? 'scrolls to the rest' : 'everything in view'}, ${text}.`,
  }
}

export const openingChecks: Pick<Checks, 'opens-fitted'> = {
  async 'opens-fitted'(driver, subject, {modes, phoneWidth}) {
    const failures: string[] = []
    const notes: string[] = []
    let zoomable = false
    // The diff when the renderer offers it, and one progress mode, at both ends: hosts open comparisons in either.
    const progressMode = modes.find(mode => mode !== 'diff')
    const relationships = (subject.mode === 'comparison' ? [subject.before, subject.after] : [subject.extraction]).flatMap(extraction =>
      extraction.relationships.map(link => link.id),
    )
    const presentations: {name: string; comparisonMode?: ComparisonMode; progress: number[]}[] =
      subject.mode === 'comparison'
        ? [
            ...(modes.includes('diff') ? [{name: 'the diff', comparisonMode: 'diff' as const, progress: [1]}] : []),
            ...(progressMode ? [{name: progressMode.replaceAll('-', ' '), comparisonMode: progressMode, progress: [0, 1]}] : []),
          ]
        : [{name: 'one revision', progress: [1]}]
    for (const width of [undefined, phoneWidth]) {
      const height = width ? openingFrame.phoneHeight : openingFrame.height
      for (const presentation of presentations) {
        const [first, ...rest] = presentation.progress
        await driver.load(subject, {
          progress: first!,
          height,
          ...(width ? {width} : {}),
          ...(presentation.comparisonMode ? {comparisonMode: presentation.comparisonMode} : {}),
        })
        for (const progress of [first!, ...rest]) {
          if (progress !== first) await driver.seek(progress)
          await driver.measure('settle')
          const measured = await driver.measure<OpeningMeasurement>('opening', relationships)
          const size = `${measured.viewport.width}×${measured.viewport.height}`
          const where = `At ${width ? `${width}px` : 'full width'} (${size}), ${presentation.name}${presentation.progress.length > 1 ? ` at ${label(progress)}` : ''}`
          for (const canvas of measured.canvases) {
            zoomable = true
            const finding = canvasFinding(canvas, where, progress === first, presentation.comparisonMode === 'diff')
            if ('failure' in finding) failures.push(finding.failure)
            else notes.push(finding.note)
          }
        }
      }
    }
    if (!zoomable) {
      throw new Skip(
        'The renderer has no zoomable canvas (no scroll container marked data-zoom): document-style content (lists, tables, text) scrolls naturally, and a layout drawn at the frame size is always in view.',
      )
    }
    if (!failures.length) throw new Passed(notes)
    return failures.slice(0, limit)
  },
}
