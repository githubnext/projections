// What the Changes scope leaves out, in words every host's UI shows.
import type {ScopeHidden} from './projection/filtering.js'

/**
 * What the Changes scope leaves out, as one phrase: `Hiding 45 unchanged tables, 380 columns and 12 indexes`. Undefined
 * when it hides nothing.
 */
export function scopeHiddenText(hidden: readonly ScopeHidden[]): string | undefined {
  if (!hidden.length) return undefined
  const parts = hidden.map(item => `${item.count.toLocaleString('en-US')} ${item.count === 1 ? item.noun.singular : item.noun.plural}`)
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)!}` : parts[0]!
  return `Hiding ${list.replace(/^(\S+) /, '$1 unchanged ')}`
}

/** Why the scope switch has nothing to switch: every item is a change or gives one context. */
export const nothingHiddenTitle = 'Nothing hidden: every item is a change or gives one context'
