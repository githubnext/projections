import type {FrameMeasurement} from './frame.js'

/**
 * Checks a dense scrub (forward then backward over the same values): no
 * per-frame issues, the same framing throughout, neutral endpoints, and the
 * same frame at a progress whichever way it was reached.
 */
export function scrubFailures(frames: readonly FrameMeasurement[]): string[] {
  const failures: string[] = []
  const framing = frames.find(frame => frame.viewBox !== undefined)?.viewBox
  const seen = new Map<number, string>()
  for (const frame of frames) {
    for (const issue of frame.issues) failures.push(`${frame.progress}: ${issue}`)
    if (frame.viewBox !== framing) failures.push(`${frame.progress}: framing changed to ${frame.viewBox} from ${framing}`)
    if ((frame.progress === 0 || frame.progress === 1) && frame.decorated.length) {
      failures.push(`${frame.progress}: change decoration at an endpoint: ${frame.decorated.join(', ')}`)
    }
    const geometry = JSON.stringify(
      frame.cards.map(card => [card.id, card.opacity.toFixed(3), ...Object.values(card.box).map(value => value.toFixed(1))]).sort(),
    )
    const previous = seen.get(frame.progress)
    if (previous !== undefined && previous !== geometry) failures.push(`${frame.progress}: frame differs between directions`)
    seen.set(frame.progress, geometry)
  }
  return failures
}
