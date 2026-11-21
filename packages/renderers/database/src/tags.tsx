import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {CSSProperties, RefObject} from 'react'
import type {Entity} from '@githubnext/projections-schemas'
import {identifier} from '@githubnext/projections-renderer-sdk/presentation'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {balancedWrap, changeMark, classifyChange, describeChange, easeWithin, isChanged} from '@githubnext/projections-renderer-kit'
import {StatusTab} from '@githubnext/projections-renderer-kit/react'
import type {RendererProps} from '@githubnext/projections-renderer-kit/react'
import type {DatabaseTransition} from './transition.js'
import type {FrameTag, SchemaFrame} from './frame.js'

export const tagLimit = 500

const unchanged = {status: 'unchanged'} as const

const tagClass = 'database-tag'

/** Each tag's slot: the pill plus its status tab's reserved room, in canvas coordinates. */
interface TagSlot {
  x: number
  y: number
  width: number
}

/** A pill wider than this never grows its line: the frame scrolls rather than squeezing it. */
const resizeHysteresis = 16

/** Every tag of either revision, in the order a single revision lists them, with every name it has. */
function allTags(transition: Pick<DatabaseTransition, 'tagStages'>, changes: ReadonlyMap<string, EntityChange<Entity>>) {
  const names = new Map<string, string[]>()
  for (const stage of transition.tagStages) {
    for (const tag of stage) {
      const known = names.get(tag.id) ?? []
      if (!known.includes(tag.label)) names.set(tag.id, [...known, tag.label])
    }
  }
  const kind = (id: string) => {
    const change = changes.get(id)
    return (change?.after ?? change?.before)?.kind ?? ''
  }
  return [...names.entries()]
    .sort(
      ([a, aNames], [b, bNames]) => kind(a).localeCompare(kind(b)) || aNames.at(-1)!.localeCompare(bNames.at(-1)!) || a.localeCompare(b),
    )
    .slice(0, tagLimit)
    .map(([id, labels]) => ({id, labels}))
}

type Tag = ReturnType<typeof allTags>[number]
interface Sizes {
  widths: number[]
  height: number
  columnGap: number
  rowGap: number
}

/** Measures every slot once, in content units, again as fonts load. */
function useSlotSizes(tags: readonly Tag[], room: RefObject<HTMLDivElement | null>, measures: RefObject<HTMLDivElement | null>) {
  const [sizes, setSizes] = useState<Sizes>()
  useLayoutEffect(() => {
    const measure = () => {
      const container = measures.current,
        outer = room.current
      if (!container || !outer) return
      const items = [...container.querySelectorAll<HTMLElement>('[data-measure-id]')]
      const style = getComputedStyle(outer)
      // Measured in content units: the schema may be drawn scaled (fitted or zoomed). The measuring row is 0px wide,
      // so the scale is read from the tag block around it.
      const unit = outer.offsetWidth ? outer.getBoundingClientRect().width / outer.offsetWidth : 1
      const size = (element: Element) => {
        const box = element.getBoundingClientRect()
        return {width: box.width / unit, height: box.height / unit}
      }
      // A slot is as wide as its widest name or its status tab, whichever is wider (see the kit's `StatusTab`).
      setSizes({
        widths: items.map(item => {
          const status = item.querySelector<HTMLElement>('.pk-status-tab')
          return Math.ceil(Math.max(size(item).width, status ? size(status).width : 0))
        }),
        height: Math.max(0, ...items.map(item => Math.ceil(size(item).height))),
        columnGap: parseFloat(style.columnGap) || 0,
        rowGap: parseFloat(style.rowGap) || 0,
      })
    }
    measure()
    document.fonts?.addEventListener('loadingdone', measure)
    return () => document.fonts?.removeEventListener('loadingdone', measure)
  }, [tags, room, measures])
  return sizes
}

/**
 * Where each tag this frame shows sits: slots measured once, wrapped with the kit's `balancedWrap`, and recomputed
 * only when the room changes by more than `resizeHysteresis` pixels or no longer fits.
 */
function useTagLayout(tags: readonly Tag[], frame: SchemaFrame) {
  const room = useRef<HTMLDivElement>(null)
  const measures = useRef<HTMLDivElement>(null)
  const sizes = useSlotSizes(tags, room, measures)
  const [available, setAvailable] = useState<number>()
  const placed = useRef<{lines: number[]; available: number}>(undefined)
  useLayoutEffect(() => {
    const outer = room.current
    if (!outer) return
    const resize = () => {
      const width = outer.clientWidth
      setAvailable(previous => {
        const widest = placed.current ? Math.max(0, ...placed.current.lines) : 0
        if (previous === undefined || Math.abs(width - previous) > resizeHysteresis || widest > width) return width
        return previous
      })
    }
    resize()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(resize)
    observer.observe(outer)
    return () => observer.disconnect()
  }, [])
  // Only the tags this frame shows are wrapped, so no line has a hole; the set changes only as a tag fades in or out.
  const present = frame.tags.map(tag => tag.change.id).join('\u0000')
  const layout = useMemo(() => {
    if (!sizes || available === undefined || sizes.widths.length !== tags.length) return undefined
    const shown = new Set(present.split('\u0000'))
    const indexes = tags.flatMap((tag, index) => (shown.has(tag.id) ? [index] : []))
    const widths = indexes.map(index => sizes.widths[index]!)
    const wrap = balancedWrap(widths, sizes.columnGap, available)
    const slots = new Map<string, TagSlot>()
    wrap.lines.forEach((line, row) => {
      let x = Math.max(0, (available - wrap.widths[row]!) / 2)
      for (const index of line) {
        slots.set(tags[indexes[index]!]!.id, {x, y: row * (sizes.height + sizes.rowGap), width: widths[index]!})
        x += widths[index]! + sizes.columnGap
      }
    })
    const height = wrap.lines.length ? wrap.lines.length * sizes.height + (wrap.lines.length - 1) * sizes.rowGap : 0
    return {slots, height, widths: wrap.widths}
  }, [sizes, available, tags, present])
  useEffect(() => {
    if (layout && available !== undefined) placed.current = {lines: layout.widths, available}
  }, [layout, available])
  return {room, measures, layout}
}

