// A projection's parts and the panel that swaps them for a session: the overrides model (here), the line diff, the panel, the default comparator's
// ordering and Save to definition.

import type {ReactNode} from 'react'
import type {DefaultComparatorOptions, Definition} from '@githubnext/projections-schemas'

/** A projection's three independent parts. */
export type PartName = 'extractor' | 'comparator' | 'renderer'

/**
 * A session override of a projection's parts, which the definition file stays the source of truth for: another
 * projection's extractor, the default comparator (with its ordering) or another projection's module, a built-in
 * renderer or another projection's custom one. Values are `projection:<id>`, `default`, `module:<id>`,
 * `builtin:<name>` and `custom:<id>`; absent, the definition's own part is used.
 */
export interface PartOverrides {
  extractor?: string | undefined
  comparator?: string | undefined
  /** The default comparator's ordering, when `comparator` is `default`. */
  order?: DefaultComparatorOptions['order'] | undefined
  renderer?: string | undefined
}

export interface PartOption {
  value: string
  label: string
  /** Where it comes from: "Built-in", a file (mono) or "Dev server". */
  origin: string
  group: string
  disabled?: boolean
  /** Why it is disabled, for example the schema it expects. */
  reason?: string | undefined
}

export interface PartRow {
  part: PartName
  label: string
  value: string
  options: readonly PartOption[]
  changed: boolean
  status?: {kind: string; text: string; icon: ReactNode} | undefined
  onChange: (value: string) => void
  onReset: () => void
  /** More controls under the selector, for example the default comparator's ordering. */
  extra?: ReactNode
}

/** The definition with the overrides applied, as `Save to definition` would write it. */
export function overriddenDefinition(definition: Definition, overrides: PartOverrides | undefined, all: readonly Definition[]): Definition {
  if (!overrides) return definition
  const next: Definition = {...definition}
  const other = (value: string | undefined, prefix: string) =>
    value?.startsWith(prefix) ? all.find(item => item.id === value.slice(prefix.length)) : undefined
  const extractor = other(overrides.extractor, 'projection:')
  if (extractor) next.extractor = extractor.extractor
  if (overrides.comparator === 'default') {
    if (overrides.order) next.comparator = {options: {order: overrides.order}}
    else delete next.comparator
  } else if (overrides.comparator?.startsWith('file:')) {
    next.comparator = overrides.comparator.slice('file:'.length)
  } else {
    const module = other(overrides.comparator, 'module:')
    if (module?.comparator) next.comparator = module.comparator
  }
  if (overrides.renderer?.startsWith('builtin:')) next.renderer = overrides.renderer.slice('builtin:'.length)
  else {
    const custom = other(overrides.renderer, 'custom:')
    if (custom) next.renderer = custom.renderer
  }
  return next
}

/** The parts that differ between two definitions, as `POST /api/definition` takes them: `null` removes one. */
export function changedParts(definition: Definition, saved: Definition): Record<string, unknown> {
  const parts: Record<string, unknown> = {}
  for (const part of ['extractor', 'comparator', 'renderer'] as const) {
    if (JSON.stringify(definition[part]) !== JSON.stringify(saved[part])) parts[part] = saved[part] ?? null
  }
  return parts
}

/** Saving parts through the local runner: a preview of the file edit, then the write. */
export interface DefinitionWriter {
  preview(parts: Record<string, unknown>): Promise<{path: string; before: string; after: string; digest: string}>
  /** Writes exactly the preview with this digest; rejects when the file changed since. */
  save(parts: Record<string, unknown>, digest: string): Promise<void>
  /** Why saving isn't possible here (the Inspector wasn't started with --trust), if it isn't. */
  disabled?: string | undefined
  /** After a save: the overrides are now the definition. */
  onSaved(): void
}
