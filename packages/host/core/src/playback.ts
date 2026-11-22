/** How long animated playback holds at each comparison step end, at 1× speed. */
export const stepHoldMs = 1200
/** How long looping playback holds at each endpoint before it reverses, at 1× speed. */
export const endpointHoldMs = 600
/** Holds never get shorter than this, whatever the speed, so they stay perceptible. */
export const minimumHoldMs = 250

const epsilon = 1e-6

/** A hold scaled by the playback speed, but never shorter than `minimumHoldMs`. */
export function holdDuration(holdMs: number, speed: number): number {
  return Math.max(minimumHoldMs, holdMs / (Number.isFinite(speed) && speed > 0 ? speed : 1))
}

/** What animated playback moves through. */
export interface PlaybackPlan {
  /** Step ends between the endpoints, where playback holds. Endpoints and duplicates are ignored. */
  stops: readonly number[]
  /** Time to travel from 0 to 1, holds excluded. */
  travelMs: number
  /** Hold at each step end. */
  stepHoldMs: number
  /** Hold at an endpoint before reversing; only used when looping. */
  endpointHoldMs: number
  /** Reverse at each endpoint instead of stopping. */
  loop: boolean
}

/**
 * Animated playback's position with `holds: 'pause'`: the presentation `progress` (0 before, 1 after), the direction it
 * travels in, and how long, in ms, it still holds at the stop it is on (0 while travelling).
 */
export interface PlaybackState {
  progress: number
  direction: 1 | -1
  /** Remaining hold time at the current stop. */
  holdMs: number
}

/** The playback state `advancePlayback` returns, and whether playback has stopped. */
export interface PlaybackStep extends PlaybackState {
  /** Playback reached an endpoint without looping. */
  stopped: boolean
}

const interior = (stops: readonly number[]) =>
  [...new Set(stops.filter(stop => stop > epsilon && stop < 1 - epsilon))].toSorted((a, b) => a - b)

/** The next stop strictly beyond `progress` in `direction`: a step end, else the endpoint. */
function nextStop(progress: number, direction: 1 | -1, stops: readonly number[]): number {
  if (direction === 1) return stops.find(stop => stop > progress + epsilon) ?? 1
  for (let index = stops.length - 1; index >= 0; index--) if (stops[index]! < progress - epsilon) return stops[index]!
  return 0
}

/**
 * Whether `progress` sits on a stop where playback holds: a step end, or an
 * endpoint when looping.
 */
export function atStop(progress: number, plan: Pick<PlaybackPlan, 'stops' | 'loop'>): boolean {
  if (plan.loop && (progress <= epsilon || progress >= 1 - epsilon)) return true
  return interior(plan.stops).some(stop => Math.abs(stop - progress) <= epsilon)
}

/**
 * Where playback starts from `progress`. Starting on a stop lands mid-hold, as
 * step buttons do: playback waits half that stop's hold before moving on.
 */
export function startPlayback(progress: number, direction: 1 | -1, plan: PlaybackPlan): PlaybackState {
  const endpoint = progress <= epsilon || progress >= 1 - epsilon
  const hold = !atStop(progress, plan) ? 0 : endpoint ? plan.endpointHoldMs : plan.stepHoldMs
  return {progress, direction, holdMs: hold / 2}
}

/**
 * Advances playback by `elapsedMs`: travels at `1 / travelMs` per millisecond,
 * holds at each step end, and at an endpoint either stops or, when looping,
 * holds and reverses (ping-pong).
 */
export function advancePlayback(state: PlaybackState, elapsedMs: number, plan: PlaybackPlan): PlaybackStep {
  const stops = interior(plan.stops)
  const travelMs = Math.max(1, plan.travelMs)
  let {progress, direction, holdMs} = state
  let remaining = Math.max(0, elapsedMs)
  // Bounded: every iteration either consumes the remaining time or reaches a stop.
  for (let guard = 0; guard < 4 * (stops.length + 2) && remaining > 0; guard++) {
    if (holdMs > 0) {
      const used = Math.min(holdMs, remaining)
      holdMs -= used
      remaining -= used
      continue
    }
    const stop = nextStop(progress, direction, stops)
    const needed = Math.abs(stop - progress) * travelMs
    if (remaining < needed) {
      progress += (direction * remaining) / travelMs
      break
    }
    progress = stop
    remaining -= needed
    if (stop === 0 || stop === 1) {
      if (!plan.loop) return {progress, direction, holdMs: 0, stopped: true}
      direction = stop === 1 ? -1 : 1
      holdMs = plan.endpointHoldMs
    } else holdMs = plan.stepHoldMs
  }
  return {progress: Math.min(1, Math.max(0, progress)), direction, holdMs, stopped: false}
}

