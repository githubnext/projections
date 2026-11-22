import type {Entity, Json} from '@githubnext/projections-schemas'
import type {CardText, RowText, TextSizer} from './text.js'

/** The schema layout's model and geometry types (see layout.ts). */

export type SchemaLayoutMode = 'columns' | 'stack'
export type SchemaColumnRole = 'pk' | 'fk' | 'pk-fk'
export interface SchemaPoint {
  x: number
  y: number
}
export interface SchemaBox {
  x: number
  y: number
  width: number
  height: number
}

/** Geometry shared with styles.css: 38px headers, 32px rows. */
export const schemaMetrics = {
  header: 38,
  row: 32,
  /**
   * Room between ranks for a link's tail stub, two turns of about 22 (short of the view's `linkRadius`, so measured
   * card widths keep their share of a narrow frame) and its arrowhead's lead-in.
   */
  rankGap: 66,
  tableGap: 24,
  lane: 12,
  /** The innermost lane's distance from the cards: an arrowhead's lead-in and a turn. */
  gutterPad: 22,
  minCard: 196,
  maxCard: 300,
  maxStackedCard: 380,
  waypoint: 12,
  clearance: 6,
  /** The widest a card grows to show its text on one line, when the frame has room; beyond it, text wraps. */
  maxContentCard: 440,
} as const

/** One state of the schema, in presented row IDs: an endpoint, or the state after some comparison steps. */
export interface SchemaState {
  entities: ReadonlyMap<string, Entity>
  relationships: readonly {id: string; kind: string; from: string; to: string; data?: Record<string, Json> | undefined}[]
}

/**
 * One foreign-key link, a column's link to the enum that types it, or a many-to-many relationship between two tables.
 * A missing column attaches to the card header.
 */
export interface SchemaLink {
  key: string
  /**
   * `enum`: a column typed by an enum card, not a foreign key. `many-to-many`: Prisma's implicit relation between two
   * tables, with no join table or columns of its own; neither end depends on the other.
   */
  type?: 'enum' | 'many-to-many'
  /** Selection ID of the relationship the link draws. */
  relationship: string
  dependent: string
  dependentColumn?: string
  principal: string
  principalColumn?: string
}

/** What a card row draws: a column, a key or index of the card's table, or an enum's value. */
export type SchemaRowKind = 'column' | 'key' | 'value'

/** A key or index drawn as a row of its table's card: its kind marker, the columns it covers, and its own name when it has one. */
export interface SchemaKeyRow {
  /** `PK`, `FK`, `UK`, `IX` or `CK`; empty for a kind the renderer doesn't know (its label then says what it is). */
  marker: string
  /** The marker in words: `Primary key`, `Unique`, `Index`… */
  title: string
  /** The covered columns, as the data names them, or the key's label when it names none. */
  text: string
  /** The key's own name, when it isn't just its kind and columns. */
  name?: string
}

/** A column's key marker, and the single-column key or foreign-key constraint it stands for. */
export interface SchemaMarker {
  label: 'PK' | 'FK'
  title: string
  /** The constraint entity the marker draws (selectable, with its own status). */
  key?: string
}

export interface SchemaModel {
  /** Cards: tables, views and enums. */
  tables: string[]
  /** Each card's rows, top to bottom: columns, then the table's keys and indexes; an enum's values. */
  columns: Map<string, string[]>
  /** Rows that aren't columns. */
  kinds: Map<string, SchemaRowKind>
  roles: Map<string, SchemaColumnRole>
  markers: Map<string, SchemaMarker>
  keyRows: Map<string, SchemaKeyRow>
  /** Each enum value row's value. */
  values: Map<string, string>
  links: SchemaLink[]
  rank: Map<string, number>
  /** Entities no card holds (keys of no table, other kinds), shown as tags. */
  others: string[]
  /** What each card and row shows in this stage, for sizing them (see text.ts). */
  texts: {cards: Map<string, CardText>; rows: Map<string, RowText>}
}

export interface SchemaLayout {
  mode: SchemaLayoutMode
  width: number
  height: number
  cardWidth: number
  tables: Map<string, SchemaBox>
  /** Row index of each column within its table. */
  rows: Map<string, number>
  /** Each row's top edge from its card's top edge, and its height: a row grows to show its text whole. */
  offsets: Map<string, number>
  heights: Map<string, number>
  /** Each card's header height: taller when its name wraps. */
  headers: Map<string, number>
  /** Each card's status cell width: room for the status words it shows, none when the comparison doesn't change it. */
  statuses: Map<string, number>
  /** What sized the cards and rows: the view draws text in the lines it counted. */
  sizer: TextSizer
  /** Interior waypoints of each link, ordered from the dependent to the principal. */
  routes: Map<string, SchemaPoint[]>
}
