import type {ChangeStatus, DependencyInjectionExtraction} from '@githubnext/projections-schemas'
import {smoothstep, stepProgress, unscheduledWindow, type ComparisonModel, type ScheduledStep} from '@githubnext/projections-renderer-kit'
import {diMetrics} from './geometry.js'
import {lifetimeDash, markSpan} from './lifetime-mark.js'
import type {DiUnit, Lifetime} from './model.js'
import {diUnion, type Window} from './union.js'

export interface DiUnitFrame {
  id: string
  before?: DiUnit | undefined
  after?: DiUnit | undefined
  unit: DiUnit
  status: ChangeStatus
  renamed: boolean
  x: number
  y: number
  opacity: number
  /** How far the unit's own step has gone, 0 to 1: a changed lifetime or implementation crossfades over it. */
  local: number
  lifetime: Lifetime
  /** The lifetime mark's dash pattern, morphing from Before's lifetime to After's over the unit's step (`lifetimeDash`). */
  dash: [number, number]
}

export interface DiLinkFrame {
  /** Relationship row ID, for selection. */
  id: string
  key: string
  from: {x: number; y: number}
  to: {x: number; y: number}
  status: ChangeStatus
  opacity: number
  parameter?: string | undefined
  collection: boolean
  optional: boolean
  resolution: boolean
  alias: boolean
  fromId: string
  toId: string
}

export interface DiFrame {
  units: DiUnitFrame[]
  links: DiLinkFrame[]
}

export interface DiTransition {
  (progress: number): DiFrame
  /** Every unit and link either endpoint shows, for stable framing and ports. */
  endpoints: {units: DiUnitFrame[]; links: DiLinkFrame[]}
  /** Whether either revision resolves a service at run time rather than by constructor injection. */
  runtimeResolution: boolean
  /** Whether either revision has an alias registration. */
  aliases: boolean
  /** The row whose comparison step a unit follows, for step-scoped emphasis. */
  stepRow: (id: string) => string
  /** The row whose comparison step a drawn link (by its key) follows, for step-scoped emphasis (see `linkRow`). */
  linkStepRow: (key: string) => string
  /** Every card's height (see `diCardHeight`). */
  height: number
}

/**
 * Units and links follow the comparison's steps: a unit arrives in the
 * earliest step that changes one of its parts, leaves in the latest, and an
 * existing unit's lifetime mark morphs, and its text crossfades, in the latest step that changes it;
 * a relationship fades in, out or across in its own step, except that a rewired relationship's old route leaves with
 * the first of its step and its leaving cards' and its new route arrives with the last of its step and its arriving
 * cards' (it never outlives, or precedes, them). Each moves only
 * inside its step's window, so the kit's holds keep everything still between
 * steps. Both revisions reserve positions in one composition, so nothing
 * moves and arriving units fade into their slots. Identity comes only from
 * the comparison: every entity and relationship ID is replaced by the
 * presented row that shows it, and links are relationship rows.
 */
