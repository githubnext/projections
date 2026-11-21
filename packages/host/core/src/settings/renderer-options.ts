import type {RendererControl} from '@githubnext/projections-renderer-sdk/protocol'
import type {ProjectionController} from '../projection.js'
import type {SettingsEntry, SettingsGroup, SettingsSubmenu} from '../settings.js'

/** Most renderer option groups shown as their own submenus; more share one submenu, so the top level stays short. */
export const maxRendererSubmenus = 2

/** A group ID as words, for a group that declares no label: `exclude-files` is "Exclude files". */
const humanize = (id: string) => {
  const words = id.replaceAll(/[-_.]+/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : id
}

/** One declared control as a settings entry. */
function controlEntry(p: ProjectionController, control: RendererControl): SettingsEntry {
  const value = p.controlValues[control.id]
  const description = control.description
  switch (control.type) {
    case 'choice':
      return {
        type: 'choice',
        id: control.id,
        label: control.label,
        description,
        control: control.id,
        options: control.choices.map(choice => ({
          id: `${control.id}-${choice.value}`,
          label: choice.label,
          checked: value === choice.value,
          select: () => p.setControl(control.id, choice.value),
        })),
      }
    case 'toggle':
      return {
        type: 'toggle',
        id: control.id,
        label: control.label,
        description,
        control: control.id,
        checked: value === true,
        set: checked => p.setControl(control.id, checked),
      }
    case 'action':
      return {
        type: 'action',
        id: control.id,
        label: control.label,
        description,
        icon: control.icon,
        run: () => p.runAction(control.id),
        control: control.id,
      }
    case 'range':
      return {type: 'range', id: control.id, label: control.label, description, control}
  }
}

/**
 * A submenu's groups from its entries: each choice is a group of its own, headed by its label unless that only
 * repeats the submenu's name; toggles, actions and ranges beside each other share a group.
 */
export function submenuGroups(id: string, label: string, entries: readonly SettingsEntry[]): SettingsGroup[] {
  const groups: SettingsGroup[] = []
  for (const entry of entries) {
    if (entry.type === 'choice') {
      groups.push({id: `${id}-${entry.id}`, label: entry.label === label ? undefined : entry.label, entries: [entry]})
      continue
    }
    const last = groups.at(-1)
    if (last && last.entries.every(item => item.type !== 'choice')) last.entries.push(entry)
    else groups.push({id: `${id}-${entry.id}`, entries: [entry]})
  }
  return groups
}

/** A submenu's current value, when it is one choice: for example "Always". */
export const choiceDetail = (entries: readonly SettingsEntry[]) => {
  const [only] = entries
  return entries.length === 1 && only?.type === 'choice' ? only.options.find(option => option.checked)?.label : undefined
}

/** Labels unique (case-insensitively) among `taken`: a repeated label gets a number, "Options (2)". */
function uniqueLabel(label: string, taken: Set<string>): string {
  let unique = label
  for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = `${label} (${n})`
  taken.add(unique.toLowerCase())
  return unique
}

/**
 * The renderer's option groups: one per declared `group` (in declaration order), labeled by a control's
 * `groupLabel`, else the lone control's label, else the group's ID as words. Ungrouped controls share one group,
 * "<Renderer> options" (or the lone control's label). Labels are unique among themselves and `taken`.
 */
export function rendererOptionGroups(
  controls: readonly RendererControl[],
  rendererTitle: string | undefined,
  taken = new Set<string>(),
): {id: string; label: string; controls: RendererControl[]}[] {
  const ungrouped = '\u0000'
  const byGroup = new Map<string, RendererControl[]>()
  for (const control of controls) {
    const key = control.group ?? ungrouped
    byGroup.set(key, [...(byGroup.get(key) ?? []), control])
  }
  return [...byGroup].map(([key, members]) => {
    const declared = members.find(control => control.groupLabel)?.groupLabel
    const lone = members.length === 1 ? members[0]!.label : undefined
    const label = key === ungrouped ? (declared ?? lone ?? `${rendererTitle ?? 'Renderer'} options`) : (declared ?? lone ?? humanize(key))
    return {id: key === ungrouped ? 'options' : key, label: uniqueLabel(label, taken), controls: members}
  })
}

/**
 * The renderer's option groups as Settings submenus: each group its own submenu up to `maxRendererSubmenus`, and one
 * "<Renderer> options" submenu holding them all beyond that. Labels are unique among themselves and `taken`.
 */
export function rendererOptionMenus(p: ProjectionController, controls: readonly RendererControl[], taken: Set<string>): SettingsSubmenu[] {
  const title = p.renderer?.title
  // Beyond `maxRendererSubmenus` groups, one submenu holds them all: its name comes first.
  const shared =
    new Set(controls.map(control => control.group)).size > maxRendererSubmenus
      ? uniqueLabel(`${title ?? 'Renderer'} options`, taken)
      : undefined
  const options = rendererOptionGroups(controls, title, taken).map(group => {
    const entries = group.controls.map(control => controlEntry(p, control))
    return {id: `control-${group.id}`, label: group.label, entries, detail: choiceDetail(entries)}
  })
  if (!options.length) return []
  return shared !== undefined
    ? [
        {
          type: 'submenu',
          id: 'renderer-options',
          label: shared,
          groups: options.flatMap(option =>
            submenuGroups(option.id, option.label, option.entries).map((group, index) =>
              index === 0 && !group.label ? {...group, label: option.label} : group,
            ),
          ),
        },
      ]
    : options.map(option => ({
        type: 'submenu',
        id: option.id,
        label: option.label,
        detail: option.detail,
        groups: submenuGroups(option.id, option.label, option.entries),
      }))
}
