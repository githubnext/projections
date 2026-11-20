// Card facts a definition can ask for: a data field's values as badges or worded labels, a text field as a subtitle,
// the icon a field names, a numeric field to size cards by, a card color by kind or data field, which relationship
// kinds to draw and a color per relationship kind, each described in the host legend.
import type {Entity, Relationship} from '@githubnext/projections-schemas'
import {categoryPalette, languageCategory, plainCategory} from '@githubnext/projections-renderer-kit'
import type {CardAccent, CardBadge, ComparisonModel, LegendItem, Palette, RendererLegend} from '@githubnext/projections-renderer-kit'
import {badgeValues, colorValue, iconValue, numberValue, pointerField, textValue} from './facts/fields.js'

export * from './facts/fields.js'
export * from './facts/controls.js'
export * from './facts/changes.js'
export * from './facts/icons.js'

/** The colors of a document's card values and relationship kinds, from one palette so no two share a color. */
export function factPalette(
  model: ComparisonModel,
  colorBy: string | undefined,
  kinds: readonly string[],
  colorMode: 'light' | 'dark',
): Palette | undefined {
  const categories: {category: ReturnType<typeof plainCategory>; weight: number}[] = []
  if (colorBy) {
    const values = model.entities.map(row => colorValue((row.after ?? row.before)!, colorBy)).filter(value => value !== undefined)
    // A field naming programming languages (`Rust`, `TypeScript`) takes their GitHub colors, as everywhere else.
    const languages = colorBy !== 'kind' && values.length > 0 && values.every(value => languageCategory(value).language)
    for (const value of values)
      categories.push({
        category: languages ? {...languageCategory(value), key: `card:${value}`, label: value} : plainCategory(`card:${value}`, value),
        weight: 1,
      })
  }
  for (const kind of kinds) {
    const count = model.relationships.filter(row => (row.after ?? row.before)!.kind === kind).length
    // After every card value, so relationship kinds never take a card value's slot.
    categories.push({category: plainCategory(`edge:${kind}`, kind), weight: -1 / (1 + count)})
  }
  return categories.length ? categoryPalette(categories, colorMode) : undefined
}

export interface CardFacts {
  badges?: (entity: Entity) => readonly CardBadge[] | undefined
  subtitle?: (entity: Entity) => string | undefined
  /** The card icon a field names (`cardIconNames`), before the card's kind line. */
  icon?: (entity: Entity) => string | undefined
  /** The size field's number, compact (`12K`), at the right of a card's kind line. */
  detail?: (entity: Entity) => string | undefined
  accent?: (entity: Entity) => CardAccent | undefined
  relationshipColor?: (relationship: Relationship) => string | undefined
  legend: RendererLegend | undefined
}

/** The card fact control values (pointers or `none`) a document's cards are drawn with. */
export interface CardFactOptions {
  badges: string
  colorBy: string
  kinds: readonly string[]
  colorMode: 'light' | 'dark'
  labels?: string
  highlights?: string
  tags?: string
  subtitle?: string
  icon?: string
  sizeBy?: string
  locale?: string | undefined
}

/** The canvas props and the legend for the chosen facts. */
export function cardFacts(model: ComparisonModel, options: CardFactOptions): CardFacts {
  const badgeField = pointerField(options.badges)
  const labelField = pointerField(options.labels ?? 'none')
  const highlightField = pointerField(options.highlights ?? 'none')
  const tagField = pointerField(options.tags ?? 'none')
  const subtitleField = pointerField(options.subtitle ?? 'none')
  const iconField = pointerField(options.icon ?? 'none')
  const sizeField = pointerField(options.sizeBy ?? 'none')
  const compact = new Intl.NumberFormat(options.locale, {notation: 'compact', maximumFractionDigits: 1})
  const colorBy = options.colorBy === 'kind' || pointerField(options.colorBy) !== undefined ? options.colorBy : undefined
  const palette = factPalette(model, colorBy, options.kinds, options.colorMode)
  const field = colorBy && colorBy !== 'kind' ? pointerField(colorBy) : undefined
  const swatch = (key: string) => palette?.entry(key)?.swatch ?? {}
  const cardItems: LegendItem[] = []
  const edgeItems: LegendItem[] = options.kinds.map(kind => ({label: kind, ...swatch(`edge:${kind}`), shape: 'line'}))
  for (const entry of palette?.ranked ?? [])
    if (entry.category.key.startsWith('card:')) cardItems.push({label: entry.category.label, ...entry.swatch})
  // The title names what colors the cards (a field's name verbatim); relationship kinds are lines, which say what they are.
  const title = colorBy ? (field ?? 'Kind') : options.kinds.length ? 'Relationships' : 'Cards'
  // What the number on each card is has no swatch: it is said in words.
  const sizeItems: LegendItem[] = sizeField === undefined ? [] : [{label: `Number on each card: ${sizeField}`}]
  const items = [...cardItems, ...edgeItems, ...sizeItems]
  // Highlights first, then labels and badges on pills, then the quiet tags.
  const badgeParts: ((entity: Entity) => CardBadge[])[] = []
  if (highlightField !== undefined)
    badgeParts.push(entity => badgeValues(entity, highlightField).map(text => ({text, tone: 'highlight' as const})))
  if (labelField !== undefined) badgeParts.push(entity => badgeValues(entity, labelField).map(text => ({text, prose: true})))
  if (badgeField !== undefined) badgeParts.push(entity => badgeValues(entity, badgeField))
  if (tagField !== undefined) badgeParts.push(entity => badgeValues(entity, tagField).map(text => ({text, tone: 'quiet' as const})))
  return {
    ...(badgeParts.length ? {badges: (entity: Entity) => badgeParts.flatMap(part => part(entity))} : {}),
    ...(subtitleField === undefined ? {} : {subtitle: (entity: Entity) => textValue(entity, subtitleField)}),
    ...(iconField === undefined ? {} : {icon: (entity: Entity) => iconValue(entity, iconField)}),
    ...(sizeField === undefined
      ? {}
      : {
          detail: (entity: Entity) => {
            const value = numberValue(entity, sizeField)
            return value === undefined ? undefined : compact.format(value)
          },
        }),
    ...(colorBy && palette
      ? {
          accent: (entity: Entity) => {
            const value = colorValue(entity, colorBy)
            if (value === undefined) return undefined
            // The kind is already in the card's name; a boolean's value names its field.
            const label = !field ? '' : typeof entity.data?.[field] === 'boolean' ? value : `${field}: ${value}`
            return {paint: palette.paintOf(`card:${value}`), label, category: value}
          },
        }
      : {}),
    ...(options.kinds.length && palette
      ? {relationshipColor: (relationship: Relationship) => palette.paintOf(`edge:${relationship.kind}`)}
      : {}),
    legend: items.length ? {title, items} : undefined,
  }
}