export function createDiTransition(
  model: ComparisonModel<DependencyInjectionExtraction>,
  schedule: readonly ScheduledStep[] = [],
  /** Every card's height: a comparison's reserves the status footer (see `diCardHeight`). */
  height: number = diMetrics.height,
): DiTransition {
  const {before: beforeUnits, after: afterUnits, ids, positions, statuses, links: union, relationshipStatus} = diUnion(model, height)
  const stepOf = new Map<string, ScheduledStep>()
  for (const step of schedule) for (const id of [...step.entities, ...step.relationships]) stepOf.set(id, step)
  // The part whose step brings, takes or changes each unit (its emphasis follows the same step).
  const unitPart = new Map(
    ids.map(id => {
      const parts = [...new Set([id, ...(beforeUnits.get(id)?.parts ?? []), ...(afterUnits.get(id)?.parts ?? [])])]
        .filter(part => stepOf.has(part))
        .sort((a, b) => stepOf.get(a)!.time - stepOf.get(b)!.time)
      return [id, (beforeUnits.has(id) ? parts.at(-1) : parts[0]) ?? id] as const
    }),
  )
  const unitWindow = new Map(ids.map(id => [id, (stepOf.get(unitPart.get(id)!) ?? unscheduledWindow) as Window] as const))
  // A link part that a revision alone draws (a removed or added relationship, or a rewired one's old or new route)
  // goes with the step that takes it away or brings it: the first of its own and its leaving cards' steps, or the
  // last of its own and its arriving cards'. So it fades, and is emphasized, with them.
  const linkRow = new Map(
    union.map(item => {
      if (item.side === 'both') return [item.key, item.link.id] as const
      const ends = [item.link.from, item.link.to]
        .filter(id => (item.side === 'before' ? !afterUnits.has(id) : !beforeUnits.has(id)))
        .map(id => unitPart.get(id) ?? id)
      const rows = [item.link.id, ...ends].filter(id => stepOf.has(id)).sort((a, b) => stepOf.get(a)!.time - stepOf.get(b)!.time)
      return [item.key, (item.side === 'before' ? rows[0] : rows.at(-1)) ?? item.link.id] as const
    }),
  )
  const drawn = union.map(item => ({...item, window: (stepOf.get(linkRow.get(item.key)!) ?? unscheduledWindow) as Window}))
  const frame = (progress: number): DiFrame => {
    const units = ids
      .map((id): DiUnitFrame => {
        const a = beforeUnits.get(id)
        const b = afterUnits.get(id)
        const local = smoothstep(stepProgress(unitWindow.get(id)!, progress))
        const unit = (local < 0.5 ? (a ?? b) : (b ?? a))!
        const position = positions.get(id)!
        const {status, renamed} = statuses.get(id)!
        return {
          id,
          before: a,
          after: b,
          unit,
          status,
          renamed,
          x: position.x,
          y: position.y,
          opacity: a ? (b ? 1 : 1 - local) : local,
          // Only a unit in both revisions that a step changes crossfades; it is settled exactly outside its window.
          local: a && b && stepOf.has(unitPart.get(id)!) ? (local < 1e-9 ? 0 : local > 1 - 1e-9 ? 1 : local) : 1,
          lifetime: unit.lifetime,
          dash: morphDash(a?.lifetime ?? unit.lifetime, b?.lifetime ?? unit.lifetime, local),
        }
      })
      .filter(unit => unit.opacity > 0)
    const placed = new Map(units.map(unit => [unit.id, unit]))
    const links = drawn
      .map(({key, link, side, window}): DiLinkFrame | undefined => {
        const from = placed.get(link.from)
        const to = placed.get(link.to)
        if (!from || !to) return undefined
        const local = smoothstep(stepProgress(window, progress))
        return {
          id: link.id,
          key,
          fromId: link.from,
          toId: link.to,
          from: {x: from.x, y: from.y + height / 2},
          to: {x: to.x, y: to.y - height / 2},
          status: side === 'both' ? (relationshipStatus.get(link.id) ?? 'unchanged') : side === 'before' ? 'removed' : 'added',
          // A relationship never outlives, or precedes, either of its cards, and one leaving with its card fades once, with it.
          opacity: Math.min(side === 'both' ? 1 : side === 'before' ? 1 - local : local, from.opacity, to.opacity),
          parameter: link.parameter,
          collection: link.collection,
          optional: link.optional,
          resolution: link.resolution,
          alias: link.alias,
        }
      })
      .filter((link): link is DiLinkFrame => !!link && link.opacity > 0)
    return {units, links}
  }
  const start = frame(0),
    end = frame(1)
  const endpointLinks = new Map([...start.links, ...end.links].map(link => [link.key, link]))
  return Object.assign(frame, {
    stepRow: (id: string) => unitPart.get(id) ?? id,
    linkStepRow: (key: string) => linkRow.get(key) ?? key,
    height,
    endpoints: {units: [...start.units, ...end.units], links: [...endpointLinks.values()]},
    runtimeResolution: [...endpointLinks.values()].some(link => link.resolution),
    aliases: [...endpointLinks.values()].some(link => link.alias),
  })
}

/** The lifetime mark's dash between two lifetimes, `local` of the way from `from` to `to`; exactly either at the ends. */
function morphDash(from: Lifetime, to: Lifetime, local: number): [number, number] {
  const length = markSpan.bottom - markSpan.top
  const [a, b] = [lifetimeDash(from, length), lifetimeDash(to, length)]
  if (local <= 0 || from === to) return local >= 1 ? b : a
  if (local >= 1) return b
  return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local]
}
