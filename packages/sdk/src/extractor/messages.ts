// How the extractor helpers name values in their messages: in JSON's terms, as the Python module's do, so both say
// the same (packages/schemas/fixtures/extractor-helpers.json).

/** `value` as JSON, for messages. */
export const quoted = (value: unknown) => (JSON.stringify(value) as string | undefined) ?? String(value)

/** Whether `value` is a JSON object: not null, not an array. */
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** `noun` with its indefinite article. */
export const article = (noun: string) => `${/^[aeiou]/iu.test(noun) ? 'an' : 'a'} ${noun}`

/** What `value` is, in JSON's terms: `null`, `a string`, `an array`, `an object`, … */
export function described(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (Array.isArray(value)) return 'an array'
  if (typeof value !== 'object') return article(typeof value)
  // An object made with Object.create(null) has no constructor.
  const made = (value as {constructor?: {name: string}}).constructor
  return made === Object || !made ? 'an object' : article(made.name)
}