/**
 * Where animated playback holds. `timeline` (the default): the slider moves
 * uniformly through a timeline that includes each hold, and a held stretch of
 * the slider maps to a constant presentation progress, so the graphics stay
 * still while the slider keeps moving. `pause`: the slider itself stops at
 * each hold, and the slider position is the presentation progress.
 */
export type Holds = 'timeline' | 'pause'
/** Every `Holds` setting, the default first. */
export const holdsSettings: readonly Holds[] = ['timeline', 'pause']

/** The playback timeline at 1× speed: travel between stops plus the holds that `holds: 'timeline'` lays out on the slider. */
export interface PlaybackTimeline {
  /** Step ends between the endpoints. Endpoints and duplicates are ignored. */
  stops: readonly number[]
  /** Time to travel from 0 to 1, holds excluded. */
  travelMs: number
  /** Plateau at each step end. */
  stepHoldMs: number
  /** Total dwell at an endpoint: half of it starts the timeline and half ends it, so a loop dwells the whole of it. */
  endpointHoldMs: number
}

/** The duration of one turn (0 → 1) of a timeline: travel, a hold per step end and both endpoint half-holds. */
export function timelineDuration(timeline: PlaybackTimeline): number {
  return (
    Math.max(1, timeline.travelMs) +
    interior(timeline.stops).length * Math.max(0, timeline.stepHoldMs) +
    Math.max(0, timeline.endpointHoldMs)
  )
}

/**
 * The presentation progress renderers show at a slider `position` (both 0–1):
 * constant across each hold's stretch of the slider, and moving
 * proportionally to step lengths in between.
 */
export function presentationProgress(position: number, timeline: PlaybackTimeline): number {
  const travelMs = Math.max(1, timeline.travelMs)
  let elapsed = Math.min(1, Math.max(0, position)) * timelineDuration(timeline) - Math.max(0, timeline.endpointHoldMs) / 2
  if (elapsed <= 0) return 0
  let previous = 0
  for (const stop of [...interior(timeline.stops), 1]) {
    const travel = (stop - previous) * travelMs
    if (elapsed < travel) return previous + elapsed / travelMs
    elapsed -= travel
    if (stop === 1) return 1
    if (elapsed < Math.max(0, timeline.stepHoldMs)) return stop
    elapsed -= Math.max(0, timeline.stepHoldMs)
    previous = stop
  }
  return 1
}

/**
 * The slider position for a presentation `progress`: the endpoints at either
 * end, a step end in the middle of its hold (where step buttons land), and
 * other values on the travel between holds.
 */
export function timelinePosition(progress: number, timeline: PlaybackTimeline): number {
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  const travelMs = Math.max(1, timeline.travelMs)
  const hold = Math.max(0, timeline.stepHoldMs)
  const total = timelineDuration(timeline)
  let elapsed = Math.max(0, timeline.endpointHoldMs) / 2
  let previous = 0
  for (const stop of interior(timeline.stops)) {
    if (Math.abs(progress - stop) <= epsilon) return (elapsed + (stop - previous) * travelMs + hold / 2) / total
    if (progress < stop) break
    elapsed += (stop - previous) * travelMs + hold
    previous = stop
  }
  return (elapsed + (progress - previous) * travelMs) / total
}

/** Slider positions of the step ends: the middle of each hold. */
export function timelineStepPositions(timeline: PlaybackTimeline): number[] {
  return interior(timeline.stops).map(stop => timelinePosition(stop, timeline))
}

/** One frame of recorded playback: the presentation progress it shows, and for how long. */
export interface PlaybackFrame {
  progress: number
  durationMs: number
}

