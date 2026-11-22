import {memo, useEffect} from 'react'
import type {KeyboardEvent} from 'react'
import {classifyChange, statusParts, otherToken} from '@githubnext/projections-renderer-kit'
import {identifier} from '@githubnext/projections-renderer-sdk/presentation'
import type {Circle} from './transition.js'

/** A change's status as one centred line (`+ Added`), for a circle's reserved status band. */
function StatusLine({row, emphasis, y}: {row: Circle['row']; emphasis: number; y: number}) {
  const parts = emphasis > 0.01 ? statusParts(row) : []
  if (!parts.length) return null
  return (
    <text
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      className="pk-svg-status fp-status"
      opacity={Math.min(1, emphasis)}
      aria-hidden="true"
    >
      {parts.map((part, index) => (
        <tspan key={part.status} className={`pk-status-part ${part.status}`} data-change-status={part.status} dx={index ? 8 : 0}>
          {`${part.glyph} ${part.label}`}
        </tspan>
      ))}
    </text>
  )
}

/** A change's glyph alone (`+`, `−`, `~`, `→`), for a circle too small for its status line. */
function StatusGlyph({row, emphasis, y}: {row: Circle['row']; emphasis: number; y: number}) {
  const parts = emphasis > 0.01 ? statusParts(row) : []
  if (!parts.length) return null
  return (
    <text
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      className="pk-svg-status fp-glyph"
      opacity={Math.min(1, emphasis)}
      aria-hidden="true"
    >
      {parts.map(part => (
        <tspan key={part.status} className={`pk-status-part ${part.status}`} data-change-status={part.status}>
          {part.glyph}
        </tspan>
      ))}
    </text>
  )
}

/** A flag a leaf carries (`data.flags`) as drawn: its key and its palette paint. */
export interface DrawnFlag {
  key: string
  label: string
  paint: string
}

/** Most flags drawn on one circle; its accessible name lists them all. */
const flagLimit = 4

/** Room a dot keeps from its circle's edge, clear of the change ring drawn just inside it. */
const ringClearance = 1.5

/**
 * Where a circle's flag dots go: a centred row near the bottom, inside the change ring, as many as fit (the
 * accessible name lists every flag); none on tiny circles.
 */
export function flagDots(r: number, count: number): {x: number; y: number; r: number}[] {
  if (!count || r < 6) return []
  const dot = Math.max(1.5, Math.min(5, r * 0.16))
  const step = dot * 2.5
  const reach = r - ringClearance - dot
  let shown = Math.min(count, flagLimit)
  while (shown > 1 && ((shown - 1) / 2) * step > reach * 0.85) shown--
  const half = ((shown - 1) / 2) * step
  const y = Math.min(r - dot * 1.9, Math.sqrt(reach * reach - half * half))
  return Array.from({length: shown}, (_, index) => ({x: (index - (shown - 1) / 2) * step, y, r: dot}))
}

/**
 * A leaf's flags as dots in their palette colors, each outlined in the canvas color so it reads on any fill. The
 * same colors as the kinds of those names, so the legend names both.
 */
function FlagDots({flags, r}: {flags: readonly DrawnFlag[]; r: number}) {
  const dots = flagDots(r, flags.length)
  if (!dots.length) return null
  return (
    <g className="fp-flags" aria-hidden="true">
      {dots.map((dot, index) => (
        <circle
          key={flags[index]!.key}
          className="fp-flag"
          data-flag={flags[index]!.key}
          data-projections-category={flags[index]!.key}
          cx={dot.x}
          cy={dot.y}
          r={dot.r}
          style={{fill: flags[index]!.paint}}
        />
      ))}
    </g>
  )
}

export interface Drawn {
  circle: Circle
  id: string
  row: Circle['row']
  r: number
  emphasis: number
  changed: boolean
  paint: string | undefined
  folder: boolean
  select: () => void
  label: string
  text: string | undefined
  status: 'line' | 'glyph' | undefined
  labelY: number
  statusY: number
  arc: 'top' | 'bottom' | 'inside'
  flags: readonly DrawnFlag[]
  removedGhost: boolean
  /** What the circle stands on: the stage at the top level, else its folder's fill (see `.fp-packing` in styles.css). */
  ground: 'stage' | 'folder'
  /** A folder with emphasized changes inside it: its change ring is neutral, so change colors never nest (`withHolders`). */
  holdsChanges: boolean
}

/** Performance marks for each layout and label placement, so tests and profiles can see when they run. */
export const layoutMark = 'file-packing:layout'
export const labelsMark = 'file-packing:labels'
export const drawMark = 'file-packing:draw'

