import {pageLines} from './page-text.ts'
import {resolved} from './types.ts'
import type {TabFacts, ViewSide} from './types.ts'

/** A revision as the agent reads it: a commit's first 8 characters, else the ref. */
export function shortRevision(ref: string): string {
  return /^[0-9a-f]{40}$/u.test(ref) ? ref.slice(0, 8) : ref
}

/** A part as a definition names it: a built-in's ID, a command, a bundle or a comparator file. */
export function partText(part: unknown): string | undefined {
  if (typeof part === 'string') return `\`${part}\``
  if (typeof part !== 'object' || part === null) return undefined
  const value = part as {command?: unknown; bundle?: unknown; file?: unknown}
  if (Array.isArray(value.command)) return `the repository command \`${value.command.join(' ')}\``
  if (typeof value.bundle === 'string') return `the custom bundle \`${value.bundle}\``
  if (typeof value.file === 'string') return `the comparator file \`${value.file}\``
  return 'the default one, with options'
}

/** A side as the agent reads it: its short commit (or ref) and how the toolbar names it. */
export const sideText = (side: ViewSide) =>
  `${side.commit ? shortRevision(side.commit) : side.ref === 'working-tree' ? 'working-tree' : side.ref}${side.text ? ` (${side.text})` : ''}`

/** The result when no projection tab is open. */
export const noProjectionTab =
  "No projection tab is open, so there is no current view: the person isn't looking at a projection in the editor. " +
  'Ask which projection they mean (list_projections lists them), or open one for them with open_projection.'

/** The definition line: its file, and the parts it names. */
function definitionLines(facts: TabFacts): string[] {
  const parts = facts.parts
  const named = parts
    ? [
        ...(parts.extractor !== undefined ? [`extractor ${partText(parts.extractor)}`] : []),
        ...(parts.renderer !== undefined ? [`renderer ${partText(parts.renderer)}`] : []),
        parts.comparator === undefined ? 'the default comparator' : `comparator ${partText(parts.comparator)}`,
      ]
    : []
  if (!facts.definitionFile && !named.length) return []
  return [
    `Definition: ${facts.definitionFile ? facts.definitionFile : 'a built-in default'}${named.length ? `; ${named.join(', ')}` : ''}.`,
  ]
}

/** What the tab shows: its choice and the revisions it resolved to. */
function showingLines(facts: TabFacts): string[] {
  const choice = `${facts.choice.name}${facts.choice.detail ? ` (${facts.choice.detail})` : ''}${facts.pinned ? ', pinned to this tab' : ''}`
  if (facts.before && facts.after) {
    return [
      `Showing: ${choice}. Before ${sideText(facts.before)} → After ${sideText(facts.after)}.`,
      `Revisions: before ${resolved(facts.before)}, after ${resolved(facts.after)}.`,
    ]
  }
  if (facts.after) return [`Showing: ${choice}. One revision, ${sideText(facts.after)}: nothing is compared.`]
  return [`Showing: ${choice}.`]
}

/** Whether the result is out of date, and which definition it applies. */
function freshnessLines(facts: TabFacts): string[] {
  const lines: string[] = []
  if (facts.stale) {
    lines.push(
      `Out of date: ${facts.stale.why}${facts.stale.files ? ` (${facts.stale.files} file${facts.stale.files === 1 ? '' : 's'} changed since)` : ''}; the person can Refresh it.`,
    )
  } else if (facts.page?.status === 'ok') lines.push('Up to date.')
  if (facts.edits === 'yours') lines.push("Definition: it uses the person's uncommitted edits to the definition.")
  else if (facts.edits === 'committed') {
    lines.push(
      'Definition: the person has uncommitted edits to the definition, but chose Show committed: this result applies the committed one.',
    )
  } else if (facts.definitionRevision === 'HEAD') lines.push('Definition: the committed one.')
  return lines
}

/** `#projections_current_view`'s result: what the tab shows, for a model to read. */
export function currentViewText(facts: TabFacts): string {
  const where = facts.inFront ? 'The projection tab in front' : 'No projection tab is in front; the one shown last'
  const lines = [`${where} is "${facts.title}" (projection ${facts.projection}) in ${facts.folder}.`]
  if (facts.description) lines.push(`What it shows: ${facts.description}`)
  lines.push(...definitionLines(facts), ...showingLines(facts), ...pageLines(facts.page), ...freshnessLines(facts))
  if (!facts.page) lines.push("Its page isn't loaded (the tab is hidden), so its mode, selection and counts aren't known.")
  if (facts.others?.length) lines.push(`Other projection tabs: ${facts.others.join(', ')}.`)
  lines.push(
    'compare, check, open_projection and set_part default to this projection, and compare without before and after compares exactly these revisions.',
  )
  return `${lines.join('\n')}\n`
}
