// A renderer's manifest and the extractions it accepts.
import {domainSchemas, vocabularyNames} from '@githubnext/projections-schemas'
import type {DomainSchema, ExtractionOf, Vocabulary} from '@githubnext/projections-schemas'
import {parseComparisonModes} from './comparison-modes.js'
import type {ComparisonMode} from './comparison-modes.js'
import {record, keys} from './validation.js'

/** Manifest each renderer bundle ships as `renderer.json` beside its `index.html`. */
export interface RendererManifest {
  /** Identifies the file as a renderer manifest. */
  format: 'projections.renderer'
  /** The manifest format version; hosts reject any other. */
  version: 0
  /** Bundle directory name, for example `basic`. */
  name: string
  /** The renderer's human-readable name, which hosts show in their messages and menus; 1 to 200 characters. */
  title: string
  /** Definition renderer names this bundle presents, for example `["graph", "dag"]`. */
  handles: string[]
  /** Comparison modes the bundle supports (see `RendererCapabilities.comparisonModes`); absent means `defaultComparisonModes`. */
  comparisonModes?: ComparisonMode[]
  /** The extractions the bundle presents; absent means any. See `RendererAccepts`. */
  accepts?: RendererAccepts[]
}

/**
 * An extraction a renderer presents: one in domain schema `schema` and, with `vocabulary`, declaring that
 * vocabulary. Without `vocabulary`, any extraction in the schema matches, whatever vocabularies it declares.
 */
export interface RendererAccepts {
  /** The domain schema the extraction is in, for example `architecture/v0`. */
  schema: DomainSchema
  /** A vocabulary the extraction must declare, for example `dependency-injection/v0`. */
  vocabulary?: Vocabulary
}

/** The typed extraction a renderer that accepts `A` receives: the union of what each entry guarantees. */
export type AcceptedExtraction<A extends readonly RendererAccepts[]> = {
  [I in keyof A]: A[I] extends {schema: infer S extends DomainSchema; vocabulary: infer V extends Vocabulary}
    ? ExtractionOf<S, V>
    : A[I] extends {schema: infer S extends DomainSchema}
      ? ExtractionOf<S>
      : never
}[number]

/** Whether a renderer that accepts `accepts` presents `extraction`. Every renderer without `accepts` does. */
export function acceptsExtraction(
  accepts: readonly RendererAccepts[] | undefined,
  extraction: {schema: string; vocabularies?: readonly string[] | undefined},
): boolean {
  if (!accepts) return true
  return accepts.some(
    item =>
      item.schema === extraction.schema && (item.vocabulary === undefined || (extraction.vocabularies ?? []).includes(item.vocabulary)),
  )
}

/** `accepts` in words: `` `database/v0` `` or `` `architecture/v0` with `dependency-injection/v0` ``. */
export function describeAccepts(accepts: readonly RendererAccepts[]): string {
  const items = accepts.map(item => `\`${item.schema}\`${item.vocabulary ? ` with \`${item.vocabulary}\`` : ''}`)
  return items.length <= 1 ? (items[0] ?? 'nothing') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`
}

/** Distinct, known `accepts` entries, or undefined. */
export function parseAccepts(value: unknown): RendererAccepts[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 32) return undefined
  const seen = new Set<string>()
  const result: RendererAccepts[] = []
  for (const item of value) {
    if (!record(item) || !keys(item, ['schema', 'vocabulary'])) return undefined
    if (!domainSchemas.includes(item.schema as DomainSchema)) return undefined
    if (item.vocabulary !== undefined && !vocabularyNames.includes(item.vocabulary as Vocabulary)) return undefined
    const key = `${item.schema as string} ${(item.vocabulary as string | undefined) ?? ''}`
    if (seen.has(key)) return undefined
    seen.add(key)
    result.push({
      schema: item.schema as DomainSchema,
      ...(item.vocabulary === undefined ? {} : {vocabulary: item.vocabulary as Vocabulary}),
    })
  }
  return result
}

/**
 * Validates a parsed `renderer.json` strictly and returns a normalized copy without unknown or absent fields.
 *
 * @throws `Error` naming the first problem: another format or version, an unknown field, a `name` that isn't a
 * lowercase identifier, a `title` outside 1-200 characters, `handles` that aren't at most 100 renderer names, or
 * `comparisonModes` or `accepts` that aren't distinct known entries.
 */
export function parseRendererManifest(value: unknown): RendererManifest {
  if (!record(value) || value.format !== 'projections.renderer' || value.version !== 0) throw new Error('Unsupported renderer manifest')
  if (!keys(value, ['format', 'version', 'name', 'title', 'handles', 'comparisonModes', 'accepts'])) {
    throw new Error('Renderer manifest has unknown fields')
  }
  const name = value.name
  const title = value.title
  const handles = value.handles
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
    throw new Error('Renderer manifest name must be a lowercase identifier')
  }
  // Characters (code points), as the manifest schema's maxLength counts them.
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- Spreading a string yields its code points, which this counts.
  if (typeof title !== 'string' || !title.trim() || [...title].length > 200) {
    throw new Error('Renderer manifest title must be 1-200 characters')
  }
  if (!rendererNames(handles)) throw new Error('Renderer manifest handles must be renderer names')
  const modes = value.comparisonModes === undefined ? undefined : parseComparisonModes(value.comparisonModes)
  if (value.comparisonModes !== undefined && !modes) throw new Error('Renderer manifest comparisonModes must be distinct comparison modes')
  const accepts = value.accepts === undefined ? undefined : parseAccepts(value.accepts)
  if (value.accepts !== undefined && !accepts) {
    throw new Error('Renderer manifest accepts must be distinct domain schemas, each with an optional vocabulary')
  }
  return {
    format: 'projections.renderer',
    version: 0,
    name,
    title,
    handles: [...handles],
    ...(modes ? {comparisonModes: modes} : {}),
    ...(accepts ? {accepts} : {}),
  }
}

/** At most 100 renderer names: what a manifest's `handles` lists. */
function rendererNames(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.length <= 100 && value.every(item => typeof item === 'string' && /^[a-z0-9][a-z0-9/.-]{0,63}$/.test(item))
  )
}
