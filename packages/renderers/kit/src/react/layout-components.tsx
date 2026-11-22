/*
 * Layout components: the parts of a renderer that are styling, not the domain picture. Each carries every visual
 * decision (spacing, type, color, radius) from the theme, so a renderer composed from them meets the renderer checks
 * (`palette`, `type-scale`, `spacing`) without CSS of its own. Props take steps of the theme's scales, never lengths
 * or colors.
 */
import {useId, type CSSProperties, type ElementType, type ReactNode} from 'react'
import type {ChangeStatus as Status} from '@githubnext/projections-schemas'
import {identifier as identifierAttributes, type EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {token, type FontSizeStep, type FontWeightStep, type SpaceStep, type IconName} from '@githubnext/projections-renderer-sdk/protocol'
import {ChangeFooter, ChangeStatus, Identifier, NameLine} from './components.js'
import {changeMark} from '../diff/model.js'
import {Icon} from './icons.js'
import type {ChangeClassification} from '../emphasis.js'

interface StatusChange {
  status: Status
  renamed?: boolean | undefined
}
const join = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

/**
 * The renderer's content root: scrolls as the host's main view (`data-projections-scroll`) and starts at the top of
 * the frame (`data-projections-content`), on the stage that groups and cards stand on, set in from the frame's edges
 * by the same stage padding on all four sides: the host's `stage-inset`, else 12px. A renderer with a root of its own
 * gets the same by giving it the class `pk-stage`.
 */
export function ContentView({children, scroll = 'view'}: {children: ReactNode; scroll?: string}) {
  return (
    <div className="pk-content-view" data-projections-scroll={scroll} data-projections-content="">
      {children}
    </div>
  )
}

/** Props of `Group`: only `title` and `children` are required. */
export interface GroupProps {
  /** What the group holds, in a few words or as a code name. */
  title: ReactNode
  /**
   * The title's font: `code` for a title that is code (a command, a kind, a path or another identifier), drawn in the
   * monospace font and marked as an identifier; `text` (the default) for a title in human words, in the UI font.
   */
  titleFont?: 'text' | 'code'
  /**
   * The subject the group holds, as an icon before its title (`file` for files, `workload` for workloads): muted and
   * decorative, since the title names it. Give every group of a view one, or none.
   */
  icon?: IconName
  /** Secondary text after the title, muted: a qualifier such as a source or a kind. */
  meta?: ReactNode
  /**
   * In a comparison, the change of the item the group presents: stated in words at the header's end, in a cell of
   * `--pk-status-width` that every group reserves, so status fading in or out never moves the title.
   */
  change?: {status: Status; renamed?: boolean | undefined; varied?: EntityChange<unknown>['varied'] | undefined}
  /** The host's emphasis for `change` (`props.emphasis(row)`): 0 at both endpoints and before its step. */
  emphasis?: number
  /** In diff mode: the change the group marks (`changeMark`); a removed group's title is struck through and muted. */
  mark?: ChangeClassification | StatusChange
  /** Content buttons at the header's end, before the status: never settings, which the host draws. */
  actions?: ReactNode
  /** The selection ID of the item the group presents: the group becomes a ring unit and its title selects it. */
  id?: string
  /** Whether the item is the host's selection: its title is pressed. */
  selected?: boolean
  /** Selects the item (the renderer's `onSelect`), when its title is activated. */
  onSelect?: (id: string) => void
  /** The title's heading level; 2 by default. */
  level?: 2 | 3 | 4
  /** Changes are drawn inside it that no `data-change` marks (a nested renderer's frame): drawn neutral, as `EntityCard`'s. */
  holdsChanges?: boolean
  /** The renderer's own class, for styling its body. */
  className?: string
  /** Inline style, such as custom properties the body reads. */
  style?: CSSProperties
  /** The body: a table, list or rows, which reach the group's sides under its header band; a card grid keeps its inset. */
  children: ReactNode
}

/**
 * A titled panel: a raised, edged unit whose header band, inside its edge, names what it holds, then its body. The
 * band holds the subject's `icon`, if any, the title (`titleFont="code"` when the title is code), muted `meta`, any
 * `actions` and, in a comparison, the item's `change` in words at its end; a group marked removed in the diff strikes
 * its title through. With `id` the group presents a selectable item, ringed by the SDK over its own edge, and its title
 * is the button that selects it.
 * The body is flush with the group's sides, so a table's rows run edge to edge; the group clips them to its corners.
 */
export function Group({
  title,
  titleFont = 'text',
  icon,
  meta,
  change,
  emphasis = 0,
  mark,
  actions,
  id,
  selected = false,
  onSelect,
  level = 2,
  holdsChanges = false,
  className,
  style,
  children,
}: GroupProps) {
  const heading = useId()
  const Heading: ElementType = `h${level}`
  const code = titleFont === 'code' ? identifierAttributes : {}
  const marks = mark !== undefined ? changeMark(mark) : {}
  // A text title shows whole as the tooltip of a title that truncates.
  const text = typeof title === 'string' ? title : undefined
  const label = join('pk-group-label', 'pk-label', 'pk-truncate', marks['data-change'] !== undefined && 'pk-diff-text')
  return (
    <section
      className={join('pk-group', holdsChanges && 'pk-holds-changes', className)}
      aria-labelledby={heading}
      data-entity-id={id}
      {...marks}
      style={style}
    >
      <header className="pk-group-header">
        <Heading className="pk-group-title" id={heading}>
          {/* The icon sits in a line of its own, so it shares the title's baseline in every engine. */}
          {icon !== undefined && (
            <span className="pk-group-icon">
              <Icon name={icon} />
            </span>
          )}
          {id !== undefined && onSelect ? (
            <button type="button" className={label} {...code} title={text} aria-pressed={selected} onClick={() => onSelect(id)}>
              {title}
            </button>
          ) : (
            <span className={label} {...code} title={text}>
              {title}
            </span>
          )}
          {meta !== undefined && <span className="pk-group-meta pk-label">{meta}</span>}
        </Heading>
        {actions !== undefined && <div className="pk-group-actions">{actions}</div>}
        {change && <ChangeStatus className="pk-group-status" change={change} emphasis={emphasis} />}
      </header>
      {children}
    </section>
  )
}

/** Cards in a responsive grid: as many columns as fit, one on a phone. */
export function CardGrid({children, label}: {children: ReactNode; label?: string}) {
  return (
    <ul className="pk-card-grid" aria-label={label}>
      {children}
    </ul>
  )
}

/** Props of `EntityCard`: one entity's card, its selection and its change. */
export interface EntityCardProps {
  /** The selection ID: the card's `data-entity-id`. */
  id: string
  /** The entity's name, as text or as a `ValueChange` in the diff. */
  label: ReactNode
  /** A code name shown under the label in the monospace font, usually the entity's ID. */
  identifier?: string
  /** Whether the entity is the host's selection (`props.selectedId === id`): the card's button is pressed. */
  selected: boolean
  /** Selects the entity (the renderer's `onSelect`) with `id`, when the card's button is activated. */
  onSelect: (id: string) => void
  /** The row, for its change status: stated in words in the footer, in proportion to `emphasis`. */
  change?: StatusChange
  /** The host's emphasis for this change (`props.emphasis(row)`): 0 at both endpoints and before its step. */
  emphasis?: number
  /** In diff mode: the change this card marks, filled and edged in its hue (`changeMark`). */
  mark?: ChangeClassification | StatusChange
  /** Presence 0..1 while an entity is added or removed by the playing step (`timeline.presence`); 1 by default. */
  presence?: number
  /**
   * Changes are drawn inside it that no `data-change` marks (a nested renderer's frame): the card is drawn neutral
   * (`pk-holds-changes`), so change colors never nest.
   */
  holdsChanges?: boolean
  /** Relationships and fields, below the name. */
  children?: ReactNode
}

/**
 * One entity as a card: a unit the host rings on hover, focus and selection, a button that selects it, its name and
 * identifier, and its change status in words, in space that is always reserved. In the progress modes its edge takes
 * the change's hue as the step emphasizes it; in diff mode (`mark`) it is filled and edged like any kit region.
 */
export function EntityCard({
  id,
  label,
  identifier,
  selected,
  onSelect,
  change,
  emphasis = 0,
  mark,
  presence = 1,
  holdsChanges = false,
  children,
}: EntityCardProps) {
  const style = {'--emphasis': emphasis, ...(presence < 1 ? {opacity: presence, visibility: presence > 0 ? 'visible' : 'hidden'} : {})}
  return (
    <li
      className={join('pk-entity-card', mark !== undefined && 'pk-region', selected && 'selected', holdsChanges && 'pk-holds-changes')}
      data-entity-id={id}
      data-projections-unit=""
      data-status={mark === undefined && change && emphasis > 0 ? (change.renamed ? 'renamed' : change.status) : undefined}
      {...(mark !== undefined ? changeMark(mark) : {})}
      style={style as CSSProperties}
    >
      <button type="button" className="pk-entity-card-select" aria-pressed={selected} onClick={() => onSelect(id)}>
        <NameLine>
          <span className={join('pk-entity-card-label', mark !== undefined && 'pk-diff-text')}>{label}</span>
        </NameLine>
        {identifier !== undefined && <Identifier className="pk-entity-card-id">{identifier}</Identifier>}
      </button>
      {children}
      {change && <ChangeFooter change={change} emphasis={emphasis} />}
    </li>
  )
}

/** A card's relationships, one selectable row each (`RelationshipItem`). */
export function RelationshipList({children, label = 'Relationships'}: {children: ReactNode; label?: string}) {
  return (
    <ul className="pk-relationship-list" aria-label={label}>
      {children}
    </ul>
  )
}

/**
 * A relationship as a row: an item of its own, marked with its ID, selectable and focusable. In the progress modes it
 * grows in or shrinks out by `presence`; in diff mode `mark` fills it in its change's hue and `changeText` says the
 * change to assistive technology.
 */
export function RelationshipItem({
  id,
  selected,
  onSelect,
  presence = 1,
  mark,
  emphasis = 0,
  changeText,
  children,
}: {
  id: string
  selected: boolean
  onSelect: (id: string) => void
  presence?: number
  mark?: ChangeClassification | StatusChange
  emphasis?: number
  changeText?: string
  children: ReactNode
}) {
  const style = {
    ...(mark !== undefined ? {'--emphasis': emphasis} : {}),
    ...(presence < 1 ? {opacity: presence, maxHeight: `${1.5 * presence}em`} : {}),
  }
  return (
    <li
      className={join('pk-relationship', mark !== undefined && 'pk-region', selected && 'selected')}
      data-entity-id={id}
      data-projections-unit=""
      {...(mark !== undefined ? changeMark(mark) : {})}
      style={style}
    >
      <button type="button" aria-pressed={selected} onClick={() => onSelect(id)}>
        <span className={mark !== undefined ? 'pk-label pk-diff-text' : 'pk-label'}>{children}</span>
        {changeText && <span className="sr-only">, {changeText}</span>}
      </button>
    </li>
  )
}

/** Name and value rows, such as an entity's data. */
export function Fields({children}: {children: ReactNode}) {
  return <dl className="pk-fields">{children}</dl>
}

/** One row of `Fields`: the name is a code name, in the monospace font. */
export function Field({name, children}: {name: string; children: ReactNode}) {
  return (
    <div className="pk-field">
      <dt>
        <Identifier>{name}</Identifier>
      </dt>
      <dd>{children}</dd>
    </div>
  )
}

type Align = 'start' | 'center' | 'end' | 'baseline' | 'stretch'

/** Children in a column, `gap` steps of the space scale apart. */
export function Stack({
  children,
  gap = 2,
  align,
  as: Tag = 'div',
}: {
  children: ReactNode
  gap?: SpaceStep
  align?: Align
  as?: ElementType
}) {
  return (
    <Tag className="pk-stack" style={{gap: token.space(gap), ...(align ? {alignItems: align} : {})}}>
      {children}
    </Tag>
  )
}

/** Children in a row that wraps, `gap` steps of the space scale apart. */
export function Inline({
  children,
  gap = 2,
  align = 'baseline',
  as: Tag = 'div',
}: {
  children: ReactNode
  gap?: SpaceStep
  align?: Align
  as?: ElementType
}) {
  return (
    <Tag className="pk-inline" style={{gap: token.space(gap), alignItems: align}}>
      {children}
    </Tag>
  )
}

/**
 * Text in the theme's type: a step of the type scale, a weight and a tone. `muted` and `subtle` are for secondary
 * text; change colors are never a tone (use the kit's status components).
 */
export function Text({
  children,
  size = 'md',
  weight = 'normal',
  tone = 'default',
  as: Tag = 'span',
}: {
  children: ReactNode
  size?: FontSizeStep
  weight?: FontWeightStep
  tone?: 'default' | 'muted' | 'subtle'
  as?: ElementType
}) {
  const color = tone === 'muted' ? token.color('fg-muted') : tone === 'subtle' ? token.color('fg-subtle') : undefined
  return (
    <Tag className="pk-text" style={{fontSize: token.fontSize(size), fontWeight: token.fontWeight(weight), ...(color ? {color} : {})}}>
      {children}
    </Tag>
  )
}
