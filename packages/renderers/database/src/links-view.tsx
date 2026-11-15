import {changeMark, describeChange, arrowHeadStyle, edgePaint, isChanged} from '@githubnext/projections-renderer-kit'
import type {RendererProps} from '@githubnext/projections-renderer-kit/react'
import type {FrameLink} from './frame.js'
import {linkHead, linkPath} from './link-geometry.js'

/** A link's stroke: the accent when it or an end is selected, else its change emphasis. */
function linkPaint(link: FrameLink, props: RendererProps) {
  const own = props.selectedId === link.relationship
  const selected =
    own ||
    (props.selectedId !== null && [link.dependent, link.principal, link.dependentColumn, link.principalColumn].includes(props.selectedId))
  const emphasis = props.emphasis(link)
  const paint = selected ? {stroke: 'var(--accent)', strokeWidth: 'var(--stroke-strong)'} : edgePaint(link, emphasis, 1.5)
  return {selected, emphasis, paint}
}

/** A link's arrowhead, drawn in the layer over the tables. */
export function LinkHead({link, props}: {link: FrameLink; props: RendererProps}) {
  return (
    <path
      className="database-arrowhead"
      data-projections-edge="fill"
      d={linkHead(link).path}
      style={arrowHeadStyle(linkPaint(link, props).paint.stroke)}
      opacity={link.opacity}
      data-head-of-link={link.key}
      data-to={link.principal}
      data-projections-ring-with={link.relationship}
    />
  )
}

export function Link({
  link,
  props,
  name,
  focusable,
  diff,
}: {
  link: FrameLink
  props: RendererProps
  name: string
  focusable: boolean
  diff: boolean
}) {
  const own = props.selectedId === link.relationship
  const {selected, emphasis, paint} = linkPaint(link, props)
  // A leaving link is dashed while emphasized, so its status doesn't rest on color alone.
  const dashed = emphasis > 0.01 && link.status === 'removed'
  // A column's enum type is dotted, so it never reads as a foreign key.
  const dash = dashed ? '5 4' : link.type === 'enum' ? '1.5 3' : undefined
  const label = emphasis > 0.01 && isChanged(link) ? `${name} (${describeChange(link)})` : name
  const d = linkPath(link)
  const select = () => props.onSelect(link.relationship)
  // A relationship drawn as several column links is one tab stop, on its first link.
  return (
    <g
      opacity={link.opacity}
      data-link-key={link.key}
      data-entity-id={link.relationship}
      data-from={link.dependent}
      data-to={link.principal}
      data-sides={link.sides.join('/')}
      {...(diff ? changeMark(link.status) : {})}
    >
      <path
        className={`database-link${selected ? ' selected' : ''}`}
        data-projections-edge="line"
        d={d}
        style={paint}
        strokeDasharray={dash}
      />
      <path
        className="database-link-hit"
        d={d}
        role="button"
        tabIndex={focusable ? 0 : -1}
        aria-label={label}
        aria-pressed={own}
        onClick={select}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            select()
          }
        }}
      />
    </g>
  )
}
