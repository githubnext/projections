// Keyboard behaviour every host UI shares: the Space shortcut for playback and roving choice among radios or tabs.
// DOM-typed and framework-free: a React, Vue or plain DOM keydown event works as it is.
import type {ProjectionController} from './projection/types.js'

/**
 * Elements whose own keyboard behaviour uses Space, or that hold text: the playback shortcut leaves Space to them.
 * A UI adds its design system's custom elements with `keeps` (the VS Code UI adds VSCode Elements').
 */
export const spaceKeeping: readonly string[] = [
  'input:not([type="range"])',
  'textarea',
  'select',
  'button',
  'a[href]',
  'summary',
  'iframe',
  '[contenteditable]:not([contenteditable="false"])',
  ...[
    'button',
    'checkbox',
    'radio',
    'switch',
    'tab',
    'menu',
    'menuitem',
    'menuitemradio',
    'menuitemcheckbox',
    'listbox',
    'option',
    'combobox',
    'textbox',
    'searchbox',
    'treeitem',
    'gridcell',
    'link',
    'dialog',
  ].map(role => `[role="${role}"]`),
]

/** What the shortcuts read of a keydown event: a DOM `KeyboardEvent` or a framework's wrapper of one. */
export interface KeyEventLike {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  defaultPrevented: boolean
  /** The focused element. */
  target: EventTarget | null
  /** The element listening: a toolbar, or the stage's chrome. */
  currentTarget: EventTarget | null
}

const isNode = (value: EventTarget | null): value is Node => typeof Node !== 'undefined' && value instanceof Node

/**
 * Whether a keydown is the playback shortcut: Space without modifiers, not yet handled, from the listening element or
 * an element in it that doesn't use Space itself (`spaceKeeping`, and `keeps`). An element that uses Space but
 * encloses the listener (say, a dialog the page puts the view in) doesn't count; a key from outside the listener (an
 * overlay portaled elsewhere) is never the shortcut.
 */
export function isPlaybackShortcut(event: KeyEventLike, keeps: readonly string[] = []): boolean {
  if (event.key !== ' ' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
  const {target, currentTarget} = event
  if (!isNode(target) || !isNode(currentTarget) || !currentTarget.contains(target)) return false
  const element = target instanceof Element ? target : target.parentElement
  const keeper = element?.closest([...spaceKeeping, ...keeps].join(', '))
  return !keeper || keeper.contains(currentTarget)
}

/**
 * Handles the playback shortcut (`isPlaybackShortcut`) in a keydown: prevents its default, then plays or pauses
 * (`togglePlayback`), once per press, so a held Space doesn't flicker. Returns whether the key was the shortcut.
 */
export function handlePlaybackShortcut(
  event: KeyEventLike & {repeat: boolean; preventDefault: () => void},
  projection: Pick<ProjectionController, 'togglePlayback'>,
  keeps?: readonly string[],
): boolean {
  if (!isPlaybackShortcut(event, keeps)) return false
  event.preventDefault()
  if (!event.repeat) projection.togglePlayback()
  return true
}

/**
 * Where an arrow, Home or End key moves the choice in a radio group or a tab list of `count` items, from `index`,
 * wrapping at either end: Right and Down step forward, Left and Up back (`orientation` keeps to one axis), Home and End
 * go to the first and last. Undefined for any other key, or when there is nothing to choose.
 */
export function rovingIndex(
  key: string,
  index: number,
  count: number,
  orientation: 'horizontal' | 'vertical' | 'both' = 'both',
): number | undefined {
  if (count < 1) return undefined
  const forward = (orientation !== 'vertical' && key === 'ArrowRight') || (orientation !== 'horizontal' && key === 'ArrowDown')
  const back = (orientation !== 'vertical' && key === 'ArrowLeft') || (orientation !== 'horizontal' && key === 'ArrowUp')
  if (forward) return (index + 1 + count) % count
  if (back) return (index - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return undefined
}
