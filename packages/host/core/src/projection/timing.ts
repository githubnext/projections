import type {ProjectionController} from './types.js'

/** Default travel time per step at 1× speed, for renderers that declare no `pace`. */
export const stepDurationMs = 1500

/** The shortest default playback travel, so a comparison with few steps still reads. */
export const minimumDurationMs = 4500

/**
 * The default playback travel at 1× speed for a comparison with `steps`
 * steps (or step slots, when the renderer reports them with its step ends:
 * steps plus time a step spends reading what it removes): the renderer's
 * declared `pace.stepMs` per step (else 1500 ms), at
 * least 4.5 seconds and at most 20 seconds, or 60 seconds with a declared
 * pace. A definition's `presentation.durationMs` overrides it.
 */
export function defaultDuration(steps: number, stepMs?: number): number {
  return Math.min(stepMs ? 60_000 : 20_000, Math.max(minimumDurationMs, Math.max(0, steps) * (stepMs ?? stepDurationMs)))
}

/**
 * Playback travel at 1× speed, holds excluded: the host's `durationMs`, else
 * the definition's `presentation.durationMs`, else the renderer's declared
 * `pace.stepMs` per step, else the default (`defaultDuration`). Speed divides
 * it; holds (`stepHoldMs`, `endpointHoldMs`) are added on the timeline.
 */
export function playbackDuration({
  durationMs,
  presentationDurationMs,
  paceStepMs,
  steps,
}: {
  durationMs?: number | undefined
  presentationDurationMs?: number | undefined
  paceStepMs?: number | undefined
  steps: number
}): number {
  return Math.max(100, durationMs ?? presentationDurationMs ?? defaultDuration(steps, paceStepMs))
}

/**
 * The slider position a key on a transition slider moves to (for `seek`), or
 * `undefined` for keys it doesn't handle: arrows step 1%, Page Up and Page Down
 * jump to the next or previous step (10% without steps), Home and End go to
 * the endpoints. Sliders show the exact position (`step="any"`), so the
 * keyboard needs explicit steps.
 */
export function progressForKey(
  key: string,
  controller: Pick<ProjectionController, 'position' | 'nextStep' | 'previousStep'>,
): number | undefined {
  const clamp = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 1e6) / 1e6
  const at = controller.position
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return clamp(at + 0.01)
    case 'ArrowLeft':
    case 'ArrowDown':
      return clamp(at - 0.01)
    case 'PageUp':
      return controller.nextStep ?? clamp(at + 0.1)
    case 'PageDown':
      return controller.previousStep ?? clamp(at - 0.1)
    case 'Home':
      return 0
    case 'End':
      return 1
    default:
      return undefined
  }
}
