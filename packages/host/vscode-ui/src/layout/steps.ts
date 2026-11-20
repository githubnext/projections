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
  /** The mode region may be centred (default true); `VscodeProjectionViewProps.centreModes`. */
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
 * The priority collapse, least collapsed first. With playback (animated mode), the playback group always has row 2 to
 * itself, at full width, so choosing Animated never moves the controls above it; row 1 holds the picker, the mode
 * region and the actions. A toolbar with a mode region first centres it on row 1, in its fullest forms with every
 * action inline; then the mode region follows the picker, and row 1 collapses in `rowForms`' order: compact pickers,
 * the mode menu, the actions into More one at a time (the varied count, zoom, About, full screen, Filter), then merged
 * pickers. Row 2 shows the revision names at the slider's ends while the row is at its most spacious, and keeps its
 * steps and percentage inline while the slider still spans `playbackRowShare` of the row, independently of row 1.
 * Without playback the row stays one row and follows `rowForms`.
 */
const twoRows = (form: Partial<ToolbarLayout>) => [step({...form, rows: 2}), step({...form, rows: 2, playbackOverflow: true})]
const animatedSteps: readonly ToolbarLayout[] = [step({rows: 2, sliderEnds: true}), ...rowForms.flatMap(twoRows)]
const stillSteps: readonly ToolbarLayout[] = rowForms.map(step)
/** The steps before those, for a toolbar with a mode region. */
const centredSteps = {
  animated: [step({cluster: 'centre', rows: 2, sliderEnds: true}), ...twoRows({cluster: 'centre'})],
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

/** Row 1's form in a step: where the mode region sits, the pickers, the mode switch and the actions in More. */
export const rowForm = (layout: ToolbarLayout) => `${layout.cluster}|${layout.pickers}|${layout.modes}|${layout.moreActions.join(' ')}`

/**
 * The step in `steps` to show for `layout`: the step itself, else, from another collapse order (playback coming or
 * going), the first step with the same row 1 form, so row 1 doesn't move; else the first step.
 */
export function locateStep(steps: readonly ToolbarLayout[], layout: ToolbarLayout): number {
  const same = steps.indexOf(layout)
  if (same >= 0) return same
  const form = steps.findIndex(step => rowForm(step) === rowForm(layout))
  return form < 0 ? 0 : form
}
