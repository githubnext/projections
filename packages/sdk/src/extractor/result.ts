// `result()` writes an extractor's extraction to stdout, and `extraction()` builds it: the protocol's fields filled in,
// entities and relationships given as lists or keyed by ID, sorted in the Engine's order and checked for basic shape.
import type {Entity, Extraction, Relationship} from '@githubnext/projections-schemas'
import {article, described, isObject, quoted} from './messages.ts'

/** The extractor protocol's version, of requests and extractions. */
export const PROTOCOL_VERSION = 0
/** The domain schema `result()` writes unless told otherwise: the general one. */
export const DEFAULT_SCHEMA = 'graph/v0'

/** Items of one kind: a list (any iterable) with IDs, or a map or object of them keyed by ID. */
export type Items<Item extends {readonly id: string}> =
  | Iterable<Item>
  | ReadonlyMap<string, Omit<Item, 'id'> & {readonly id?: string}>
  | Readonly<Record<string, Omit<Item, 'id'> & {readonly id?: string}>>

/** What an extraction holds, for `extraction()` and `result()`. */
export interface ExtractionFields extends Partial<Omit<Extraction, 'protocolVersion' | 'schema' | 'entities' | 'relationships'>> {
  /** The domain schema (default `graph/v0`). */
  readonly schema?: Extraction['schema'] | undefined
  readonly entities?: Items<Entity> | undefined
  readonly relationships?: Items<Relationship> | undefined
}

const optionalFields = new Set(['metadata', 'missingInputs', 'vocabularies', 'volatile'])
const requiredFields = {entities: ['kind', 'label'], relationships: ['kind', 'from', 'to']} as const
const singular = {entities: 'entity', relationships: 'relationship'} as const

function listed(items: unknown, field: 'entities' | 'relationships'): Record<string, unknown>[] {
  const keyed = (key: string, item: unknown) => {
    if (!isObject(item)) throw new TypeError(`${field}[${quoted(key)}] is ${described(item)}, not an object`)
    if (item.id !== undefined && item.id !== key) {
      throw new RangeError(`${field}[${quoted(key)}] has the id ${quoted(item.id)}; give it its key's, or none`)
    }
    const {id: _id, ...fields} = item
    return {id: key, ...fields}
  }
  let list: Record<string, unknown>[]
  if (items instanceof Map) list = [...items].map(([key, item]) => keyed(key as string, item))
  else if (typeof items === 'string' || typeof items !== 'object' || items === null) {
    throw new TypeError(`${field} must be an array of objects, or an object of them keyed by ID, not ${described(items)}`)
  } else if (Symbol.iterator in items) {
    list = [...(items as Iterable<unknown>)].map((item, index) => {
      if (!isObject(item)) throw new TypeError(`${field}[${index}] is ${described(item)}, not an object`)
      if (!('id' in item)) throw new RangeError(`${field}[${index}] has no id`)
      return {...item}
    })
  } else list = Object.entries(items).map(([key, item]) => keyed(key, item))
  for (const item of list) {
    if (typeof item.id !== 'string' || !item.id) {
      throw new RangeError(`${article(singular[field]).replace(/^a/u, 'A')}'s id must be a nonempty string, not ${quoted(item.id)}`)
    }
    for (const name of requiredFields[field]) {
      if (typeof item[name] !== 'string') throw new RangeError(`The ${singular[field]} ${quoted(item.id)} needs ${name}, a string`)
    }
  }
  // The Engine's order: UTF-16 code units, JavaScript's own string order.
  const id = (item: Record<string, unknown>) => item.id as string
  return list.sort((left, right) => (id(left) < id(right) ? -1 : id(left) > id(right) ? 1 : 0))
}

/**
 * The extraction `result()` writes, without writing it: `protocolVersion` and `schema` (default `graph/v0`) filled
 * in, and entities and relationships, given as lists or keyed by ID, in order of ID. Checks each item's basic shape
 * (an ID, unique across both; an entity's `kind` and `label`; a relationship's `kind`, `from` and `to`); the runner
 * checks the rest.
 */
export function extraction(fields: ExtractionFields = {}): Extraction {
  const {schema = DEFAULT_SCHEMA, entities = [], relationships = [], ...optional} = fields
  if (typeof schema !== 'string' || !schema.includes('/')) {
    throw new RangeError(`schema must name a domain schema, such as ${quoted(DEFAULT_SCHEMA)}, not ${quoted(schema)}`)
  }
  const document: Record<string, unknown> = {
    protocolVersion: PROTOCOL_VERSION,
    schema,
    entities: listed(entities, 'entities'),
    relationships: listed(relationships, 'relationships'),
  }
  const seen = new Set<string>()
  for (const item of [...(document.entities as Entity[]), ...(document.relationships as Relationship[])]) {
    if (seen.has(item.id)) throw new RangeError(`Two items have the id ${quoted(item.id)}; entities and relationships share one set of IDs`)
    seen.add(item.id)
  }
  // JavaScript callers can pass anything; an undefined or null field is left out.
  for (const [name, value] of Object.entries(optional as Record<string, unknown>)) {
    if (!optionalFields.has(name)) {
      throw new TypeError(
        `An extraction has no field ${quoted(name)}; besides its entities and relationships it may have ${[...optionalFields].join(', ')}`,
      )
    }
    if (value !== undefined && value !== null) document[name] = value
  }
  return document as unknown as Extraction
}

let written = false

/**
 * Writes the extraction to stdout and returns it: `extraction(fields)`, as JSON. Call it once, with everything. A value
 * JSON can't hold (a non-finite number, a bigint) is an error naming its item, rather than a silent `null`.
 */
export function result(fields: ExtractionFields = {}): Extraction {
  if (written) throw new Error("result() already wrote this extractor's extraction; call it once, with everything")
  const document = extraction(fields)
  const lists: unknown[] = [document.entities, document.relationships]
  let item: unknown
  const text = JSON.stringify(document, function (this: unknown, _key: string, value: unknown) {
    if (this === document) item = undefined
    else if (lists.includes(this)) item = (value as {id: unknown}).id
    if ((typeof value === 'number' && !Number.isFinite(value)) || typeof value === 'bigint' || typeof value === 'function') {
      throw new TypeError(
        `${item === undefined ? 'The extraction' : `The item ${quoted(item)}`} holds a value JSON can't represent (${String(value)}); use objects, arrays, strings, finite numbers, booleans and null`,
      )
    }
    return value
  })
  process.stdout.write(text)
  written = true
  return document
}