/** The hidden pills slots are measured from: each with every name it has and its status tab's room. */
function TagMeasures({tags, changes}: {tags: readonly Tag[]; changes: ReadonlyMap<string, EntityChange<Entity>>}) {
  return tags.map(tag => {
    const change = changes.get(tag.id) ?? unchanged
    return (
      <span key={tag.id} data-measure-id={tag.id} className="database-tag-slot">
        <span className={tagClass}>
          <span className="database-tag-name" {...identifier}>
            <span className="database-tag-label">
              {tag.labels.map(label => (
                <span key={label}>{label}</span>
              ))}
            </span>
          </span>
          <StatusTab change={change} emphasis={0} measure />
        </span>
      </span>
    )
  })
}

/** One tag in its slot: fading in or out there, crossfading its name when renamed. */
function TagPill({tag, slot, props, diff}: {tag: FrameTag; slot: TagSlot | undefined; props: RendererProps; diff: boolean}) {
  const id = tag.change.id
  const emphasis = props.emphasis(tag.change)
  const renamed = tag.label.from !== tag.label.to
  const shown = tag.label.mix < 0.5 ? tag.label.from : tag.label.to
  // In the diff a tag reads its After name; a former name is said in words.
  const former =
    diff && tag.change.before && tag.change.after && tag.change.before.label !== tag.change.after.label
      ? tag.change.before.label
      : undefined
  const fade = renamed ? easeWithin(tag.label.mix, 0.1, 0.9) : 0
  // Placed by its offsets, not a transform: WebKit keeps a transformed slot's old place in the block's scrollable
  // overflow after the slots move (to a narrower width), so the block would still scroll to where it was.
  const geometry: CSSProperties = slot ? {left: slot.x, top: slot.y, width: slot.width} : {visibility: 'hidden'}
  const status = emphasis > 0.01 && isChanged(tag.change) ? `, ${describeChange(tag.change)}` : ''
  return (
    <div
      role="listitem"
      className="database-tag-slot"
      style={{...geometry, opacity: tag.opacity, visibility: slot && tag.opacity > 0 ? undefined : 'hidden'}}
    >
      <button
        type="button"
        data-entity-id={id}
        aria-label={`${shown}${status}${former ? `, was ${former}` : ''}`}
        aria-pressed={props.selectedId === id}
        onClick={() => props.onSelect(id)}
        className={`${tagClass} ${classifyChange(tag.change)}${props.selectedId === id ? ' selected' : ''}`}
        style={{'--emphasis': emphasis} as CSSProperties}
        {...(diff ? changeMark(tag.change) : {})}
        {...(former ? {title: `${shown} (was ${former})`} : {})}
      >
        <span className={`database-tag-name${diff ? ' pk-diff-text' : ''}`} {...identifier}>
          {renamed ? (
            <span className="database-tag-label" aria-hidden="true">
              <span style={{opacity: 1 - fade}}>{tag.label.from}</span>
              <span style={{opacity: fade}}>{tag.label.to}</span>
            </span>
          ) : (
            shown
          )}
        </span>
        <StatusTab change={tag.change} emphasis={emphasis} />
      </button>
    </div>
  )
}

/**
 * Keys, indexes and other entities, as pills under the cards. Every tag in
 * either revision has one fixed slot for the whole comparison: slots are
 * measured once with their widest name and their status tab's room reserved,
 * then wrapped with the kit's `balancedWrap` (as few lines as fit, the top
 * line at least as long as each later one, lines as even as possible), so no
 * line reflows while scrubbing. Arriving and leaving tags fade in their slots;
 * a renamed tag crossfades its name. Slots are recomputed only when the room
 * changes by more than `resizeHysteresis` pixels, or no longer fits.
 */
export function DatabaseTags({
  transition,
  frame,
  props,
  minWidth,
}: {
  transition: Pick<DatabaseTransition, 'tags' | 'tagStages'>
  frame: SchemaFrame
  props: RendererProps
  minWidth: number
}) {
  const diff = props.diff && props.comparing
  const changes = useMemo(() => new Map(transition.tags.map(change => [change.id, change])), [transition])
  const tags = useMemo(() => allTags(transition, changes), [transition, changes])
  const {room, measures, layout} = useTagLayout(tags, frame)
  if (!tags.length) return null
  return (
    <div ref={room} className="database-tags" role="list" aria-label="Keys and indexes" style={{height: layout?.height, minWidth}}>
      <div ref={measures} className="database-tags-measure" aria-hidden="true" inert>
        <TagMeasures tags={tags} changes={changes} />
      </div>
      {frame.tags.map(tag => (
        <TagPill key={tag.change.id} tag={tag} slot={layout?.slots.get(tag.change.id)} props={props} diff={diff} />
      ))}
    </div>
  )
}
