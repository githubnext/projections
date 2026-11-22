// The SDK's icon vocabulary for the icon stories: every badge and every other icon, grouped by meaning as the SDK
// describes them (icons.ts), each with the word it accompanies and the change color renderers draw it in.
import {badgeIconNames, iconNames, type IconName} from '@githubnext/projections-renderer-sdk/protocol'
import type {ChangeClassification} from '@githubnext/projections-renderer-kit'

export interface IconEntry {
  name: IconName
  /** The word beside it. */
  label: string
  /** The change color it is drawn in; `unchanged` is the text color. */
  status: ChangeClassification
  /** What a summary bar fact counts beside it; by default its word. */
  noun?: {singular: string; plural: string}
}

export interface IconGroup {
  title: string
  icons: IconEntry[]
}

/** The SDK's categories of badges (`badgeIconNames`). */
const badgeCategories: readonly (readonly [string, readonly string[]])[] = [
  ['Change kinds', ['added', 'removed', 'modified', 'renamed', 'moved']],
  ['Versions', ['upgraded', 'downgraded', 'changed']],
  ['Planned actions', ['replace', 'redeploy', 'import', 'read', 'blocked']],
  ['Severity', ['breaking']],
]

/** The SDK's categories of the other icons, outline glyphs. */
const outlineCategories: readonly (readonly [string, readonly string[]])[] = [
  ['Severity', ['warning', 'error', 'info', 'unknown']],
  ['Compatibility', ['additive', 'compatible']],
  [
    'Policy and coverage',
    ['enforced', 'unenforced', 'include', 'exclude', 'visible', 'hidden', 'expand', 'collapse', 'rescoped', 'settings', 'agent'],
  ],
  ['Volatile and generated data', ['varied', 'generated']],
  [
    'Subjects',
    ['host', 'policy', 'workload', 'credential', 'process', 'file', 'network', 'module', 'bytecode', 'namespace', 'application', 'other'],
  ],
  ['Projection parts', ['extractor', 'comparator', 'renderer']],
]

/**
 * The change color each badge is drawn in by the renderers that use it: a change kind's own, a version change and
 * most planned actions modified, an import added, a forgotten resource removed. `breaking` is in the text color: change
 * colors stay reserved for change status. A badge not listed here is drawn modified. The kit draws `replace` gray
 * beside any status word, whatever its status.
 */
const badgeStatuses: Partial<Record<IconName, ChangeClassification>> = {
  added: 'added',
  removed: 'removed',
  modified: 'modified',
  renamed: 'renamed',
  moved: 'renamed',
  import: 'added',
  blocked: 'removed',
  breaking: 'unchanged',
}

const word = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1)}`

/**
 * `names` in the categories that list them, in the SDK's order, and any the categories don't list (an icon the SDK
 * added since) in a last group, so every icon the SDK defines is shown.
 */
function grouped(
  names: readonly IconName[],
  categories: readonly (readonly [string, readonly string[]])[],
  rest: string,
  status: (name: IconName) => ChangeClassification,
): IconGroup[] {
  const entry = (name: IconName): IconEntry => ({name, label: word(name), status: status(name)})
  const listed = new Set(categories.flatMap(([, members]) => members))
  const groups = categories
    .map(([title, members]) => ({title, icons: names.filter(name => members.includes(name)).map(entry)}))
    .filter(group => group.icons.length > 0)
  const unlisted = names.filter(name => !listed.has(name))
  return unlisted.length ? [...groups, {title: rest, icons: unlisted.map(entry)}] : groups
}

/** Every badge, a disc with its glyph cut out, by meaning. */
export const badgeGroups: IconGroup[] = grouped(badgeIconNames, badgeCategories, 'Other badges', name => badgeStatuses[name] ?? 'modified')

/** Every other icon, an outline glyph in the text color, by meaning. */
export const outlineGroups: IconGroup[] = grouped(
  iconNames.filter(name => !badgeIconNames.includes(name)),
  outlineCategories,
  'Other icons',
  () => 'unchanged',
)
