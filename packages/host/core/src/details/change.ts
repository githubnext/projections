import type {Row, ViewSubject} from '../model.js'

/** A change's hue: the renderer tokens' `color-<hue>-muted` fill and `color-<hue>-border` edge. */
export type ChangeHue = 'added' | 'removed' | 'modified' | 'moved'

/** One hue-and-word part of a row's change, as the renderer kit's `statusParts`: two for a renamed and changed item. */
export interface ChangePart {
  hue: ChangeHue
  label: string
}

const identityWords = {declared: 'Renamed', split: 'Split', merge: 'Merged'} as const

/** A row's change as hue-and-word parts: none for an unchanged item (or one extraction). */
export function changeParts(row: Pick<Row, 'status' | 'correspondence'>): ChangePart[] {
  const parts: ChangePart[] = []
  const identity =
    row.correspondence && row.correspondence in identityWords ? identityWords[row.correspondence as keyof typeof identityWords] : undefined
  if (identity) parts.push({hue: 'moved', label: identity})
  if (row.status === 'added') parts.push({hue: 'added', label: 'Added'})
  else if (row.status === 'removed') parts.push({hue: 'removed', label: 'Removed'})
  else if (row.status === 'modified') parts.push({hue: 'modified', label: 'Modified'})
  return parts
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const compatibilityWords: Record<string, string> = {
  breaking: 'Breaking',
  additive: 'Additive',
  compatible: 'Compatible',
  unknown: 'Compatibility unknown',
}
/** `scope-broadened` as "Scope broadened". */
const humanize = (name: string) => {
  const words = name.replaceAll(/[-_]+/gu, ' ').trim()
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : ''
}

/**
 * The comparator's classification of a change, as words, from the comparison's metadata conventions:
 * `metadata.compatibility.changes[id].level` (the api-compatibility comparator: "Breaking", "Additive", …) and
 * `metadata.runtimePolicy.interpretations[id]` (the runtime-policy comparator: "Scope broadened", …) and
 * `metadata.agenticWorkflows.interpretations[id]` (the agentic-workflows comparator's `{name}` findings: "Network
 * widened", …). Comparator metadata is untrusted: anything malformed is ignored.
 */
export function changeTags(subject: ViewSubject, rowId: string): string[] {
  if (subject.mode !== 'comparison') return []
  const metadata = subject.comparison.metadata
  if (!isRecord(metadata)) return []
  const tags: string[] = []
  const compatibility = metadata.compatibility
  if (isRecord(compatibility) && isRecord(compatibility.changes)) {
    const entry = Object.hasOwn(compatibility.changes, rowId) ? compatibility.changes[rowId] : undefined
    const level = isRecord(entry) && typeof entry.level === 'string' ? entry.level : undefined
    if (level && Object.hasOwn(compatibilityWords, level)) tags.push(compatibilityWords[level]!)
  }
  const runtime = metadata.runtimePolicy
  const interpretations = isRecord(runtime) && isRecord(runtime.interpretations) ? runtime.interpretations : undefined
  const names = interpretations && Object.hasOwn(interpretations, rowId) ? interpretations[rowId] : undefined
  if (Array.isArray(names)) for (const name of names) if (typeof name === 'string' && humanize(name)) tags.push(humanize(name))
  const agentic = metadata.agenticWorkflows
  const findings = isRecord(agentic) && isRecord(agentic.interpretations) ? agentic.interpretations : undefined
  const found = findings && Object.hasOwn(findings, rowId) ? findings[rowId] : undefined
  if (Array.isArray(found)) {
    for (const finding of found) {
      if (isRecord(finding) && typeof finding.name === 'string' && humanize(finding.name)) tags.push(humanize(finding.name))
    }
  }
  return [...new Set(tags)]
}
