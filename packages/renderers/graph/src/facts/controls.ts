// The card fact controls a document offers, and which relationships the **Relationships** control draws.
import type {Relationship} from '@githubnext/projections-schemas'
import type {ComparisonModel} from '@githubnext/projections-renderer-kit'
import type {RendererControl} from '@githubnext/projections-renderer-sdk/protocol'
import {fieldLimit, fieldPointer} from './fields.js'
import type {FactFields} from './fields.js'

/** A relationship drawn under the **Relationships** control's value: `all`, or one kind (containment is always drawn). */
export function relationshipShown(relationship: Relationship, shown: string): boolean {
  return shown === 'all' || relationship.kind === shown || relationship.kind === 'contains'
}

/** A model with only the relationships the **Relationships** control's value draws (see `relationshipShown`). */
export function withRelationships(model: ComparisonModel, shown: string): ComparisonModel {
  if (shown === 'all') return model
  return {...model, relationships: model.relationships.filter(row => relationshipShown((row.after ?? row.before)!, shown))}
}

/** Relationship kinds the presentation draws as arrows: architecture draws containment as boundaries. */
export function drawnKinds(model: ComparisonModel, rendererName: string): string[] {
  const kinds = new Set<string>()
  for (const row of model.relationships) for (const side of [row.before, row.after]) if (side) kinds.add(side.kind)
  if (rendererName === 'architecture') kinds.delete('contains')
  return [...kinds].toSorted()
}

/**
 * The card fact controls a document offers: **Subtitle**, **Size by**, **Badges**, **Labels** and **Color by** when it
 * has fields for them (Color by also offers the entity kind), **Icon** always (the `icon` field, and any other field
 * naming a card icon), and **Relationships** and **Relationship colors** when two or more relationship kinds are drawn. Field values are JSON pointers to data fields, so a definition presets them
 * in `presentation.rendererOptions` (`{"badges": "/data/capabilities", "colorBy": "/data/scope"}`).
 */
export function factControls(fields: FactFields, kinds: readonly string[]): RendererControl[] {
  const group = {group: 'cards', groupLabel: 'Cards'}
  const choices = (names: readonly string[]) => names.slice(0, fieldLimit).map(field => ({value: fieldPointer(field), label: field}))
  const none = {value: 'none', label: 'None'}
  const controls: RendererControl[] = []
  if (fields.texts.length) {
    controls.push({
      id: 'subtitle',
      label: 'Subtitle',
      description: "Show a data field's text under each card's name",
      type: 'choice',
      ...group,
      default: 'none',
      choices: [none, ...choices(fields.texts)],
    })
  }
  // Always offered, with the conventional `icon` field always a choice: a definition presets it for revisions that
  // predate their icons too, which then draw none rather than refuse the preset.
  controls.push({
    id: 'icon',
    label: 'Icon',
    description: "Show the icon a data field names (a Lucide name, such as terminal) before each card's kind",
    type: 'choice',
    ...group,
    default: 'none',
    choices: [none, ...choices([...new Set(['icon', ...fields.icons])])],
  })
  if (fields.numbers.length) {
    controls.push({
      id: 'sizeBy',
      label: 'Size by',
      description: "Show a data field's number on each card, compact (12K)",
      type: 'choice',
      ...group,
      default: 'none',
      choices: [none, ...choices(fields.numbers)],
    })
  }
  if (fields.badges.length) {
    controls.push(
      {
        id: 'badges',
        label: 'Badges',
        description: "Show a data field's values as code badges on each card",
        type: 'choice',
        ...group,
        default: 'none',
        choices: [none, ...choices(fields.badges)],
      },
      {
        id: 'labels',
        label: 'Labels',
        description: "Show a data field's values as worded labels on each card",
        type: 'choice',
        ...group,
        default: 'none',
        choices: [none, ...choices(fields.badges)],
      },
      {
        id: 'highlights',
        label: 'Highlights',
        description: "Show a data field's values first on each card, as labels set apart in the accent color",
        type: 'choice',
        ...group,
        default: 'none',
        choices: [none, ...choices(fields.badges)],
      },
      {
        id: 'tags',
        label: 'Tags',
        description: "Show a data field's values as a quiet line of code under each card's labels",
        type: 'choice',
        ...group,
        default: 'none',
        choices: [none, ...choices(fields.badges)],
      },
    )
  }
  controls.push({
    id: 'colorBy',
    label: 'Color by',
    description: 'Color each card by its kind or a data field, with a legend',
    type: 'choice',
    ...group,
    default: 'none',
    choices: [{value: 'none', label: 'None'}, {value: 'kind', label: 'Kind'}, ...choices(fields.colors)],
  })
  if (kinds.length > 1) {
    controls.push({
      id: 'relationships',
      label: 'Relationships',
      description: 'Draw every kind of relationship, or only one',
      type: 'choice',
      ...group,
      default: 'all',
      choices: [{value: 'all', label: 'All kinds'}, ...kinds.slice(0, fieldLimit).map(kind => ({value: kind, label: kind}))],
    })
  }
  if (kinds.length > 1) {
    controls.push({
      id: 'relationshipColors',
      label: 'Relationship colors',
      description: 'Draw each relationship kind in its own color, with a legend',
      type: 'toggle',
      ...group,
      default: false,
    })
  }
  return controls
}
