// Runtime values shared by the type-only public entry and the TypeBox schemas. No TypeBox import here, so
// importing them doesn't put the schema builder into renderer bundles.

/**
 * The protocol version every extraction, comparison and comparator input carries (`protocolVersion`); documents of
 * any other version are rejected, never upgraded.
 */
export const protocolVersion = 0 as const
/** Every domain schema an extraction can declare as its `schema`, in documentation order. */
export const domainSchemas = ['graph/v0', 'dag/v0', 'treemap/v0', 'metrics/v0', 'api/v0', 'database/v0', 'architecture/v0'] as const
/** A domain schema name, such as `graph/v0`: what an extraction's items mean and which rules apply to them. */
export type DomainSchema = (typeof domainSchemas)[number]
/**
 * Vocabularies: typed conventions over a domain schema that an extraction opts into with `vocabularies`,
 * such as dependency injection over `architecture/v0`. The engine checks their rules like a schema's.
 */
export const vocabularyNames = ['dependency-injection/v0', 'infrastructure/v0', 'runtime-policy/v0'] as const
/** A vocabulary name, such as `dependency-injection/v0`, from `vocabularyNames`. */
export type Vocabulary = (typeof vocabularyNames)[number]
/**
 * A JSON value as the protocol carries it, such as `data` values and `parseJson` results. The engine rejects
 * nonfinite numbers and integers outside the safe range rather than rounding them.
 */
export type Json = null | boolean | number | string | Json[] | {[key: string]: Json}

/**
 * Colors a definition may give a kind (`presentation.kinds.<kind>.color`): a meaning (`danger`, `warning`, `success`,
 * `info`, `neutral`) or one of the theme's sixteen categorical hues, in palette order. Renderers paint them with theme
 * tokens, never a fixed value, so they follow every host's theme.
 */
export const kindTones = ['danger', 'warning', 'success', 'info', 'neutral'] as const
/** The theme's sixteen categorical hues a kind may take, in palette order. */
export const kindHues = [
  'blue',
  'teal',
  'pink',
  'lime',
  'purple',
  'cyan',
  'indigo',
  'sky',
  'orange',
  'green',
  'red',
  'violet',
  'emerald',
  'rose',
  'amber',
  'citron',
] as const
/** Every color a kind may take: the meanings in `kindTones`, then the hues in `kindHues`. */
export const kindColors = [...kindTones, ...kindHues] as const
/** A color a definition may give a kind: a meaning such as `danger` or a categorical hue such as `teal`. */
export type KindColor = (typeof kindColors)[number]

/**
 * Where the published JSON Schemas live: `<base><name>/v<major>.json`, a schema's `$id`. Each release also
 * publishes an immutable snapshot at `<base><name>/v<major>/<release>.json` (see docs/contracts.md).
 */
export const schemaBaseUrl = 'https://schemas.projections.githubnext.com/'

/** The URL, and `$id`, of a published JSON Schema, such as `schemaUrl('extraction')` or `schemaUrl('database')`. */
export function schemaUrl(name: string, version = 0): string {
  return `${schemaBaseUrl}${name}/v${version}.json`
}
