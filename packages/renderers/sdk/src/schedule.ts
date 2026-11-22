// Placing presented steps on the progress axis: windows, holds, reading time and emphasis.
import type {PresentedStep} from './steps.js'

/**
 * A step placed on the progress axis. The step changes only inside its window
 * `[time - radius, time + radius]`; windows never overlap, and consecutive
 * windows are separated by a hold of length `hold` in which nothing moves. A
 * step that takes something away in its direction of travel reads it first
 * (see `readingShare`): a still part of its window, its `lead` forward or its
 * `tail` for explicit reverse steps played backward, in which what is about
 * to leave is emphasized and read before it goes.
 */
export interface ScheduledStep extends PresentedStep {
  /** Centre of the step's window, in [0, 1]. */
  time: number
  /** Half-width of the step's window, its reading lead and tail included. */
  radius: number
  /** Length of the still interval between this window and a neighbouring one. */
  hold: number
  /**
   * Length of the still part at the start of the step's window (lowest
   * progress) in which what it removes is emphasized and read before it fades.
   * 0 or absent for a step that removes nothing, and travelling backward.
   */
  lead?: number
  /**
   * Length of the still part at the end of the step's window (highest
   * progress): an explicit reverse step played backward reads what it takes
   * away (the forward additions) there. 0 or absent otherwise.
   */
  tail?: number
  /**
   * The direction this schedule is travelled in: 1 forward (and for `mirror`
   * order either way), -1 for `explicit` `reverseSteps` played backward.
   */
  travel: 1 | -1
}

/**
 * Nominal spacing between consecutive step centres (a step's *slot*), and the
 * headroom kept before the first and after the last so entering and leaving
 * entities have room to fade while the host's change highlighting is at full
 * strength. A short sequence keeps the nominal cadence near the midpoint
 * rather than stretching to fill the interval; a long one compresses to fit.
 */
const STEP_GAP = 0.2
const EDGE_HEADROOM = 0.16

/**
 * The hold policy: the share of every step's slot in which nothing moves. Host
 * playback is continuous, so a still interval between consecutive windows is
 * what makes shapes visibly settle at each step while progress keeps moving.
 * The headroom before the first and after the last step is at least as long.
 * This is the one place step holds are decided; renderers never add their own.
 */
export const stepHoldShare = 1 / 3

/**
 * The reading policy: how long, in step slots, a step that takes something
 * away keeps still to show it before it leaves. The step's emphasis rises over
 * the first fifth of its reading part and holds while nothing moves, so what
 * is about to disappear is readable (about a second at 1× speed with the host's
 * default pace, `timelineSlots`) before it fades and its gap closes. The other
 * changes need no reading part: an arrival fades in already emphasized and
 * stays so through the hold after its step until the host's endpoint fade, and
 * a change that stays is emphasized as it changes. This is the one place
 * reading time is decided; renderers never add their own.
 */
export const readingShare = 1

/** Share of a reading part over which emphasis rises; it holds for the rest. */
const READ_RISE = 0.2

function unit(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Progress must be a finite number')
  return Math.max(0, Math.min(1, value))
}

/**
 * Turns ordered steps into windows on [0, 1], separated by holds. Comparisons
 * carry order and grouping only; this presentation timing is the renderer's.
 * Each step's slot is `gap` wide: its motion window takes `1 - stepHoldShare`
 * of the slot and the rest is a hold shared with its neighbour, so no step
 * begins before the previous one has finished and settled. A step `lead`
 * accepts gets a reading lead of `readingShare` slots before its motion, and
 * one `tail` accepts a reading tail as long after it. Positions depend only
 * on the sequence and are centred on the midpoint, so reversing a sequence
 * mirrors its timeline exactly.
 */
