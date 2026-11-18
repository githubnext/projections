/** A toolbar action that moves into the "More" menu when the row is short of room. Settings always stays a button. */
export type ToolbarAction = 'varied' | 'zoom' | 'info' | 'fullscreen' | 'filter'
/**
 * The order the actions move into More, one at a time: the varied count (informational), zoom, About this projection,
 * full screen, then Filter.
 */
export const actionCollapseOrder: readonly ToolbarAction[] = ['varied', 'zoom', 'info', 'fullscreen', 'filter']

/**
 * How a toolbar arranges its regions: one row, or two planned rows (row 1 the picker, mode, chip and actions; row 2
 * the whole playback group), and which controls have collapsed into compact forms or overflow menus.
 */
export interface ToolbarLayout {
  /** One row, or two: row 2 is the playback group across the whole width (animated mode only). */
  rows: 1 | 2
  /**
   * Where the mode region (the mode and scope switches) sits: centred on the whole row, the picker at its start and
   * the actions at its end; or after the picker, the row's free space between it and the actions.
   */
  cluster: 'centre' | 'start'
  /** Revision names at the slider's ends. */
  sliderEnds: boolean
  /** The pair picker: two selects, two compact triggers with short names, or one compare button with both. */
  pickers: 'full' | 'compact' | 'merged'
  /** The mode switch: a segmented control with labels, or one menu button showing the current mode's icon. */
  modes: 'segmented' | 'menu'
  /** The step buttons and the percentage are in the playback group's "More playback controls" popover. */
  playbackOverflow: boolean
  /** Whether any action is in the "More" menu (`moreActions` is not empty). */
  actionsOverflow: boolean
  /** The actions in the "More" menu, in `actionCollapseOrder`; the others stay buttons, and Settings always does. */
  moreActions: readonly ToolbarAction[]
}

/** What a toolbar holds; regions it lacks drop out of the collapse order. */
export interface ToolbarContent {
  /** The start region holds a pair picker that follows `pickers`. */
  pickers?: boolean
  /** A mode switch is shown. */
  modes?: boolean
  /** The playback group is shown (animated mode). */
  playback?: boolean
  /** The actions that can move into More (`true`: all of them). */
  actions?: boolean | readonly ToolbarAction[]
  /** Anything else that changes the regions' widths, for example the revision labels or the chip. */
  key?: string
  /** The mode region may be centred (default true): there is something at the start to centre it against. */
  centre?: boolean
}

/** A wider toolbar expands a collapsed step only once it has this much room beyond what the step needs. */
export const toolbarHysteresis = 32
/** Below this toolbar width the slider's minimum drops from 160px to 120px (`styles/controls.css`). */
export const narrowToolbarWidth = 480
/** On a second row, the step buttons and the percentage stay inline only while the slider spans this share of the row. */
export const playbackRowShare = 0.8

const step = (layout: Partial<ToolbarLayout>): ToolbarLayout => ({
  rows: 1,
  cluster: 'start',
  sliderEnds: false,
  pickers: 'full',
  modes: 'segmented',
  playbackOverflow: false,
  ...layout,
  actionsOverflow: (layout.moreActions?.length ?? 0) > 0,
  moreActions: layout.moreActions ?? [],
})

/** The first `count` actions of the collapse order. */
const moved = (count: number) => actionCollapseOrder.slice(0, count)
const allActions = actionCollapseOrder.length

/**
 * Row 1's forms, most spacious first, when it has the width to itself (two rows) or holds everything but playback:
 * full pickers, a segmented mode switch and every action inline; compact pickers; the mode menu; the actions into More
 * one at a time; then one compare button for the pickers.
 */
const rowForms: readonly Partial<ToolbarLayout>[] = [
  {},
  {pickers: 'compact'},
  {pickers: 'compact', modes: 'menu'},
  ...Array.from({length: allActions}, (_, index) => ({pickers: 'compact' as const, modes: 'menu' as const, moreActions: moved(index + 1)})),
  {pickers: 'merged', modes: 'menu', moreActions: moved(allActions)},
]

/**
 * The priority collapse, least collapsed first. A toolbar with a mode region first centres it on the row, in its
 * fullest forms with every action inline, with playback (animated mode) alone on row 2, so choosing Animated doesn't
 * move the mode switch under the pointer; then (animated) the same two rows with the mode region after the picker.
 * Then the mode region follows the picker, and one row is preferred: the slider's revision names go, the pickers
 * become compact triggers, the mode switch a menu, the steps and percentage move into the playback group's overflow,
 * then the actions move into More one at a time (the varied count, zoom, About, full screen, Filter). Only when one row can't fit even
 * then does animated mode plan two rows (the playback group alone on row 2, at full width): row 1 has the width to
 * itself, so it starts again from `rowForms`' most spacious form and collapses in the same order, finally merging the
 * pickers. Row 2 keeps its steps and percentage inline while the slider still spans `playbackRowShare` of the row,
 * independently of row 1. Without playback the row stays one row and follows `rowForms`.
 */
const animatedSteps: readonly ToolbarLayout[] = [
  step({sliderEnds: true}),
  step({}),
  step({pickers: 'compact'}),
  step({pickers: 'compact', modes: 'menu'}),
  ...Array.from({length: allActions + 1}, (_, count) =>
    step({pickers: 'compact', modes: 'menu', playbackOverflow: true, moreActions: moved(count)}),
  ),
  ...rowForms.flatMap(form => [step({...form, rows: 2}), step({...form, rows: 2, playbackOverflow: true})]),
]
const stillSteps: readonly ToolbarLayout[] = rowForms.map(step)
/** The steps before those, for a toolbar with a mode region. */
const centredSteps = {
  animated: [
    step({cluster: 'centre', rows: 2}),
    step({cluster: 'centre', rows: 2, playbackOverflow: true}),
    step({rows: 2}),
    step({rows: 2, playbackOverflow: true}),
  ],
  still: [step({cluster: 'centre'})],
} as const

/** The collapse order for a toolbar's content, without steps that change nothing it holds. */
export function toolbarSteps(content: ToolbarContent): readonly ToolbarLayout[] {
  const actions = content.actions === true ? actionCollapseOrder : content.actions || []
  const seen = new Set<string>()
  const centred = content.modes && content.centre !== false ? centredSteps[content.playback ? 'animated' : 'still'] : []
  return [...centred, ...(content.playback ? animatedSteps : stillSteps)]
    .map(layout => {
      const moreActions = layout.moreActions.filter(action => actions.includes(action))
      return {
        ...layout,
        pickers: content.pickers ? layout.pickers : 'full',
        modes: content.modes ? layout.modes : 'segmented',
        actionsOverflow: moreActions.length > 0,
        moreActions,
      }
    })
    .filter(layout => {
      const id = JSON.stringify(layout)
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
}

/**
 * The first step that fits `width`: a less collapsed step than `current` needs `toolbarHysteresis` to spare. A step
 * not measured yet is tried. A second row with the steps inline also needs `rowNeed`, the width at which its slider
 * spans `playbackRowShare` of the row.
 */
export function choose(
  steps: readonly ToolbarLayout[],
  required: readonly (number | undefined)[],
  rowNeed: number | undefined,
  current: number,
  width: number,
): number {
  for (const [index, layout] of steps.entries()) {
    const own = required[index]
    const row = layout.rows === 2 && !layout.playbackOverflow ? rowNeed : 0
    if (own === undefined || row === undefined) return index
    if (Math.max(own, row) + (index < current ? toolbarHysteresis : 0) <= width) return index
  }
  return steps.length - 1
}
