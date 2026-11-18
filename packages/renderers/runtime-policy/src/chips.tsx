import {codeSpan} from '@githubnext/projections-schemas'
import {proseOf} from './model.js'
import {chipPrefix} from './prose.js'
import type {Chip, Item} from './model.js'
import {emphasisStyle, regionOf} from './frame.js'
import type {Frame} from './frame.js'
import {Prose} from './breaks.js'

/** How a covering policy acts on a workload, as prose: its strongest effect, and the containers a container selector picks. */
function coverage(chip: Chip): string {
  const effect = chip.subject.entity.data?.['effect']
  const verb =
    effect === 'enforce' ? 'enforces' : effect === 'observe' ? 'observes' : effect === 'unknown' ? 'unknown effect' : 'declares no effect'
  const containers = chip.data?.['containers']
  if (!Array.isArray(containers) || !containers.length) return ` ${verb}`
  return ` ${verb} on ${containers.map(name => codeSpan(String(name))).join(', ')}`
}

/** A chip's subject, as prose: workloads in the extractor's words, binaries and policies as code. */
function subjectProse(chip: Chip): string {
  const entity = chip.subject.entity
  if (entity.kind === 'policy' || entity.data?.['subjectKind'] === 'binary') return codeSpan(entity.label)
  return proseOf(entity.data?.['display'], entity.label)
}

export function Chips({
  chips,
  frame,
  owner,
  strength,
  empty,
  label,
}: {
  chips: Chip[]
  frame: Frame
  owner: Item
  strength: number
  empty: string
  label: string
}) {
  const named = <span className="rp-side-label">{label} </span>
  if (!chips.length)
    return (
      <span className="rp-any">
        {named}
        {empty}
      </span>
    )
  const ownerRegion = regionOf(owner)
  return (
    <span className="rp-chips">
      {named}
      {chips.map(chip => {
        const selected = frame.props.selectedId === chip.subject.row.id
        // In the diff a chip arrives or leaves with its relationship; a side-by-side pane marks a subject that is itself added or removed.
        const own = chip.subject.row.status
        const change =
          frame.side === 'diff' ? chip.change : strength > 0 && (own === 'added' || own === 'removed') ? own : ('unchanged' as const)
        const word = change === 'added' ? 'Added' : change === 'removed' ? 'Removed' : undefined
        // A chip of an added or removed row arrives or leaves with it: marked by its sign, not a second fill.
        const filled = frame.side === 'diff' && change !== 'unchanged' && change !== ownerRegion
        const prefix = chipPrefix(chip)
        const follow = chip.data?.['followChildren'] === true
        return (
          <button
            key={chip.key}
            type="button"
            className={`rp-chip pk-part ${change}${filled ? ' filled' : ''}${selected ? ' selected' : ''}`}
            data-entity-id={chip.subject.row.id}
            {...(filled ? {'data-change': change} : {})}
            aria-pressed={selected}
            style={emphasisStyle(change === 'unchanged' ? 0 : strength)}
            onClick={event => {
              event.stopPropagation()
              frame.props.onSelect(chip.subject.row.id)
            }}
          >
            {frame.side === 'diff' && change !== 'unchanged' && (
              <span className="rp-chip-sign" aria-hidden="true">
                {change === 'added' ? '+' : '−'}
              </span>
            )}
            {word && <span className="sr-only">{word}: </span>}
            {prefix && <span className="rp-chip-prefix">{prefix} </span>}
            <span className="rp-chip-label">
              <Prose>{subjectProse(chip)}</Prose>
              {follow && <span className="rp-chip-prefix"> and children</span>}
              {chip.kind === 'covers' && (
                <span className="rp-chip-prefix">
                  <Prose>{coverage(chip)}</Prose>
                </span>
              )}
            </span>
          </button>
        )
      })}
    </span>
  )
}