export function compileTimeline<T>(
  steps: readonly T[],
  options: {lead?: (step: T) => boolean; tail?: (step: T) => boolean} = {},
): (T & {time: number; radius: number; hold: number; lead: number; tail: number})[] {
  const last = steps.length - 1
  const reads = steps.map(step => ({lead: options.lead?.(step) ? readingShare : 0, tail: options.tail?.(step) ? readingShare : 0}))
  const total = reads.reduce((sum, read) => sum + read.lead + read.tail, 0)
  const span = last + total
  const gap = Math.min(STEP_GAP, span > 0 ? (1 - 2 * EDGE_HEADROOM) / span : STEP_GAP)
  const motion = gap * (1 - stepHoldShare)
  let before = 0
  return steps.map((step, index) => {
    const {lead, tail} = reads[index]!
    // Reading before this step pushes it later, reading after it earlier; with none, centres are `gap` apart.
    const shift = (gap * (before - (total - before - lead - tail))) / 2
    before += lead + tail
    return {
      ...step,
      time: 0.5 - (last * gap) / 2 + index * gap + shift,
      radius: (motion + gap * (lead + tail)) / 2,
      hold: gap * stepHoldShare,
      lead: gap * lead,
      tail: gap * tail,
    }
  })
}

const removes = (step: PresentedStep) => step.removes ?? step.kind === 'remove'
const adds = (step: PresentedStep) => step.adds ?? step.kind === 'add'

/**
 * How many step slots a schedule spans: one per step, plus its reading parts.
 * Report it with the step ends (`client.steps(ends, slots)`) so the host's
 * default pace gives every slot the same time, and reading never speeds up
 * the motion around it.
 */
export function timelineSlots(schedule: readonly Pick<ScheduledStep, 'hold' | 'lead' | 'tail'>[]): number {
  const gap = (schedule[0]?.hold ?? 0) / stepHoldShare
  const reading = gap > 0 ? schedule.reduce((sum, step) => sum + ((step.lead ?? 0) + (step.tail ?? 0)) / gap, 0) : 0
  return Math.round((schedule.length + reading) * 1e6) / 1e6
}

/**
 * The steps placed on the progress axis, in ascending time. Playing forward,
 * or with `mirror` reverse order, uses the forward steps; playing backward
 * with `explicit` reverse order places `reverseSteps` so that the first one
 * happens first when leaving progress 1. Both schedules agree at the
 * endpoints, where every step has either not started or finished. A step that
 * removes something gets a reading lead; travelling backward through explicit
 * reverse steps, one that adds something gets a reading tail, the part that
 * backward travel enters first. Use a `DirectionLatch` to choose `direction`.
 */
export function scheduleSteps<S extends PresentedStep = PresentedStep>(
  order: {steps: readonly S[]; reverse: 'mirror' | 'explicit'; reverseSteps?: readonly S[] | undefined},
  direction: 1 | -1 = 1,
): (S & {time: number; radius: number; hold: number; lead: number; tail: number; travel: 1 | -1})[] {
  if (direction === -1 && order.reverse === 'explicit' && order.reverseSteps) {
    // Compiled in the order of travel, then mirrored: what reads first travelling backward lies at the high end.
    return compileTimeline(order.reverseSteps, {lead: adds})
      .map(step => ({...step, time: 1 - step.time, lead: step.tail, tail: step.lead, travel: -1 as const}))
      .toReversed()
  }
  return compileTimeline(order.steps, {lead: removes}).map(step => ({...step, travel: 1 as const}))
}

/** Share of a step's motion over which its changes' emphasis rises when travel enters no reading part. */
const EMPHASIS_RISE = 0.3

type Timed = Pick<ScheduledStep, 'time' | 'radius'> & Partial<Pick<ScheduledStep, 'lead' | 'tail' | 'travel'>>

/**
 * How much of the host's change highlighting a change in `step` shows at
 * `progress`: 0 until the step's window begins in the direction the schedule
 * is travelled (`travel`), then rising (over the first fifth of the reading
 * part travel enters, else over the start of the motion) to 1, where it stays
 * until the host's own endpoint fade. Earlier steps never pre-tint later
 * changes, and an explicit reverse order mirrors it. A change no step places
 * shows the host's highlighting unscaled.
 */
