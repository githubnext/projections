import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {
  SchemaBox,
  SchemaColumnRole,
  SchemaKeyRow,
  SchemaMarker,
  SchemaRowKind,
  SchemaLayoutMode,
  SchemaLink,
  SchemaPoint,
} from './schema.js'
import type {ChangeLine} from './change-lines.js'

export interface FrameColumn {
  change: EntityChange<Entity>
  /** A column, a key or index of the table, or an enum's value. */
  kind: SchemaRowKind
  /** Offset of the row's top edge from the card's top edge, and the row's height. */
  top: number
  height: number
  opacity: number
  role?: SchemaColumnRole
  /** A column's key marker, and the change of the constraint it stands for. */
  marker?: SchemaMarker & {change?: EntityChange<Entity>}
  /** A key row's marker, columns and name. */
  key?: SchemaKeyRow
  /** The version a viewer reads at this point (switches halfway through the column's own step). */
  entity: Entity
  /** Diff only: what changed about the row, each line a row slot under it. */
  lines?: ChangeLine[]
  /** Diff only: the heights of the row's own slot and each change line's. */
  slots?: number[]
}
export interface FrameTable {
  change: EntityChange<Entity>
  entity: Entity
  box: SchemaBox
  /** The header's height: taller when the name wraps, with the kind and status under it. */
  header: number
  /** The header's status cell width: room for this card's status words, none when it doesn't change. */
  status: number
  opacity: number
  columns: FrameColumn[]
}
export interface FrameLink extends SchemaLink {
  /** Curved links run between ranks; orthogonal links follow a gutter lane or loop back to their own card. */
  shape: 'curved' | 'orthogonal'
  /** Dependent anchor, interior waypoints, then principal anchor. */
  points: SchemaPoint[]
  sides: ['left' | 'right', 'left' | 'right']
  /** Each S between ranks: its crossing run's offset from the gap's middle (see the kit's `RouteOptions.track`). */
  tracks: number[]
  opacity: number
  /** Whether the link exists before and after the comparison (in the diff, a link of a changed relationship on both sides is modified). */
  status: 'added' | 'removed' | 'modified' | 'unchanged'
}
export interface FrameTag {
  change: EntityChange<Entity>
  opacity: number
  label: {from: string; to: string; mix: number}
}
export interface SchemaFrame {
  mode: SchemaLayoutMode
  width: number
  height: number
  tables: FrameTable[]
  links: FrameLink[]
  tags: FrameTag[]
  /** The two layout stages this frame interpolates between, and how far. */
  stage: {from: number; to: number; mix: number}
}
