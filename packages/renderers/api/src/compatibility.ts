import type {IconName} from '@githubnext/projections-renderer-kit'

/** How a change affects the API's consumers, from the api-compatibility comparator. */
export type CompatibilityLevel = 'breaking' | 'additive' | 'compatible' | 'unknown'

export const compatibilityLevels: readonly CompatibilityLevel[] = ['breaking', 'unknown', 'additive', 'compatible']

/** Each level as an icon (a kit icon name) and a word, never by color alone. */
export const compatibilityLabels: Record<CompatibilityLevel, {icon: IconName; label: string}> = {
  breaking: {icon: 'breaking', label: 'Breaking'},
  unknown: {icon: 'unknown', label: 'Unknown'},
  additive: {icon: 'additive', label: 'Additive'},
  compatible: {icon: 'compatible', label: 'Compatible'},
}

/** One change's classification. */
export interface Classified {
  level: CompatibilityLevel
  /** How a breaking change breaks (`binary`, `source`), where the ecosystem distinguishes it. */
  kinds: string[]
  reason: string
}

/** A comparison's classification (`metadata.compatibility`), keyed by change ID. */
export interface Compatibility {
  rules: string | undefined
  counts: Record<CompatibilityLevel, number>
  changes: ReadonlyMap<string, Classified>
  notices: string[]
}

const isLevel = (value: unknown): value is CompatibilityLevel => compatibilityLevels.includes(value as CompatibilityLevel)
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The comparison's compatibility classification, or `undefined` when its
 * comparator didn't classify it. Malformed entries are ignored: comparator
 * metadata is untrusted.
 */
export function compatibilityOf(metadata: unknown): Compatibility | undefined {
  const value = isRecord(metadata) ? metadata.compatibility : undefined
  if (!isRecord(value) || value.version !== 0 || !isRecord(value.changes)) return undefined
  const changes = new Map<string, Classified>()
  const counts: Record<CompatibilityLevel, number> = {breaking: 0, unknown: 0, additive: 0, compatible: 0}
  for (const [id, entry] of Object.entries(value.changes)) {
    if (!isRecord(entry) || !isLevel(entry.level) || typeof entry.reason !== 'string') continue
    const kinds = Array.isArray(entry.kinds) ? entry.kinds.filter((kind): kind is string => typeof kind === 'string') : []
    changes.set(id, {level: entry.level, kinds, reason: entry.reason})
    counts[entry.level]++
  }
  const notices = Array.isArray(value.notices) ? value.notices.filter((notice): notice is string => typeof notice === 'string') : []
  return {rules: typeof value.rules === 'string' ? value.rules : undefined, counts, changes, notices}
}

/** Compatibility kinds the renderer knows, as human words; any other kind appears exactly as the data has it. */
const compatibilityKindWords: Record<string, string> = {binary: 'binary', source: 'source', behavioral: 'behavioral'}

/** `Binary and source: reason`, or the reason alone. A sentence starts with a capital only when it starts with a human word, never by recasing data. */
export function reasonText(classified: Classified): string {
  if (!classified.kinds.length) return classified.reason
  const phrase = classified.kinds.map(kind => compatibilityKindWords[kind] ?? kind).join(' and ')
  const human = Object.hasOwn(compatibilityKindWords, classified.kinds[0]!)
  return `${human ? `${phrase[0]!.toUpperCase()}${phrase.slice(1)}` : phrase}: ${classified.reason}`
}

/** Breaking changes first, then everything else; each group keeps its order. */
export function breakingFirst<T extends {id: string}>(rows: readonly T[], compatibility: Compatibility | undefined): T[] {
  if (!compatibility) return [...rows]
  const breaking = (row: T) => compatibility.changes.get(row.id)?.level === 'breaking'
  return [...rows.filter(breaking), ...rows.filter(row => !breaking(row))]
}
