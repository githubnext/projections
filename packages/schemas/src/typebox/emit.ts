import type {TSchema} from 'typebox'
import {schemaUrl} from '../constants.js'
import {definitionAt, definitionsOf, homeOf, type Home} from './support.js'

/** One published JSON Schema document `emit` produced, ready to write under the schema root. */
export interface EmittedSchema {
  /** The document's path below the published schema root, such as `extraction/v0.json`. */
  path: string
  /** The document: `$schema`, `$id`, `title`, the root schema's keywords, then its `$defs`, in that key order. */
  json: Record<string, unknown>
}

const first = ['$schema', '$id', '$ref', 'title', 'description', 'type', 'const', 'enum', 'additionalProperties', 'required', 'properties']
const last = new Set(['$defs'])

function ordered(entries: [string, unknown][]): [string, unknown][] {
  const rank = (key: string) => {
    const index = first.indexOf(key)
    if (index >= 0) return index - first.length
    return last.has(key) ? 1 : 0
  }
  return entries
    .map((entry, index) => [entry, index] as const)
    .toSorted((a, b) => rank(a[0][0]) - rank(b[0][0]) || a[1] - b[1])
    .map(([entry]) => entry)
}

/**
 * JSON Schema documents from TypeBox schemas: draft 2020-12, with an absolute `$id` per document, shared
 * definitions in the `$defs` of the document that defines them and `$ref`s everywhere else.
 */
export function emit(documents: {name: string; title: string; schema: TSchema}[], version = 0): EmittedSchema[] {
  const published = new Set(documents.map(document => document.name))
  return documents.map(document => {
    const reference = (home: Home) => {
      if (!published.has(home.document)) throw new Error(`${document.name} refers to unpublished ${home.document}`)
      const base = home.document === document.name ? '' : schemaUrl(home.document, version)
      return home.name === undefined ? base || '#' : `${base}#/$defs/${home.name}`
    }
    // Maps of names to schemas keep their order; only schema keywords are ordered.
    function names(value: Record<string, unknown>) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item, false)]))
    }
    function serialize(value: unknown, top: boolean): unknown {
      if (Array.isArray(value)) return value.map(item => serialize(item, false))
      if (typeof value !== 'object' || value === null) return value
      const home = top ? undefined : homeOf(value)
      if (home) {
        // A use of a shared definition: a `$ref`, with any annotations the use adds (such as a description).
        const definition = definitionAt(home) as unknown as Record<string, unknown>
        const extras = Object.entries(value).filter(([key, item]) => definition[key] !== item)
        return Object.fromEntries(
          ordered([...extras.map(([key, item]) => [key, serialize(item, false)] as [string, unknown]), ['$ref', reference(home)]]),
        )
      }
      return Object.fromEntries(
        ordered(
          Object.entries(value).map(([key, item]) => [
            key,
            ['properties', 'patternProperties', '$defs'].includes(key) ? names(item as Record<string, unknown>) : serialize(item, false),
          ]),
        ),
      )
    }
    const root = serialize(document.schema, true) as Record<string, unknown>
    const definitions = definitionsOf(document.name)
    const json = Object.fromEntries(
      ordered([
        ['$schema', 'https://json-schema.org/draft/2020-12/schema'],
        ['$id', schemaUrl(document.name, version)],
        ['title', document.title],
        ...Object.entries(root),
        ...(definitions.length
          ? [['$defs', Object.fromEntries(definitions.map(([name, schema]) => [name, serialize(schema, true)]))] as [string, unknown]]
          : []),
      ]),
    )
    return {path: `${document.name}/v${version}.json`, json}
  })
}
