import type {PageView, ViewContext, ViewFigure} from './types.ts'

/** The comparison modes' names, in the order the host offers them: Diff, Side by side, Animated, then Swipe. */
export const modeNames: {[mode: string]: string} = {
  diff: 'Diff',
  'side-by-side': 'Side by side',
  animated: 'Animated',
  swipe: 'Swipe',
}

const plural = (count: number, noun: {singular: string; plural: string}) => `${count} ${count === 1 ? noun.singular : noun.plural}`

/** `12 jobs (+5 −1 ~2)`: a figure and its changes. */
export function figureText(figure: ViewFigure): string {
  const deltas = [
    ...(figure.added ? [`+${figure.added}`] : []),
    ...(figure.removed ? [`−${figure.removed}`] : []),
    ...(figure.modified ? [`~${figure.modified}`] : []),
  ]
  return `${plural(figure.count, figure.noun)}${deltas.length ? ` (${deltas.join(' ')})` : ''}`
}

/** The mode line: the mode shown, the ones offered (in the host's order) and how it is shown. */
function modeLine(page: PageView): string {
  const mode = page.mode ? (modeNames[page.mode] ?? page.mode) : undefined
  // In the order the host offers them: Diff, Side by side, Animated, then Swipe.
  const order = Object.keys(modeNames)
  const rank = (item: string) => (order.includes(item) ? order.indexOf(item) : order.length)
  const offered = [...(page.modes ?? [])].sort((a, b) => rank(a) - rank(b)).map(item => modeNames[item] ?? item)
  const shownAs = page.showAs && page.showAs !== 'renderer' ? `, as a ${page.showAs}` : ''
  return `Mode: ${mode ?? 'one revision'}${offered.length > 1 ? ` (of ${offered.join(', ')})` : ''}${shownAs}${page.changesOnly ? ', changes only' : ''}.`
}

/** The status line of a page that isn't simply `ok`. */
function statusLine(page: PageView & {status: string}): string {
  if (page.status === 'extracting') return 'Status: extracting; what follows may be the pair shown before.'
  if (page.status === 'trust') return "Status: needs trust: its extractor is repository code and the workspace isn't trusted."
  if (page.status === 'failed') return `Status: failed${page.error ? `: ${page.error}` : ''}.`
  return `Status: ${page.status}.`
}

/** The summary of what a comparison changed: its counts by status and its changed items. */
function changeLines(page: PageView): string[] {
  const lines: string[] = []
  if (page.changes && page.compared) {
    const counts = Object.entries(page.changes)
      .filter(([status, count]) => status !== 'unchanged' && count > 0)
      .map(([status, count]) => `${count} ${status}`)
    lines.push(`Changes: ${counts.length ? counts.join(', ') : 'none'} of ${page.rows ?? 0} items.`)
  }
  // Identity changes (a rename, split or merge) are `unchanged`, but changes.
  const changed = (page.items ?? []).filter(item => (item.status && item.status !== 'unchanged') || item.correspondence || item.context)
  if (changed.length) {
    lines.push('Changed items (status, kind, label [ID]), each with its context: the items the Changes scope shows to read it:')
    for (const item of changed) {
      lines.push(`- ${item.status}${item.correspondence ? ` (${item.correspondence})` : ''} ${item.kind} ${item.label} [${item.id}]`)
      if (item.context) lines.push(`  ${contextText(item.context)}`)
    }
  }
  return lines
}

/** `context: module tools [m], … and 2 more (added by rule callers)`: a change's context. */
export function contextText(context: ViewContext): string {
  const items = context.items.map(item => `${item.kind} ${item.label} [${item.id}]`).join(', ')
  const more = context.total > context.items.length ? ` and ${context.total - context.items.length} more` : ''
  const rules = context.rules?.length
    ? ` (added by ${context.rules.length === 1 ? 'rule' : 'rules'} ${context.rules.map(rule => `\`${rule}\``).join(', ')})`
    : ''
  const derived = context.derived ? ' (derived: the comparison was saved without context)' : ''
  return `context: ${items}${more}${rules}${derived}`
}

/** What the page says of generated values: those regenerated, and the selection's. */
function generatedLines(page: PageView): string[] {
  const lines: string[] = []
  if (page.variation?.regenerated)
    lines.push(
      `Regenerated: ${page.variation.regenerated} item${page.variation.regenerated === 1 ? "'s generated values were" : "s' generated values were"} regenerated from the same inputs (within tolerance, so not a change).`,
    )
  if (page.generated?.length)
    lines.push(
      `The selection's generated values (written by the extractor's generator, such as a language model; not extracted facts): ${page.generated
        .map(field => `${field.name} (${field.form === 'plain' ? 'unchanged' : (field.words ?? field.form).toLowerCase()})`)
        .join(', ')}.`,
    )
  return lines
}

/** What the tab's page presents: its mode, status, notices, summary, changes, generated values and selection. */
export function pageLines(page: PageView | undefined): string[] {
  if (!page) return []
  const lines: string[] = []
  if (page.mode || page.showAs) lines.push(modeLine(page))
  if (page.status && page.status !== 'ok') lines.push(statusLine({...page, status: page.status}))
  for (const notice of page.notices ?? []) lines.push(`Notice: ${notice}`)
  if (page.figures?.length) lines.push(`Summary bar: ${page.figures.map(figureText).join(' · ')}.`)
  lines.push(...changeLines(page), ...generatedLines(page))
  if (page.selection)
    lines.push(
      `Selected: ${page.selection.kind} ${page.selection.label} [${page.selection.id}]${page.selection.status ? `, ${page.selection.status}` : ''}.`,
    )
  else lines.push('Selected: nothing.')
  return lines
}
