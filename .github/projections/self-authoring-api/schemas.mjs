// JSON Schema documents as api/v0 declarations: one row for the document, one for each named definition (`$defs`) and
// one for each field, nested by `contains`, each with a TypeScript-like signature of its type and constraints. Prose
// (`description`) is left out, as API signatures leave out documentation comments: a reworded description is no
// change to the surface.
import {pointerLines} from './json-lines.mjs'

const refName = ref => ref.slice(ref.lastIndexOf('/') + 1)
const literal = value => JSON.stringify(value)
const typing = ['type', '$ref', 'const', 'enum', 'properties', 'additionalProperties', 'items', 'anyOf', 'oneOf', 'allOf']
// An alternative such as `{"required": ["item"]}` constrains its object rather than giving it another type.
const typed = schema => typeof schema === 'boolean' || typing.some(key => key in schema)
const grouped = text => (/ [|&] /u.test(text) ? `(${text})` : text)

function constraints(schema) {
  const parts = []
  if (schema.minimum !== undefined) parts.push(`≥ ${schema.minimum}`)
  if (schema.exclusiveMinimum !== undefined) parts.push(`> ${schema.exclusiveMinimum}`)
  if (schema.maximum !== undefined) parts.push(`≤ ${schema.maximum}`)
  if (schema.exclusiveMaximum !== undefined) parts.push(`< ${schema.exclusiveMaximum}`)
  if (schema.minLength !== undefined) parts.push(`length ≥ ${schema.minLength}`)
  if (schema.maxLength !== undefined) parts.push(`length ≤ ${schema.maxLength}`)
  if (schema.pattern !== undefined) parts.push(`/${schema.pattern}/`)
  if (schema.format !== undefined) parts.push(`format ${schema.format}`)
  if (schema.minItems !== undefined) parts.push(`≥ ${schema.minItems} items`)
  if (schema.maxItems !== undefined) parts.push(`≤ ${schema.maxItems} items`)
  if (schema.uniqueItems) parts.push('unique')
  if (schema.minProperties !== undefined) parts.push(`≥ ${schema.minProperties} keys`)
  if (schema.maxProperties !== undefined) parts.push(`≤ ${schema.maxProperties} keys`)
  if (schema.propertyNames?.pattern !== undefined) parts.push(`keys /${schema.propertyNames.pattern}/`)
  return parts.length ? ` (${parts.join(', ')})` : ''
}

/** A schema's type as one line: `$ref`s by their definition's name, objects with fields as `{…}` (their rows list them). */
export function typeText(schema) {
  if (schema === true || schema === undefined) return 'any'
  if (schema === false) return 'never'
  if (schema.$ref) return refName(schema.$ref) + constraints(schema)
  if ('const' in schema) return literal(schema.const)
  if (schema.enum) return schema.enum.map(literal).join(' | ')
  const alternatives = [schema.anyOf, schema.oneOf].find(list => list?.some(typed))
  if (alternatives) return alternatives.map(typeText).join(' | ') + constraints(schema)
  if (schema.allOf) return schema.allOf.map(part => grouped(typeText(part))).join(' & ') + constraints(schema)
  const types = [schema.type ?? (schema.properties ? 'object' : schema.items ? 'array' : 'any')].flat()
  const text = types
    .map(type => {
      if (type === 'array') return `${grouped(typeText(schema.items))}[]`
      if (type !== 'object') return type
      if (schema.properties && Object.keys(schema.properties).length) return '{…}'
      if (schema.additionalProperties && schema.additionalProperties !== true) {
        return `{[key: string]: ${typeText(schema.additionalProperties)}}`
      }
      return 'object'
    })
    .join(' | ')
  return text + constraints(schema)
}

/**
 * The fields an inline schema declares, with their JSON Pointers: its own `properties`, those of its inline
 * alternatives (`anyOf`, `oneOf`, `allOf`) and of its inline array items and map values. A field several alternatives
 * declare is one field whose type is each of theirs.
 */
export function fields(schema, pointer) {
  const found = new Map()
  const add = (name, field, required, at) => {
    const existing = found.get(name)
    if (!existing) return found.set(name, {name, schema: field, required, pointer: at})
    if (typeText(existing.schema) !== typeText(field)) existing.schema = {anyOf: [existing.schema, field]}
    existing.required &&= required
  }
  const visit = (current, at) => {
    if (!current || typeof current !== 'object' || current.$ref) return
    for (const [name, field] of Object.entries(current.properties ?? {})) {
      add(name, field, (current.required ?? []).includes(name), `${at}/properties/${name}`)
    }
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      ;(current[key] ?? []).forEach((part, index) => {
        for (const field of fields(part, `${at}/${key}/${index}`)) add(field.name, field.schema, field.required, field.pointer)
      })
    }
    if (current.items) visit(current.items, `${at}/items`)
    if (current.additionalProperties && typeof current.additionalProperties === 'object') {
      visit(current.additionalProperties, `${at}/additionalProperties`)
    }
  }
  visit(schema, pointer)
  return [...found.values()]
}

/**
 * One document's declarations. `document` is `{id, label, file}`: `id` prefixes every declaration's ID, `label` names
 * the document's row (and so every field's qualified name), `file` is where authors write it.
 */
export function schemaDeclarations({document, schema, text, source}) {
  const lines = pointerLines(text)
  const entities = []
  const relationships = []
  const evidence = pointer => [{kind: 'schema', source, ...(lines.has(pointer) ? {location: {line: lines.get(pointer)}} : {})}]
  const declare = (parent, entity, pointer) => {
    entities.push({...entity, evidence: evidence(pointer)})
    if (parent) relationships.push({id: `contains:${parent}->${entity.id}`, kind: 'contains', from: parent, to: entity.id})
  }
  const nest = (parent, current, pointer, separator) => {
    for (const field of fields(current, pointer)) {
      const id = `${parent}${separator}${field.name}`
      const signature = `${field.name}${field.required ? '' : '?'}: ${typeText(field.schema)}`
      declare(parent, {id, kind: 'field', label: field.name, data: {signature}}, field.pointer)
      nest(id, field.schema, field.pointer, '.')
    }
  }
  const version = schema.$id ? schema.$id.replace(/^.*\/([^/]+)\/(v\d+)\.json$/u, '$1/$2') : undefined
  declare(
    undefined,
    {id: document.id, kind: 'document', label: document.label, data: {signature: `${document.file}${version ? ` (${version})` : ''}`}},
    '',
  )
  for (const [name, definition] of Object.entries(schema.$defs ?? {})) {
    const id = `${document.id}#${name}`
    declare(document.id, {id, kind: 'type', label: name, data: {signature: `type ${name} = ${typeText(definition)}`}}, `/$defs/${name}`)
    nest(id, definition, `/$defs/${name}`, '.')
  }
  nest(document.id, {properties: schema.properties, required: schema.required}, '', ':')
  return {entities, relationships}
}
