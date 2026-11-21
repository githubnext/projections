import type {TabDefaults} from './types.ts'
import {shortRevision} from './text.ts'

/** Whether the revisions asked for are the pair the tab shows. */
function samePair(args: Record<string, unknown>, pair: TabDefaults['pair']): boolean {
  const before = typeof args.before === 'string' ? args.before : undefined
  const after = typeof args.after === 'string' ? args.after : 'working-tree'
  return Boolean(
    pair?.before &&
    (before === pair.before || shortRevision(pair.before) === before) &&
    (after === pair.after || shortRevision(pair.after) === after),
  )
}

/**
 * compare's and screenshot's revisions: omitted ones are the tab's pair (only the suggested one when the tab shows one
 * revision or none is open), and given ones are said to be the tab's or not. Fills `args` and returns the note.
 */
export function revisionNote(tool: string, args: Record<string, unknown>, tab: TabDefaults | undefined, named: string): string | undefined {
  const pair = tab?.pair
  const shown = pair?.before ? `${shortRevision(pair.before)} → ${shortRevision(pair.after)}` : undefined
  const choice = tab ? `${tab.choice}${tab.pinned ? ', pinned to the tab' : ''}` : ''
  const given = typeof args.before === 'string' || typeof args.after === 'string'
  if (!given && pair?.before) {
    args.before = pair.before
    args.after = pair.after
    return `Revisions: ${shown}, the ones ${named} shows (${choice}). This is the comparison on the person's screen.`
  }
  if (!given && tab && tool === 'screenshot' && pair) {
    args.after = pair.after
    return `Revision: ${shortRevision(pair.after)}, the one ${named} shows (${choice}).`
  }
  if (!given && tab) {
    return `${named[0]!.toUpperCase()}${named.slice(1)} shows one revision (${choice}: ${pair ? shortRevision(pair.after) : 'none yet'}) and compares nothing, so these are the revisions Projections suggests: not what is on the person's screen.`
  }
  if (!given) return 'Revisions: the ones Projections suggests (no projection tab is open).'
  if (!tab) return undefined
  return samePair(args, pair)
    ? `Revisions: ${shown}, the ones ${named} shows.`
    : `Revisions: as asked. Not the comparison ${named} shows${shown ? ` (${choice}: ${shown})` : ''}: don't present it as the one on screen.`
}