/**
 * Every circle, then their names and status in one layer above them, so a child never covers its folder's name;
 * each circle's accessible name carries both. Memoized: hover and tooltips never redraw the circles.
 */
export const Circles = memo(
  ({drawn, selectedId, arcIds}: {drawn: readonly Drawn[]; selectedId: string | null; arcIds: ReadonlyMap<string, string>}) => {
    useEffect(() => {
      performance.mark(drawMark)
    })
    return (
      <>
        {drawn.map(({circle, id, row, r, emphasis, changed, paint, folder, select, label, removedGhost, flags, ground, holdsChanges}) => (
          <g
            key={id}
            data-entity-id={id}
            data-projections-unit=""
            data-ground={ground}
            className={`fp-node ${folder ? 'fp-folder' : 'fp-file'}${selectedId === id ? ' selected' : ''}`}
            transform={`translate(${circle.x},${circle.y})`}
            opacity={circle.opacity}
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={selectedId === id}
            onClick={select}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                select()
              }
            }}
          >
            <circle
              className="fp-surface"
              data-projections-edge=""
              r={r}
              {...(folder ? {} : {'data-projections-category': circle.category ?? ''})}
              style={
                folder
                  ? undefined
                  : {
                      fill: paint ?? `var(--projections-${otherToken})`,
                      fillOpacity: removedGhost ? 1 - 0.6 * Math.min(1, emphasis) : undefined,
                    }
              }
            />
            {!folder && flags.length > 0 && <FlagDots flags={flags} r={r} />}
            {emphasis > 0.01 && changed && (
              <circle
                className={`fp-emphasis ${classifyChange(row)}${holdsChanges ? ' pk-holds-changes' : ''}`}
                data-projections-edge=""
                r={Math.max(0, r - 1)}
                opacity={Math.min(1, emphasis)}
              />
            )}
          </g>
        ))}
        <g className="fp-labels" aria-hidden="true">
          {drawn
            .filter(({text, status}) => text !== undefined || status !== undefined)
            .map(({circle, id, row, r, emphasis, folder, text, status, labelY, statusY, arc, ground, holdsChanges}) => (
              <g
                key={id}
                data-label-for={id}
                {...(holdsChanges ? {className: 'pk-holds-changes'} : {})}
                data-ground={ground}
                {...(folder ? {'data-folder': ''} : {})}
                transform={`translate(${circle.x},${circle.y})`}
                opacity={circle.opacity}
              >
                {text !== undefined &&
                  (folder && arc !== 'inside' ? (
                    <>
                      <defs>
                        {/* Left to right over the top, or under the bottom, so the name reads upright either way. */}
                        <path id={arcIds.get(id)} d={`M ${-r} 0 A ${r} ${r} 0 0 ${arc === 'bottom' ? 0 : 1} ${r} 0`} />
                      </defs>
                      <text className="fp-label fp-folder-label" data-arc={arc} dominantBaseline="central" {...identifier}>
                        {/* WebKit doesn't inherit dominant-baseline into a textPath: without its own, the name sits above the outline. */}
                        <textPath href={`#${arcIds.get(id)}`} startOffset="50%" textAnchor="middle" dominantBaseline="central">
                          {text}
                        </textPath>
                      </text>
                    </>
                  ) : (
                    <text
                      className={folder ? 'fp-label fp-folder-label' : 'fp-label'}
                      y={labelY}
                      textAnchor="middle"
                      dominantBaseline="central"
                      {...(folder ? {'data-arc': arc} : {})}
                      {...identifier}
                    >
                      {text}
                    </text>
                  ))}
                {status === 'line' && <StatusLine row={row} emphasis={emphasis} y={statusY} />}
                {status === 'glyph' && <StatusGlyph row={row} emphasis={emphasis} y={statusY} />}
              </g>
            ))}
        </g>
      </>
    )
  },
)

/** The single root holding everything, drawn as the selectable background rather than a circle. */
export function RootSurface({
  id,
  label,
  opacity,
  selected,
  onSelect,
  view,
}: {
  id: string
  label: string
  opacity: number
  selected: boolean
  onSelect: (id: string) => void
  view: {x: number; y: number; width: number; height: number}
}) {
  return (
    <g
      key="root"
      data-entity-id={id}
      data-projections-unit=""
      className={`fp-node fp-root${selected ? ' selected' : ''}`}
      opacity={opacity}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      onClick={() => onSelect(id)}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(id)
        }
      }}
    >
      <rect className="fp-surface" data-projections-edge="" x={view.x} y={view.y} width={view.width} height={view.height} />
    </g>
  )
}
