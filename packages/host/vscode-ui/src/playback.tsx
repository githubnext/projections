import {useId, useRef, useState} from 'react'
import type {KeyboardEvent} from 'react'
import {progressForKey} from '@githubnext/projections-host'
import type {ProjectionController} from '@githubnext/projections-host'
import type {VscodeToolbarButton} from '@vscode-elements/elements/dist/vscode-toolbar-button/vscode-toolbar-button.js'
import {RangeInput} from './controls.js'
import {ActionButton} from './elements.js'
import {Menu} from './overlay/menu.js'
import {uiCodicons} from './codicons.js'

/**
 * The one play button's name, codicon and icon name (`data-icon`): "Pause" while playing, else "Play forward" or "Play
 * backward" in `nextDirection` (forward at the start, backward at the end, otherwise the way it last went). With
 * reduced motion it shows a revision instead: "Show <after>" or "Show <before>".
 */
export function playButtonState(
  p: Pick<ProjectionController, 'playing' | 'nextDirection' | 'reducedMotion'>,
  beforeLabel: string,
  afterLabel: string,
): {label: string; icon: string; iconName: 'play' | 'play-backward' | 'pause'} {
  const forward = {icon: uiCodicons.play, iconName: 'play'} as const
  const backward = {icon: uiCodicons.playBackward, iconName: 'play-backward'} as const
  if (p.reducedMotion)
    return p.nextDirection === 1 ? {label: `Show ${afterLabel}`, ...forward} : {label: `Show ${beforeLabel}`, ...backward}
  if (p.playing) return {label: 'Pause', icon: uiCodicons.pause, iconName: 'pause'}
  return p.nextDirection === 1 ? {label: 'Play forward', ...forward} : {label: 'Play backward', ...backward}
}

/** Elements whose own keyboard behavior uses Space, which the playback shortcut leaves alone. */
const usesSpace =
  'input:not([type=range]), textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable=false]), ' +
  '[role=button], [role=checkbox], [role=radio], [role=switch], [role=tab], [role^=menuitem], [role=option], [role=combobox], [role=textbox], [role=searchbox], [role=link], ' +
  '[role=dialog], [role=menu], [role=listbox], vscode-toolbar-button, vscode-button, vscode-single-select, vscode-textfield, vscode-checkbox, vscode-radio, vscode-tab-header'

/**
 * Space toggles playback (`togglePlayback`) from the element whose `onKeyDown` calls this, for example a toolbar or the
 * stage's chrome: not from text fields or controls that use Space themselves (VSCode Elements included), and not from
 * overlays portaled out of it. Returns whether it handled the key. Does nothing unless comparing in animated mode, or
 * with `always` (playback beside the table and text views in every mode, `playbackInViews: 'always'`).
 */
export function handlePlaybackKey(
  event: KeyboardEvent<HTMLElement>,
  p: Pick<ProjectionController, 'comparing' | 'mode' | 'togglePlayback'>,
  always = false,
): boolean {
  if (event.key !== ' ' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
  if (!p.comparing || (!always && p.mode !== 'animated')) return false
  const target = event.target
  if (!(target instanceof Element) || !event.currentTarget.contains(target) || target.closest(usesSpace)) return false
  event.preventDefault()
  p.togglePlayback()
  return true
}

/**
 * Play, step and scrub an animated comparison, drawn like VS Code's debug toolbar: the play button in the debug
 * continue color (pause in the pause color), the steps as step back and step over, the "Transition" slider (Home and
 * End show either revision, Space on it plays and pauses; it takes the room the group has) and the percentage.
 * Renders nothing unless comparing in animated mode, or with `always` (beside the table and text views in every mode,
 * `playbackInViews: 'always'`). `ends` shows the revision names at the slider's ends. `overflow`
 * moves the steps and the percentage into a "More playback controls" menu, keeping the play button and slider.
 */
export function Playback({
  projection: p,
  beforeLabel,
  afterLabel,
  ends = true,
  overflow = false,
  always = false,
}: {
  projection: ProjectionController
  beforeLabel: string
  afterLabel: string
  ends?: boolean
  overflow?: boolean
  always?: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const more = useRef<VscodeToolbarButton>(null)
  if (!p.comparing || (!always && p.mode !== 'animated')) return null
  const percent = Math.round(p.position * 100)
  const play = playButtonState(p, beforeLabel, afterLabel)
  const steps = p.stepEnds.length > 0
  return (
    <div
      className="phv-playback"
      role="group"
      aria-label="Comparison playback"
      data-overflow={overflow || undefined}
      data-playing={p.playing || undefined}
      data-next-direction={p.nextDirection === 1 ? 'forward' : 'backward'}
    >
      <ActionButton
        icon={play.icon}
        label={play.label}
        className="phv-play"
        onClick={p.togglePlayback}
        data-icon={play.iconName}
        data-focus-id="play"
      />
      {!overflow && steps && (
        <>
          <ActionButton
            icon={uiCodicons.previousStep}
            label="Previous step"
            className="phv-step"
            disabled={p.previousStep === undefined}
            onClick={p.stepBack}
            data-icon="previous-step"
            data-focus-id="previous-step"
          />
          <ActionButton
            icon={uiCodicons.nextStep}
            label="Next step"
            className="phv-step"
            disabled={p.nextStep === undefined}
            onClick={p.stepForward}
            data-icon="next-step"
            data-focus-id="next-step"
          />
        </>
      )}
      {ends && (
        <span className="phv-slider-end" aria-hidden="true" title={beforeLabel}>
          {beforeLabel}
        </span>
      )}
      {/* The thumb follows exact progress every frame; only the text is rounded. */}
      <RangeInput
        id={`${id}-progress`}
        label="Transition"
        min={0}
        max={100}
        step="any"
        value={p.position * 100}
        onChange={next => p.seek(next / 100)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          const next = progressForKey(event.key, p)
          if (next === undefined) return
          event.preventDefault()
          p.seek(next)
        }}
        valueText={`${percent} percent, ${p.position === 0 ? beforeLabel : p.position === 1 ? afterLabel : 'transition'}`}
        className="phv-progress"
        title={`${beforeLabel} → ${afterLabel}`}
      />
      {ends && (
        <span className="phv-slider-end" aria-hidden="true" title={afterLabel}>
          {afterLabel}
        </span>
      )}
      {overflow ? (
        <>
          <ActionButton
            ref={more}
            icon={uiCodicons.more}
            label="More playback controls"
            popup="menu"
            expanded={open}
            onClick={() => setOpen(!open)}
            data-focus-id="playback-options"
            data-icon="ellipsis"
          />
          <Menu
            open={open}
            onClose={() => setOpen(false)}
            anchor={more}
            label="Playback"
            items={[
              ...(steps
                ? [
                    {
                      id: 'previous-step',
                      label: 'Previous step',
                      icon: uiCodicons.previousStep,
                      disabled: p.previousStep === undefined,
                      onSelect: p.stepBack,
                    },
                    {
                      id: 'next-step',
                      label: 'Next step',
                      icon: uiCodicons.nextStep,
                      disabled: p.nextStep === undefined,
                      onSelect: p.stepForward,
                    },
                  ]
                : []),
              {id: 'position', label: 'Position', detail: `${percent}%`, group: 'position', disabled: true, onSelect: () => {}},
            ]}
          />
        </>
      ) : (
        <output htmlFor={`${id}-progress`} aria-label="Transition position" className="phv-output phv-percent">
          {percent}%
        </output>
      )}
    </div>
  )
}
