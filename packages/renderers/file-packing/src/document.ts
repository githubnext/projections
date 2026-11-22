import type {Entity} from '@githubnext/projections-schemas'
import {
  categoryPalette,
  describeChange,
  isChanged,
  kindColorToken,
  plainCategory,
  type Category,
  type ComparisonModel,
  type EmphasisOf,
  type Palette,
} from '@githubnext/projections-renderer-kit'
import type {RendererProjection} from '@githubnext/projections-renderer-sdk/protocol'
import {
  categoryOf,
  excluded,
  flagsOf,
  formatDelta,
  formatSize,
  hasLineCounts,
  pathOf,
  weightOf,
  type CategoryMode,
  type SizeMeasure,
} from './files.js'
import {rowPaths, unionSnapshot} from './snapshots.js'
import type {Circle} from './transition.js'
import type {Packing} from './pack/packing.js'
import type {Drawn, DrawnFlag} from './circles.js'
import {type Decoration, nameOf} from './labels.js'

/** What the renderer reads from the whole document once: paths, the root, whether it is a repository, and its depth. */
export function packingDocument(model: ComparisonModel) {
  const {paths, root, tops} = rowPaths(model)
  const entities = model.entities.map(row => row.after ?? row.before!)
  const repository = entities.some(entity => pathOf(entity) !== undefined)
  const mode: CategoryMode = repository ? 'files' : 'kind'
  const lines = hasLineCounts(model.entities.flatMap(row => [row.before, row.after]))
  // Flags are a weighted hierarchy's: a repository's files are colored by type and carry none.
  const flags = mode === 'kind' && model.entities.some(row => flagsOf(row.before).length > 0 || flagsOf(row.after).length > 0)
  const topNames = tops.map(id => paths.get(id)!).filter(Boolean)
  const depth = Math.max(1, ...[...paths.values()].map(path => (path ? path.split('/').length : 0)))
  return {
    paths,
    root,
    repository,
    mode,
    lines,
    flags,
    topNames,
    depth,
    arcIds: new Map(model.entities.map((row, index) => [row.id, `fp-arc-${index}`])),
  }
}

export type PackingDocument = ReturnType<typeof packingDocument>

/** What the exclusion controls leave out, serialized so it can key a memo. */
export interface Exclusions {
  dependencies: boolean
  lockfiles: boolean
  /** Hidden top-level folders, one per line. */
  hidden: string
}

/** The rows the exclusions keep, or `undefined` when they keep every row. */
export function includedRows(model: ComparisonModel, doc: PackingDocument, exclusions: Exclusions): Set<string> | undefined {
  const rules = {
    dependencies: exclusions.dependencies,
    lockfiles: exclusions.lockfiles,
    hidden: new Set(exclusions.hidden ? exclusions.hidden.split('\n') : []),
  }
  const ids = model.entities
    .map(row => row.id)
    .filter(id => {
      const path = doc.paths.get(id)
      return !path || !excluded(path, rules)
    })
  return ids.length === model.entities.length ? undefined : new Set(ids)
}

/**
 * The palette of every filled circle's category, weighted over both revisions. Kinds (a weighted hierarchy) take
 * their definition colors (`kinds`, from `presentation.kinds`) and otherwise the slots farthest from the colors in
 * use, so no two kinds look alike; flags share the color of the kind of their name, or get their own after the kinds.
 */
export function packingPalette(
  model: ComparisonModel,
  include: ReadonlySet<string> | undefined,
  doc: PackingDocument,
  measure: SizeMeasure,
  colorMode: Parameters<typeof categoryPalette>[1],
  kinds: RendererProjection['kinds'] = {},
): Palette {
  const union = unionSnapshot(model, include)
  const parents = new Set(union.links.map(link => link.from))
  const rows = new Map(model.entities.map(row => [row.id, row]))
  const categories: {category: Category; weight: number}[] = []
  for (const id of union.active) {
    if (parents.has(id) || id === doc.root) continue
    const row = rows.get(id)
    for (const entity of [row?.before, row?.after]) {
      if (!entity) continue
      categories.push({category: categoryOf(entity, doc.mode), weight: weightOf(entity, measure) / 2 + 1e-9})
      if (doc.flags) for (const flag of flagsOf(entity)) categories.push({category: plainCategory(flag), weight: 1e-12})
    }
  }
  if (doc.mode === 'files') return categoryPalette(categories, colorMode)
  const pinned = new Map(
    Object.entries(kinds).flatMap(([kind, entry]) => (entry.color ? [[kind, kindColorToken(entry.color)] as const] : [])),
  )
  return categoryPalette(categories, colorMode, {pinned, distinct: true})
}

export interface ViewBox {
  x: number
  y: number
  width: number
  height: number
  scale: number
}

