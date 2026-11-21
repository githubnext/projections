import Type, {type Static, type TProperties, type TSchema} from 'typebox'

/**
 * Where a shared schema is defined: a published document, and the name of its `$defs` entry (absent for the
 * document's root). The generator emits every other use as a `$ref` to it. The marker is non-enumerable, so
 * it never appears in a schema's JSON, and TypeBox copies it with the schema (as `Type.Optional` does).
 */
export interface Home {
  document: string
  name?: string
}

const marker = '~projections'
const registry = new Map<string, TSchema>()
const key = (home: Home) => `${home.document}#${home.name ?? ''}`

export function define<T extends TSchema>(document: string, name: string | undefined, schema: T): T {
  const home: Home = name === undefined ? {document} : {document, name}
  if (registry.has(key(home))) throw new Error(`${key(home)} is defined twice`)
  if (homeOf(schema)) throw new Error(`${key(home)} is already defined as ${key(homeOf(schema)!)}`)
  registry.set(key(home), schema)
  Object.defineProperty(schema, marker, {value: home, enumerable: false})
  return schema
}

/** Where `schema` was defined with `define`, from its hidden marker; `undefined` for an inline schema or non-object. */
export function homeOf(schema: unknown): Home | undefined {
  return typeof schema === 'object' && schema !== null ? (schema as {[marker]?: Home})[marker] : undefined
}

/** The schema defined at `home`. */
export function definitionAt(home: Home): TSchema | undefined {
  return registry.get(key(home))
}

/** Every named definition in `document`, in definition order. */
export function definitionsOf(document: string): [string, TSchema][] {
  return [...registry].flatMap(([, schema]) => {
    const home = homeOf(schema)!
    return home.document === document && home.name !== undefined ? [[home.name, schema] as [string, TSchema]] : []
  })
}

/** `schema` with `options` (such as a use-specific description), still emitted as a `$ref` to its home. */
export function annotated<T extends TSchema>(schema: T, options: {description?: string}): T {
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(schema)) as T
  return Object.assign(copy, options)
}

/** An object that rejects unknown properties. */
export function Closed<P extends TProperties>(properties: P, options: object = {}) {
  return Type.Object(properties, {additionalProperties: false, ...options})
}

/** An object whose every property is `value`, as `additionalProperties` rather than a pattern. */
export function Dictionary<T extends TSchema>(value: T, options: object = {}) {
  return Type.Unsafe<Record<string, Static<T>>>({type: 'object', ...options, additionalProperties: value})
}

/** A string that isn't empty or only whitespace, as the engine requires. */
export function NonBlank(options: object = {}) {
  return Type.String({minLength: 1, pattern: '\\S', ...options})
}
