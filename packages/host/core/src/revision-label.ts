// How hosts name a revision in one line: `main · "Add auth" · 2 days ago`. Pair pickers, pane labels and chips read
// these parts back, so the format and its parsing live here, once.

/** A revision label's parts: its name (an identifier: a branch, tag, commit or `HEAD~1`), its detail, and its age. */
export interface RevisionLabelParts {
  name: string
  /** The commit's subject in quotes (`"Add auth"`), or the short commit beside a named ref. */
  detail?: string | undefined
  /** How long ago it was (`revisionAge`): `2 days ago`, `just now`. */
  when?: string | undefined
}

const separator = ' · '
const agePattern = /\bago$|^just now$/

/** A revision label from its parts: `main · "Add auth" · 2 days ago`, leaving out the parts it lacks. */
export const formatRevisionLabel = ({name, detail, when}: RevisionLabelParts): string =>
  [name, detail, when].filter(Boolean).join(separator)

/**
 * A revision label's parts (`formatRevisionLabel` reversed). Any text works: without separators it is all `name`; the
 * last part is `when` only if it reads as an age.
 */
export function parseRevisionLabel(label: string): RevisionLabelParts & {subject?: string | undefined} {
  const parts = label.split(separator)
  const name = parts.shift()?.trim() || label
  const when = parts.length && agePattern.test(parts.at(-1)!) ? parts.pop() : undefined
  const detail = parts.length ? parts.join(separator) : undefined
  const subject = detail && /^".*"$/.test(detail) ? detail.slice(1, -1) : undefined
  return {name, ...(detail ? {detail} : {}), ...(subject ? {subject} : {}), ...(when ? {when} : {})}
}

/** A revision label's name alone (`main`), for compact pickers and chips. */
export const revisionLabelName = (label: string): string => parseRevisionLabel(label).name

/** How long ago an ISO date was, coarsely: `just now`, `5 minutes ago`, `2 days ago`; undefined for no date. */
export function revisionAge(date: string | undefined, now = Date.now()): string | undefined {
  const time = date ? Date.parse(date) : NaN
  if (!Number.isFinite(time)) return undefined
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  const units: [string, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ]
  for (const [unit, size] of units) {
    const count = Math.floor(seconds / size)
    if (count >= 1) return `${count} ${unit}${count === 1 ? '' : 's'} ago`
  }
  return 'just now'
}
