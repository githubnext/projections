import {useId} from 'react'
import type {KeyboardEvent, KeyboardEventHandler} from 'react'
import {EllipsisVertical, Pause, Play, StepBack, StepForward} from 'lucide-react'
import {progressForKey} from '../projection.js'
import type {ProjectionController} from '../projection.js'
import {Button} from './components/button.js'
import {Label} from './components/label.js'
import {Range} from './components/range.js'
import {cn} from './lib/utils.js'
import {ToolbarPopover} from './toolbar-popover.js'

/** Elements whose own keyboard behavior includes Space (or that hold text), where Space keeps its meaning. */
const spaceKeeping = [
  'input:not([type="range"])',
  'textarea',
  'select',
  'button',
  'a[href]',
  'summary',
  'iframe',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="dialog"]',
  ...[
    'button',
    'checkbox',
    'radio',
    'switch',
    'tab',
    'menuitem',
    'menuitemradio',
    'menuitemcheckbox',
    'option',
    'combobox',
    'textbox',
    'searchbox',
    'treeitem',
    'gridcell',
    'link',
  ].map(role => `[role="${role}"]`),
].join(', ')

/**
 * A keydown handler for a toolbar or stage container: Space toggles playback (`togglePlayback`) while focus is on
 * the container itself or on an element that doesn't use Space, such as the Transition slider, and not in text
 * fields, buttons, radios, tabs, menus or open popovers. Held keys and modified Space are ignored.
 */
export function spaceTogglesPlayback(p: Pick<ProjectionController, 'togglePlayback'>): KeyboardEventHandler<HTMLElement> {
  return event => {
    if (event.key !== ' ' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const target = event.target
    if (!(target instanceof Element)) return
    // A Space-keeping element counts unless it encloses the container (say, the page puts the view in a dialog).
    const keeper = target.closest(spaceKeeping)
    if (keeper && !keeper.contains(event.currentTarget)) return
    event.preventDefault()
    if (!event.repeat) p.togglePlayback()
  }
}

/** The icons playback draws (`data-icon` values), which no mode icon may match. */
export const playbackIcons = ['play', 'pause', 'step-back', 'step-forward'] as const

/**
 * The one play button's name: "Pause" while playing, else "Play forward" or "Play backward" by `nextDirection`; under
 * reduced motion, where playing shows the endpoint at once, "Show <after label>" or "Show <before label>".
 */
export function playLabel(
  p: Pick<ProjectionController, 'playing' | 'nextDirection' | 'reducedMotion'>,
  beforeLabel: string,
  afterLabel: string,
): string {
  if (p.playing) return 'Pause'
  if (p.reducedMotion) return `Show ${p.nextDirection === 1 ? afterLabel : beforeLabel}`
  return p.nextDirection === 1 ? 'Play forward' : 'Play backward'
}

/**
 * The round play/pause button (the lens, theme.css: its face takes the lens tint while playing). It calls
 * `togglePlayback()`: pauses while playing, else plays in `nextDirection` (forward from the before end, backward from
 * the after end, otherwise the way it last travelled); its icon is mirrored to play backward. With Loop on it starts
 * and stops the back-and-forth. Named by `playLabel`.
 */
export function PlayButton({
  projection: p,
  beforeLabel,
  afterLabel,
  className,
}: {
  projection: ProjectionController
  beforeLabel: string
  afterLabel: string
  className?: string
}) {
  const name = playLabel(p, beforeLabel, afterLabel)
  return (
    <button
      type="button"
      className={cn('pj-lens ph-play', className)}
      data-playing={p.playing || undefined}
      data-direction={p.nextDirection === 1 ? 'forward' : 'backward'}
      onClick={p.togglePlayback}
      aria-label={name}
      title={name}
    >
      {p.playing ? (
        <Pause aria-hidden="true" data-icon="pause" fill="currentColor" strokeWidth={1} />
      ) : (
        <Play
          aria-hidden="true"
          data-icon="play"
          fill="currentColor"
          strokeWidth={1}
          className={p.nextDirection === -1 ? 'pj:-scale-x-100' : undefined}
        />
      )}
    </button>
  )
}

/**
 * The "Comparison playback" group: the one round `PlayButton`, the step buttons, and the exact "Transition" slider
 * (Home and End show either revision, Page Up and Page Down move by step) with its percent at a fixed width. The
 * slider takes the group's spare room and never narrows below `sliderMin` pixels (default 160). Renders nothing
 * unless comparing in animated mode, or with `always` (for example beside the table and text views, which present
 * progress in every mode). `compact` keeps the play button and the slider and moves the steps and the percent into
 * the group's own overflow, a "More playback controls" button; `minimal` keeps only the play button and the slider
 * (put `PlaybackExtras` with `position` in an overflow menu). `sliderFitMin` is the width a planned toolbar measures
 * the slider at (`data-fit-min`, see `useFitPlan`), by default `sliderMin`.
 */
export function Playback({
  projection: p,
  beforeLabel,
  afterLabel,
  always = false,
  compact = false,
  minimal = false,
  sliderMin = 160,
  sliderFitMin = sliderMin,
  className,
}: {
  projection: ProjectionController
  beforeLabel: string
  afterLabel: string
  always?: boolean
  compact?: boolean
  minimal?: boolean
  sliderMin?: number
  sliderFitMin?: number
  className?: string
}) {
  const id = useId()
  if (!p.comparing || (!always && p.mode !== 'animated')) return null
  const percent = Math.round(p.position * 100)
  const reduced = p.reducedMotion
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    const next = progressForKey(event.key, p)
    if (next === undefined) return
    event.preventDefault()
    p.seek(next)
  }
  const position = (
    <output
      htmlFor={`${id}-progress`}
      aria-label="Transition position"
      className="ph-position pj:w-9 pj:shrink-0 pj:text-right pj:text-xs pj:tabular-nums pj:text-muted-foreground"
    >
      {percent}%
    </output>
  )
  return (
    <div
      className={cn('ph-transport pj:flex pj:min-w-0 pj:items-center pj:gap-1.5', className)}
      role="group"
      aria-label="Comparison playback"
      data-fit="row"
      data-compact={compact || minimal || undefined}
    >
      {/* The lens's ring draws 4px outside its face; the padding keeps it clear of its neighbors. */}
      <span className="pj:flex pj:shrink-0 pj:items-center pj:px-1">
        <PlayButton projection={p} beforeLabel={beforeLabel} afterLabel={afterLabel} />
      </span>
      {!compact && !minimal && <StepButtons projection={p} />}
      <Label htmlFor={`${id}-progress`} className="pj:sr-only">
        Transition
      </Label>
      {/* The thumb follows exact progress every frame; only the text is rounded. */}
      <Range
        id={`${id}-progress`}
        min="0"
        max="100"
        step="any"
        value={p.position * 100}
        className="ph-progress pj:w-0 pj:flex-1"
        style={{minWidth: sliderMin}}
        data-fit-min={sliderFitMin}
        title={reduced ? motionNote : `${beforeLabel} → ${afterLabel}`}
        {...(reduced ? {'aria-describedby': `${id}-motion`} : {})}
        onChange={event => p.seek(event.target.valueAsNumber / 100)}
        onKeyDown={keys}
        aria-valuetext={`${percent} percent, ${p.position === 0 ? beforeLabel : p.position === 1 ? afterLabel : 'transition'}`}
      />
      {minimal ? null : compact ? (
        <ToolbarPopover
          icon={<EllipsisVertical />}
          label="More playback controls"
          title="Playback"
          className="ph-playback-more"
          contentClassName="pj:w-auto pj:p-1.5"
        >
          <div className="pj:flex pj:items-center pj:gap-1.5">
            <StepButtons projection={p} />
            {position}
          </div>
        </ToolbarPopover>
      ) : (
        position
      )}
      {reduced && (
        <span id={`${id}-motion`} className="ph-motion pj:sr-only">
          {motionNote}
        </span>
      )}
    </div>
  )
}