/** A diff may extend past the area (removed files stay where they were); it is scaled down to fit, labels included. */
export function diffViewBox(bounds: Packing['bounds'], width: number, height: number): ViewBox {
  const margin = 8
  const box = {x: bounds.x - margin, y: bounds.y - margin, width: bounds.width + 2 * margin, height: bounds.height + 2 * margin}
  const scale = Math.min(1, width / box.width, height / box.height)
  const viewWidth = width / scale,
    viewHeight = height / scale
  return {
    x: box.x + box.width / 2 - viewWidth / 2,
    y: box.y + box.height / 2 - viewHeight / 2,
    width: viewWidth,
    height: viewHeight,
    scale,
  }
}

export interface SizeWords {
  now: string
  change: string | undefined
}

/** A circle's size in words, and in a comparison how it changed: `Added`, `Removed` or the delta and what it was. */
export function sizeWords(
  circle: Circle,
  ends: {first: Packing; last: Packing},
  measure: SizeMeasure,
  locale: string,
  comparing: boolean,
): SizeWords {
  const before = ends.first.placements.get(circle.id)?.value,
    after = ends.last.placements.get(circle.id)?.value
  const now = formatSize(circle.value, measure, locale)
  if (!comparing) return {now, change: undefined}
  if (before === undefined && after !== undefined) return {now: formatSize(after, measure, locale), change: 'Added'}
  if (after === undefined && before !== undefined) return {now: formatSize(before, measure, locale), change: 'Removed'}
  if (before === undefined || after === undefined) return {now, change: undefined}
  return {
    now: formatSize(after, measure, locale),
    change:
      Math.abs(after - before) < 0.5
        ? undefined
        : `${formatDelta(after - before, measure, locale)} (was ${formatSize(before, measure, locale)})`,
  }
}

/** Everything one circle is drawn with that doesn't depend on hover or focus. */
export interface DrawContext {
  doc: PackingDocument
  decorations: ReadonlyMap<string, Decoration>
  emphasisOf: EmphasisOf
  palette: Palette
  onSelect: (id: string | null) => void
  describeSize: (circle: Circle) => SizeWords
  diff: boolean
}

/** One circle's drawing: its paint, emphasis, accessible name and placed name and status. */
export function drawCircle(circle: Circle, {doc, decorations, emphasisOf, palette, onSelect, describeSize, diff}: DrawContext): Drawn {
  const {id, row, r} = circle
  const entity: Entity = (circle.local >= 0.5 ? (row.after ?? row.before) : (row.before ?? row.after))!
  const path = doc.paths.get(id)
  const name = nameOf(entity, path)
  const emphasis = emphasisOf(row)
  const changed = isChanged(row)
  const paint = circle.category === undefined ? undefined : palette.paintOf(circle.category)
  const folder = !circle.filled
  const collapsedFolder = circle.filled && entity.kind === 'directory'
  const select = () => onSelect(id)
  const sizes = describeSize(circle)
  const emphasized = emphasis > 0.01 && changed
  const statusText = emphasized ? `, ${describeChange(row)}` : ''
  const changeText = emphasized && sizes.change ? `, ${sizes.change}` : ''
  const {text, labelY, status, statusY, arc = 'top'} = decorations.get(id) ?? {labelY: 0, statusY: 0}
  const removedGhost = diff && !row.after && emphasis > 0.01
  const flags: DrawnFlag[] = folder
    ? []
    : flagsOf(entity).map(key => ({key, label: palette.entry(key)?.category.label ?? key, paint: palette.paintOf(key)}))
  const flagText = flags.length ? `, flagged ${listWords(flags.map(flag => flag.label))}` : ''
  const label = `${folder || collapsedFolder ? 'Folder' : 'File'} ${(path ?? '') || name}, ${sizes.now}${flagText}${statusText}${changeText}`
  const ground = circle.parent === undefined ? 'stage' : 'folder'
  return {
    circle,
    id,
    row,
    r,
    emphasis,
    changed,
    paint,
    folder,
    select,
    label,
    text,
    status,
    labelY,
    statusY,
    arc,
    flags,
    removedGhost,
    ground,
    holdsChanges: false,
  }
}

/**
 * Marks the folders that have an emphasized change drawn inside them (`holdsChanges`): their change ring is drawn
 * neutral, so only the innermost changes carry a change color.
 */
export function withHolders(drawn: readonly Drawn[]): readonly Drawn[] {
  const byId = new Map(drawn.map(item => [item.id, item]))
  const holders = new Set<string>()
  for (const item of drawn) {
    if (!(item.changed && item.emphasis > 0.01)) continue
    for (let parent = item.circle.parent; parent !== undefined && !holders.has(parent); parent = byId.get(parent)?.circle.parent) {
      holders.add(parent)
    }
  }
  return holders.size ? drawn.map(item => (holders.has(item.id) ? {...item, holdsChanges: true} : item)) : drawn
}

/** Words joined as English lists them: `a`, `a and b`, `a, b and c`. */
export function listWords(words: readonly string[]): string {
  return words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}
