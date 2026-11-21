import {languageColor, languageNamed, languageOfPath} from '@githubnext/projections-renderer-sdk/languages'
import type {Language} from '@githubnext/projections-renderer-sdk/languages'
import {defaultThemeTokens} from '@githubnext/projections-renderer-sdk/protocol'
import type {ColorMode, LegendItem, RendererLegend, ThemeTokenName} from '@githubnext/projections-renderer-sdk/protocol'
import {kindHues} from '@githubnext/projections-schemas'
import type {KindColor} from '@githubnext/projections-schemas'

type KindTone = Exclude<KindColor, KindHue>
type KindHue = (typeof kindHues)[number]

/**
 * Colors for categories of files and languages, shared by every built-in
 * renderer so a language is the same color everywhere:
 *
 * - Programming and markup languages take their GitHub Linguist color
 *   (`@githubnext/projections/renderer`), adjusted per theme
 *   for contrast. TypeScript is Linguist's blue in file packing and in code
 *   statistics alike.
 * - Everything else (data, configuration, prose and assets: JSON, YAML,
 *   TOML, Markdown, images) takes a slot of the theme's categorical palette
 *   (`chart-1` … `chart-16`): its preferred slot when free and clear of the
 *   language colors in use, otherwise the first one in palette order that is.
 * - Past the palette, the rest share the neutral "other" color, which nothing
 *   else uses.
 *
 * Rank by the whole document (both revisions), so a category keeps its color
 * from Before to After.
 */
export interface Category {
  /** Identity: the language's presented name (`TypeScript` for TSX too), or `.ext`, `none` or a kind. */
  key: string
  /** Shown in the legend and tooltips. */
  label: string
  /** The Linguist language, which gives the category its color; absent for categories that take a palette slot. */
  language?: Language
}

/** The category of a repository path: its Linguist language, else its extension. */
export function fileCategory(path: string): Category {
  const found = languageOfPath(path)
  // A variant (TSX) is presented as its group (TypeScript).
  const language = found && (languageNamed(found.group) ?? found)
  if (language) return {key: language.name, label: language.name, language}
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = base.lastIndexOf('.')
  const extension = dot > 0 && dot < base.length - 1 ? base.slice(dot + 1) : dot === 0 && base.length > 1 ? base.slice(1) : ''
  return extension ? {key: `.${extension}`, label: `.${extension}`} : {key: 'none', label: 'No extension'}
}

/** The category of a language named by another tool (code statistics' tokei names), keeping that tool's label. */
export function languageCategory(name: string): Category {
  const found = languageNamed(name)
  const language = found && (languageNamed(found.group) ?? found)
  return language ? {key: language.name, label: name, language} : {key: name, label: name}
}

/** A category without a language, such as an entity kind. */
export function plainCategory(key: string, label = key): Category {
  return {key, label}
}

/** The neutral color of categories past the palette. */
export const otherToken = 'color-border-emphasis' satisfies ThemeTokenName

/**
 * Preferred palette slots for common non-language categories, so JSON, YAML
 * or Markdown is usually the same color from one repository to the next.
 * Others prefer a slot from a hash of their key.
 */
const preferredSlots: Record<string, number> = {
  JSON: 2,
  'JSON with Comments': 2,
  JSON5: 2,
  YAML: 3,
  Markdown: 7,
  MDX: 7,
  TOML: 9,
  XML: 6,
  SVG: 14,
  Text: 16,
  'Ignore List': 12,
  '.png': 12,
  '.jpg': 12,
  '.jpeg': 12,
  '.gif': 12,
  '.webp': 12,
  '.ico': 12,
  '.lock': 15,
  '.wasm': 5,
  none: 13,
}
const slots = 16

function hashSlot(key: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193) >>> 0
  return (hash % slots) + 1
}

const toLinear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)