/** "Previous step" and "Next step", when the comparison has steps. */
export function StepButtons({projection: p}: {projection: ProjectionController}) {
  if (!p.stepEnds.length) return null
  return (
    <span className="ph-steps pj:flex pj:shrink-0 pj:items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="pj:text-muted-foreground pj:hover:text-foreground"
        aria-label="Previous step"
        title="Previous step"
        disabled={p.previousStep === undefined}
        onClick={p.stepBack}
      >
        <StepBack data-icon="step-back" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="pj:text-muted-foreground pj:hover:text-foreground"
        aria-label="Next step"
        title="Next step"
        disabled={p.nextStep === undefined}
        onClick={p.stepForward}
      >
        <StepForward data-icon="step-forward" />
      </Button>
    </span>
  )
}

/**
 * What a `minimal` `Playback` leaves out, for an overflow menu: the step buttons and, with `position`, the
 * "Transition position" percent. Renders nothing outside animated playback (unless `always`).
 */
export function PlaybackExtras({
  projection: p,
  always = false,
  position = false,
}: {
  projection: ProjectionController
  always?: boolean
  position?: boolean
}) {
  if (!p.comparing || (!always && p.mode !== 'animated')) return null
  return (
    <>
      <StepButtons projection={p} />
      {position && (
        <output aria-label="Transition position" className="ph-position pj:ml-auto pj:text-xs pj:tabular-nums pj:text-muted-foreground">
          {Math.round(p.position * 100)}%
        </output>
      )}
    </>
  )
}

const motionNote = 'Reduced motion: playback shows an endpoint immediately. The slider still supports manual inspection.'