export function emphasisRise(step: Timed | undefined, progress: number): number {
  if (!step) return 1
  const t = unit(progress)
  const backward = step.travel === -1
  const reading = Math.max(0, (backward ? step.tail : step.lead) ?? 0)
  const length = reading > 0 ? reading * READ_RISE : 2 * motionWindow(step).radius * EMPHASIS_RISE
  const entered = backward ? step.time + step.radius - t : t - (step.time - step.radius)
  const share = length > 0 ? Math.max(0, Math.min(1, entered / length)) : entered < 0 || (entered === 0 && backward) ? 0 : 1
  return share * share * (3 - 2 * share)
}

/**
 * Progress values where a host may hold between steps: for each step, the
 * middle of the hold that follows it in the direction of travel (forward,
 * after its window; backward, before it), so seeking there always shows a
 * settled frame. Endpoints are omitted because hosts always stop there.
 * Report them with `client.steps`.
 */
export function stepEnds(schedule: readonly Pick<ScheduledStep, 'time' | 'radius' | 'hold'>[], direction: 1 | -1 = 1): number[] {
  const ends = schedule
    .map(step => (direction === 1 ? step.time + step.radius + step.hold / 2 : step.time - step.radius - step.hold / 2))
    .map(value => Math.round(value * 1e9) / 1e9)
    .filter(value => value > 0 && value < 1)
  return [...new Set(ends)].toSorted((a, b) => a - b)
}

/**
 * The still intervals of a schedule, in ascending order: before the first
 * window, between consecutive windows and after the last. Nothing driven by
 * the schedule moves inside them.
 */
export function stepHolds(schedule: readonly Pick<ScheduledStep, 'time' | 'radius'>[]): {start: number; end: number}[] {
  const bounds = [0, ...schedule.flatMap(step => [step.time - step.radius, step.time + step.radius]), 1]
  const holds: {start: number; end: number}[] = []
  for (let index = 0; index < bounds.length; index += 2) {
    if (bounds[index + 1]! > bounds[index]!) holds.push({start: bounds[index]!, end: bounds[index + 1]!})
  }
  return holds
}

/**
 * The part of a step's window in which things move: all of it, less its
 * reading lead and tail.
 */
export function motionWindow(step: Timed): {time: number; radius: number} {
  const lead = Math.max(0, step.lead ?? 0),
    tail = Math.max(0, step.tail ?? 0)
  if (!(lead + tail > 0)) return {time: step.time, radius: step.radius}
  return {time: step.time + (lead - tail) / 2, radius: Math.max(0, step.radius - (lead + tail) / 2)}
}

/**
 * Progress through a step's motion (`motionWindow`): 0 until it starts moving,
 * after any reading lead, and 1 once it stops, before any reading tail, so it
 * is constant in every hold and while reading. Measured from the centre, so
 * the middle of the motion is exactly one half. Ease it for motion.
 */
export function stepProgress(step: Timed, progress: number): number {
  const t = unit(progress)
  const {time, radius} = motionWindow(step)
  return radius > 0 ? Math.max(0, Math.min(1, 0.5 + (t - time) / (2 * radius))) : t < time ? 0 : 1
}

/**
 * Chooses which schedule a renderer presents. Under `mirror` order there is
 * only one. Under `explicit` order the schedule latches to the direction of
 * travel when progress leaves an endpoint and keeps it until progress reaches
 * an endpoint again, so reversing mid-transition never jumps to another
 * timeline. Keep one latch per document.
 */
export class DirectionLatch {
  #direction: 1 | -1 | undefined
  /**
   * The direction to present at `progress`, given the current playback `direction`: `1` at progress 0 or below, `-1`
   * at 1 or above, and in between the direction latched when progress left an endpoint (`direction` if it hasn't).
   */
  update(progress: number, direction: 1 | -1): 1 | -1 {
    if (progress <= 0) this.#direction = 1
    else if (progress >= 1) this.#direction = -1
    else this.#direction ??= direction
    return this.#direction
  }
}
