import {revisionNote} from './revision-notes.ts'
import {presentAsShown} from './tab-defaults.ts'
import type {TabDefaults} from './types.ts'
import {partText} from './text.ts'

/** The tools that take an omitted projection from the tab. */
export const projectionDefaulted = new Set(['compare', 'check', 'open_projection', 'set_part', 'screenshot'])

/** The tab's projection, for a tool that omitted it; returns the note. */
function projectionNote(tool: string, args: Record<string, unknown>, tab: TabDefaults, named: string): string | undefined {
  if (!projectionDefaulted.has(tool)) return undefined
  if (tool === 'check' && !Array.isArray(args.projections)) {
    args.projections = [tab.projection]
    return `Checked the projection ${named} shows (${tab.projection}); name projections to check others.`
  }
  if (tool !== 'check' && typeof args.projection !== 'string') {
    args.projection = tab.projection
    return `Projection: ${tab.projection}, the one ${named} shows.`
  }
  return undefined
}

/** describe_part without an ID: which part the tab's projection uses. */
function partNote(args: Record<string, unknown>, tab: TabDefaults & {parts: NonNullable<TabDefaults['parts']>}, named: string): string {
  const part = args.part as 'extractor' | 'comparator' | 'renderer'
  const value = tab.parts[part]
  return `The projection ${named} shows (${tab.projection}) uses ${value === undefined ? `the default ${part}` : `the ${part} ${partText(value)}`}; pass its ID to describe it.`
}

/**
 * compare of the tab's pair applies the definition the tab applies (to another projection, the working tree's), so it
 * is the comparison on the person's screen, unless the input chooses one.
 */
function definitionAsShown(args: Record<string, unknown>, tab: TabDefaults | undefined): void {
  if (args.definition !== undefined || args.definitionRevision !== undefined) return
  args.definitionRevision = (args.projection === tab?.projection ? (tab?.definitionRevision ?? '') : '') || 'working-tree'
}

/**
 * A tool's input with what it omitted taken from the tab, and a note saying where its projection and revisions came
 * from: compare without revisions compares the tab's pair (only the suggested one when the tab shows one revision or
 * none is open), and says so; given revisions are said to be the tab's or not. Throws when a projection is needed and
 * neither given nor shown.
 */
export function withTabDefaults(
  tool: string,
  input: Record<string, unknown>,
  tab: TabDefaults | undefined,
): {input: Record<string, unknown>; note?: string} {
  const notes: (string | undefined)[] = []
  const args = {...input}
  const named = tab ? `the "${tab.title}" tab` : 'the tab'
  if (tab) notes.push(projectionNote(tool, args, tab, named))
  if (!tab && (tool === 'compare' || tool === 'set_part' || tool === 'screenshot') && typeof args.projection !== 'string') {
    throw new Error('Name a projection: no projection tab is open to take it from (list_projections lists them)')
  }
  if (tool === 'compare' || tool === 'screenshot') {
    const given = typeof args.before === 'string' || typeof args.after === 'string'
    notes.push(revisionNote(tool, args, tab, named))
    if (tool === 'compare' && !given && typeof args.before === 'string') definitionAsShown(args, tab)
  }
  if (tool === 'screenshot' && tab?.view && args.projection === tab.projection) presentAsShown(args, tab.view)
  if (tool === 'describe_part' && tab?.parts && typeof args.id !== 'string' && typeof args.part === 'string') {
    notes.push(partNote(args, {...tab, parts: tab.parts}, named))
  }
  const said = notes.filter(note => note !== undefined)
  return {input: args, ...(said.length ? {note: said.join(' ')} : {})}
}