/** `#rrggbb` to OKLab, for keeping palette slots apart from language colors. */
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(index => toLinear(Number.parseInt(hex.slice(index, index + 2), 16) / 255)) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
const hex = /^#[0-9a-f]{6}$/i
function distance(a: string, b: string): number {
  if (!hex.test(a) || !hex.test(b)) return Infinity
  const [x, y] = [oklab(a), oklab(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}
/** How far (OKLab ΔE) a palette slot keeps from the language colors in use. */
const clearance = 0.06

/** The theme token a definition's kind color paints with (`presentation.kinds.<kind>.color`). */
export function kindColorToken(color: KindColor): ThemeTokenName {
  if (color === 'neutral') return otherToken
  const slot = (kindHues as readonly string[]).indexOf((toneHues as Partial<Record<KindColor, KindHue>>)[color] ?? color) + 1
  return `chart-${slot || 1}` as ThemeTokenName
}
/** The hue each meaning takes: danger red, warning amber, success green, info blue. */
const toneHues: Record<Exclude<KindTone, 'neutral'>, KindHue> = {danger: 'red', warning: 'amber', success: 'green', info: 'blue'}

/** How `categoryPalette` assigns colors beyond its defaults. */
export interface PaletteOptions {
  /** Categories whose color is set (a definition's kind colors), by key: they keep it, and the rest keep clear of it. */
  pinned?: ReadonlyMap<string, ThemeTokenName>
  /**
   * Choose each free slot to be as far as possible from every color already used (OKLab, in both themes), rather
   * than by its preferred slot: for categories with no conventional color, such as entity kinds, so no two look alike.
   */
  distinct?: boolean
}

/** One category's place in a `Palette`: its color and how it was chosen. */
export interface PaletteEntry {
  /** The category, as first given for its key. */
  category: Category
  /** The category's total weight: the sum of every weight given for its key. */
  weight: number
  /** Whether the color was set (`PaletteOptions.pinned`) rather than assigned. */
  pinned?: boolean
  /** CSS paint: a language's color, `var(--projections-chart-n)` or the neutral "other" token. */
  paint: string
  /** The swatch the host's legend draws: the same color or token. */
  swatch: {color: string} | {token: ThemeTokenName}
  /** The palette slot, 0 for a language color or "other". */
  slot: number
}

/** The colors `categoryPalette` assigned to a document's categories. */
export interface Palette {
  /** Categories by weight (heaviest first), with their colors. */
  ranked: PaletteEntry[]
  /** The paint of a category key; "other" for an unknown one. */
  paintOf(key: string): string
  /** The entry of a category key, or undefined for a key the palette wasn't given. */
  entry(key: string): PaletteEntry | undefined
}

/**
 * Assigns colors to weighted categories (see the module notes). `colorMode`
 * picks the theme's language colors. Palette slots are kept clear of the
 * language colors in both themes' defaults, so a category takes the same slot
 * in each; the slots themselves are painted with the host's tokens.
 */
export function categoryPalette(
  categories: Iterable<{category: Category; weight: number}>,
  colorMode: ColorMode = 'light',
  options: PaletteOptions = {},
): Palette {
  const pinned = options.pinned ?? new Map<string, ThemeTokenName>()
  const merged = new Map<string, {category: Category; weight: number}>()
  for (const {category, weight} of categories) {
    const known = merged.get(category.key)
    if (known) known.weight += weight
    else merged.set(category.key, {category, weight})
  }
  const order = [...merged.values()].sort(
    (a, b) => b.weight - a.weight || (a.category.key < b.category.key ? -1 : a.category.key > b.category.key ? 1 : 0),
  )
  // Slots are chosen against both themes' defaults, so a category takes the same slot in light and dark.
  const modes = (['light', 'dark'] as const).map(mode => ({
    tokens: defaultThemeTokens(mode),
    languages: order
      .map(({category}) => (category.language ? languageColor(category.language, mode) : undefined))
      .filter((color): color is string => color !== undefined),
  }))
  const slotOf = (token: ThemeTokenName) => (/^chart-\d+$/.test(token) ? Number(token.slice(6)) : 0)
  // Pinned colors are reserved first, so assigned ones keep clear of them.
  const taken = new Set<number>([...pinned.values()].map(slotOf).filter(Boolean))
  const used = (mode: (typeof modes)[number]) => [
    ...mode.languages,
    ...[...taken].map(slot => mode.tokens[`chart-${slot}` as ThemeTokenName]),
  ]
  const ranked = order.map(({category, weight}): PaletteEntry => {
    const set = pinned.get(category.key)
    if (set) return {category, weight, pinned: true, paint: `var(--projections-${set})`, swatch: {token: set}, slot: slotOf(set)}
    const color = category.language ? languageColor(category.language, colorMode) : undefined
    if (color) return {category, weight, paint: color, swatch: {color}, slot: 0}
    if (options.distinct) {
      const slot = farthestSlot(taken, modes, used)
      if (slot) {
        taken.add(slot)
        const token = `chart-${slot}` as ThemeTokenName
        return {category, weight, paint: `var(--projections-${token})`, swatch: {token}, slot}
      }
    }
    const preferred = preferredSlots[category.key] ?? hashSlot(category.key)
    let slot = 0
    // The preferred slot, else the first free one in palette order (the first eight avoid the change hues), each clear
    // of the language colors in use; failing that, any free slot.
    const order = [preferred, ...Array.from({length: slots}, (_, index) => index + 1).filter(index => index !== preferred)]
    for (const strict of [true, false]) {
      for (const candidate of order) {
        if (slot) break
        if (taken.has(candidate)) continue
        const near = modes.some(({tokens, languages}) => {
          const value = tokens[`chart-${candidate}` as ThemeTokenName]
          return languages.some(language => distance(value, language) < clearance)
        })
        if (strict && near) continue
        slot = candidate
      }
      if (slot) break
    }
    if (!slot) return {category, weight, paint: `var(--projections-${otherToken})`, swatch: {token: otherToken}, slot: 0}
    taken.add(slot)
    const token = `chart-${slot}` as ThemeTokenName
    return {category, weight, paint: `var(--projections-${token})`, swatch: {token}, slot}
  })
  const byKey = new Map(ranked.map(entry => [entry.category.key, entry]))
  return {
    ranked,
    entry: key => byKey.get(key),
    paintOf: key => byKey.get(key)?.paint ?? `var(--projections-${otherToken})`,
  }
}

/**
 * The free slot farthest from every color in use (the smallest OKLab distance over both themes, largest first). The
 * first eight slots avoid the change hues, so they come first while one of them is clearly apart from what is used;
 * the rest join when none is. Ties go to the lower slot. 0 when every slot is taken.
 */
function farthestSlot(
  taken: ReadonlySet<number>,
  modes: readonly {tokens: Record<ThemeTokenName, string>; languages: string[]}[],
  used: (mode: {tokens: Record<ThemeTokenName, string>; languages: string[]}) => string[],
): number {
  const colors = modes.map(mode => ({tokens: mode.tokens, used: used(mode)}))
  const score = (slot: number) =>
    Math.min(
      ...colors.map(({tokens, used}) =>
        Math.min(Infinity, ...used.map(color => distance(tokens[`chart-${slot}` as ThemeTokenName], color))),
      ),
    )
  const best = (candidates: number[]) =>
    candidates
      .filter(slot => !taken.has(slot))
      .reduce<{slot: number; score: number}>(
        (found, slot) => {
          const value = score(slot)
          return value > found.score + 1e-9 ? {slot, score: value} : found
        },
        {slot: 0, score: -1},
      )
  const calm = best([1, 2, 3, 4, 5, 6, 7, 8])
  if (calm.slot && calm.score >= distinctClearance) return calm.slot
  const any = best(Array.from({length: slots}, (_, index) => index + 1))
  return any.slot
}
/** How far (OKLab ΔE) a calm slot must stand from the colors in use before the change-hued slots are considered. */
const distinctClearance = 0.09

/**
 * The host legend for a palette: the heaviest categories with their swatches,
 * then the rest (categories sharing the neutral color, or past `limit`) as one
 * "N other types" item.
 */
export function paletteLegend(palette: Palette, title: string, limit = 14, shape: LegendItem['shape'] = 'circle'): RendererLegend {
  if (!palette.ranked.length) return {items: []}
  const named = palette.ranked.filter(entry => entry.pinned === true || !('token' in entry.swatch && entry.swatch.token === otherToken))
  const shown = named.slice(0, limit)
  const rest = palette.ranked.length - shown.length
  const items: LegendItem[] = shown.map(entry => ({label: entry.category.label, ...entry.swatch, shape}))
  if (rest > 0) {
    items.push({
      label: `${rest.toLocaleString('en-US')} other ${rest === 1 ? 'type' : 'types'}`,
      token: otherToken,
      shape,
    })
  }
  return {title, items}
}