/**
 * One turn of looping timeline playback at 1× speed, as frames sampled every `frameMs`: forward (`direction` 1) the
 * slider runs from 0 to 1, backward from 1 to 0, at the constant rate `advanceTimeline` moves it, and each frame shows
 * the progress `presentationProgress` maps its position to. Consecutive frames that show the same progress (a hold)
 * are one frame, so the durations add up to `timelineDuration(timeline)`. Looping playback alternates the turns, with
 * the renderer's step ends for each direction, and each endpoint's two half-holds meet.
 */
export function playbackTurn(timeline: PlaybackTimeline, direction: 1 | -1, frameMs: number): PlaybackFrame[] {
  const turnMs = timelineDuration(timeline)
  const step = Math.max(1, frameMs)
  const frames: PlaybackFrame[] = []
  for (let at = 0; at < turnMs; at += step) {
    const fraction = at / turnMs
    const progress = presentationProgress(direction === 1 ? fraction : 1 - fraction, timeline)
    const durationMs = Math.min(step, turnMs - at)
    const last = frames.at(-1)
    if (last && Math.abs(last.progress - progress) <= epsilon) last.durationMs += durationMs
    else frames.push({progress, durationMs})
  }
  return frames
}

/**
 * Animated playback's position with `holds: 'timeline'`: the slider `position` from 0 to 1 through a timeline that
 * includes the holds (`timelinePosition` maps progress to it), and the direction it travels in.
 */
export interface TimelineState {
  position: number
  direction: 1 | -1
}

/**
 * Advances a timeline position by `elapsedMs` at a constant rate (one turn per
 * `turnMs`). Looping reflects at the ends, whose plateaus provide the dwell;
 * otherwise playback stops at the end it reaches.
 */
export function advanceTimeline(
  state: TimelineState,
  elapsedMs: number,
  {turnMs, loop}: {turnMs: number; loop: boolean},
): TimelineState & {stopped: boolean} {
  let position = state.position + (state.direction * Math.max(0, elapsedMs)) / Math.max(1, turnMs)
  let direction = state.direction
  if (!loop) {
    // Only the end playback travels toward stops it, so a frame without elapsed time never stops it where it started.
    if (direction === 1 && position >= 1) return {position: 1, direction, stopped: true}
    if (direction === -1 && position <= 0) return {position: 0, direction, stopped: true}
    return {position: Math.min(1, Math.max(0, position)), direction, stopped: false}
  }
  // Bounded: a single frame never covers more than a few turns.
  for (let guard = 0; guard < 8 && (position > 1 || position < 0); guard++) {
    if (position > 1) {
      position = 2 - position
      direction = -1
    } else {
      position = -position
      direction = 1
    }
  }
  return {position: Math.min(1, Math.max(0, position)), direction, stopped: false}
}

/** A place step navigation stops: its slider position, and the stretch of the slider that counts as being there. */
export interface StepStop {
  position: number
  from: number
  to: number
}

/**
 * Where Next and Previous stop: the before end (0), every step (in the middle
 * of its hold on the timeline), and the after end (1). A step's hold counts
 * as that step, so navigating from inside it moves on to a neighbouring stop;
 * the ends are exact, so Next is unavailable only at 1 and Previous only at 0.
 */
export function stepStops(stepEnds: readonly number[], timeline?: PlaybackTimeline): StepStop[] {
  const stops: StepStop[] = [{position: 0, from: 0, to: 0}]
  const half = timeline ? Math.max(0, timeline.stepHoldMs) / 2 / timelineDuration(timeline) : 0
  for (const end of interior(stepEnds)) {
    const position = timeline ? timelinePosition(end, timeline) : end
    stops.push({position, from: Math.max(0, position - half), to: Math.min(1, position + half)})
  }
  stops.push({position: 1, from: 1, to: 1})
  return stops.filter((stop, index) => index === 0 || stop.position - stops[index - 1]!.position > epsilon)
}

/** The next (`direction` 1) or previous (-1) stop from a slider position, or `undefined` at that end. */
export function adjacentStop(stops: readonly StepStop[], position: number, direction: 1 | -1): number | undefined {
  if (direction === 1) return stops.find(stop => stop.from > position + epsilon)?.position
  for (let index = stops.length - 1; index >= 0; index--) if (stops[index]!.to < position - epsilon) return stops[index]!.position
  return undefined
}
