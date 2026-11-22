// The settings every host's Settings menu offers, as one hierarchy: a short top level ("Show as", "Show")
// and submenus for the rest, so the top level stays short however many options a renderer declares.
import type {ControlIcon, RendererControl} from '@githubnext/projections-renderer-sdk/protocol'
import type {Highlighting, ProjectionController} from './projection.js'
import {choiceDetail, rendererOptionMenus, submenuGroups} from './settings/renderer-options.js'

/** The settings a host offers; each defaults on (the hosts' feature flags of the same names). */
export interface SettingsFeatures {
  changesOnly?: boolean | undefined
  highlighting?: boolean | undefined
  rendererChoice?: boolean | undefined
  speed?: boolean | undefined
  playback?: boolean | undefined
  rendererControls?: boolean | undefined
  zoom?: boolean | undefined
}

/** The presentations "Show as" chooses among. */
export type SettingsView = 'renderer' | 'table' | 'text'

/** "Show as": the shown view, the views to choose among (two or more) and how to choose one. */
export interface SettingsShowAs {
  view: SettingsView
  views: readonly SettingsView[]
  onViewChange: (view: SettingsView) => void
  /** The renderer's title, which names its choice; default "Renderer". */
  rendererTitle?: string | undefined
}

/** One choice of a `choice` entry: a radio item. */
export interface SettingsOption {
  id: string
  label: string
  checked: boolean
  select: () => void
  /** The view a "Show as" choice shows. */
  view?: SettingsView
}

type RangeControl = Extract<RendererControl, {type: 'range'}>

/** One setting: radio choices, a checkbox, an action, or a range (which hosts open in a widget: menus can't hold one). */
export type SettingsEntry =
  | {type: 'choice'; id: string; label: string; description?: string | undefined; options: SettingsOption[]; control?: string}
  | {
      type: 'toggle'
      id: string
      label: string
      description?: string | undefined
      /** Text at the end of the item, for example "Back and forth". */
      detail?: string | undefined
      checked: boolean
      set: (checked: boolean) => void
      control?: string
    }
  | {
      type: 'action'
      id: string
      label: string
      description?: string | undefined
      icon?: ControlIcon | undefined
      run: () => void
      control: string
    }
  | {type: 'range'; id: string; label: string; description?: string | undefined; control: RangeControl}

/** Entries drawn together, separated from other groups; `label` heads them (and names their `group`). */
export interface SettingsGroup<Entry = SettingsEntry> {
  id: string
  label?: string | undefined
  entries: Entry[]
}

/** An item that opens a submenu of groups; `detail` is the current value, shown at the end of the item. */
export interface SettingsSubmenu {
  type: 'submenu'
  id: string
  label: string
  detail?: string | undefined
  groups: SettingsGroup[]
}

/** The top level of a Settings menu: groups of settings and submenus. Empty when there is nothing to set. */
export interface SettingsModel {
  groups: SettingsGroup<SettingsEntry | SettingsSubmenu>[]
}

/** The control group a toolbar draws as its zoom controls (the kit's `graphCanvasControls`), not Settings. */
export const zoomControlGroup = 'zoom'

/** Playback speeds offered under "Playback". */
export const playbackSpeeds: readonly {label: string; factor: number}[] = [
  {label: '0.5×', factor: 0.5},
  {label: '1×', factor: 1},
  {label: '2×', factor: 2},
]

/** Change highlighting choices, under "Highlight changes". */
export const highlightingChoices: readonly {value: Highlighting; label: string}[] = [
  {value: 'animated', label: 'During the transition'},
  {value: 'on', label: 'Always'},
  {value: 'off', label: 'Off'},
]

const viewLabel = (view: SettingsView, rendererTitle: string | undefined) =>
  view === 'renderer' ? (rendererTitle ?? 'Renderer') : view === 'table' ? 'Table' : 'Text'

const on = (features: SettingsFeatures | undefined, name: keyof SettingsFeatures) => features?.[name] !== false

/** The renderer's declared controls Settings holds: none when it stopped, and not the zoom group a toolbar draws. */
export function settingsControls(p: ProjectionController, features?: SettingsFeatures): readonly RendererControl[] {
  if (!on(features, 'rendererControls') || p.rendererStatus === 'failed') return []
  return on(features, 'zoom') ? p.controls.filter(control => control.group !== zoomControlGroup) : p.controls
}

/** "Show as": one choice among the views. */
function showAsGroup(showAs: SettingsShowAs): SettingsGroup {
  return {
    id: 'show-as',
    label: 'Show as',
    entries: [
      {
        type: 'choice',
        id: 'show-as',
        label: 'Show as',
        options: showAs.views.map(view => ({
          id: `view-${view}`,
          label: viewLabel(view, showAs.rendererTitle),
          checked: showAs.view === view,
          select: () => showAs.onViewChange(view),
          view,
        })),
      },
    ],
  }
}

/** "Playback" while animated: loop and holds (unless motion is reduced) and speed. */
function playbackEntries(p: ProjectionController, features: SettingsFeatures | undefined): SettingsEntry[] {
  const playback: SettingsEntry[] = []
  if (on(features, 'playback') && !p.reducedMotion) {
    playback.push(
      {
        type: 'toggle',
        id: 'loop',
        label: 'Loop',
        detail: 'Back and forth',
        description: 'Plays back and forth between the revisions.',
        checked: p.loop,
        set: p.setLoop,
      },
      {
        type: 'choice',
        id: 'holds',
        label: 'Holds',
        description: 'Where playback holds at each step.',
        options: [
          {id: 'holds-timeline', label: 'On the slider', checked: p.holds === 'timeline', select: () => p.setHolds('timeline')},
          {id: 'holds-pause', label: 'Pause playback', checked: p.holds === 'pause', select: () => p.setHolds('pause')},
        ],
      },
    )
  }
  if (on(features, 'speed')) {
    const known = playbackSpeeds.some(option => Math.abs(option.factor - p.speed) < 1e-6)
    playback.push({
      type: 'choice',
      id: 'speed',
      label: 'Speed',
      options: [...(known ? [] : [{label: `${p.speed}×`, factor: p.speed}]), ...playbackSpeeds].map(option => ({
        id: `speed-${option.factor}`,
        label: option.label,
        checked: Math.abs(option.factor - p.speed) < 1e-6,
        select: () => p.setSpeed(option.factor),
      })),
    })
  }
  return playback
}

/** Words for each scope where Settings offers it. */
const scopeChoices = [
  {value: 'changes', label: 'Changes'},
  {value: 'all', label: 'Everything'},
  {value: 'noise', label: 'Noise'},
] as const

/**
 * The scope, "Show": the changes (with their context), everything, and the noise when anything varied within tolerance
 * or was regenerated.
 */
function scopeChoice(p: ProjectionController): SettingsEntry {
  const choices = scopeChoices.filter(choice => choice.value !== 'noise' || p.scope === 'noise' || p.scopeCounts.noise > 0)
  return {
    type: 'choice',
    id: 'scope',
    label: 'Show',
    options: choices.map(choice => ({
      id: `scope-${choice.value}`,
      label: choice.label,
      checked: p.scope === choice.value,
      select: () => p.setScope(choice.value),
    })),
  }
}

/**
 * The Settings menu for a projection, every host's: "Show as" (with `showAs`, two views or more) at the top; then
 * "Show" (the scope), "Highlight changes", "Renderer" (more than one), "Playback" (animated: loop, holds, speed) and
 * the renderer's option groups as submenus, each group its own submenu up to `maxRendererSubmenus` and one
 * "<Renderer> options" submenu holding them all beyond that.
 */
export function settingsModel(p: ProjectionController, features?: SettingsFeatures, showAs?: SettingsShowAs): SettingsModel {
  const groups: SettingsModel['groups'] = []
  const animated = p.comparing && p.mode === 'animated'
  if (showAs && showAs.views.length > 1) groups.push(showAsGroup(showAs))
  const submenus: SettingsSubmenu[] = []
  const submenu = (id: string, label: string, entries: SettingsEntry[], detail = choiceDetail(entries)) => {
    if (entries.length) submenus.push({type: 'submenu', id, label, detail, groups: submenuGroups(id, label, entries)})
  }
  if (p.comparing && on(features, 'changesOnly')) submenu('scope', 'Show', [scopeChoice(p)])
  if (p.comparing && on(features, 'highlighting')) {
    submenu('highlighting', 'Highlight changes', [
      {
        type: 'choice',
        id: 'highlighting',
        label: 'Highlight changes',
        options: highlightingChoices.map(choice => ({
          id: `highlighting-${choice.value}`,
          label: choice.label,
          checked: p.highlighting === choice.value,
          select: () => p.setHighlighting(choice.value),
        })),
      },
    ])
  }
  if (on(features, 'rendererChoice') && p.renderers.length > 1 && p.renderer) {
    submenu('renderer', 'Renderer', [
      {
        type: 'choice',
        id: 'renderer',
        label: 'Renderer',
        options: p.renderers.map(entry => ({
          id: `renderer-${entry.name}`,
          label: entry.title,
          checked: p.renderer?.name === entry.name,
          select: () => p.setRenderer(entry.name),
        })),
      },
    ])
  }
  if (animated) submenu('playback', 'Playback', playbackEntries(p, features), `${p.speed}×`)
  if (submenus.length) groups.push({id: 'settings', entries: submenus})
  const title = p.renderer?.title
  const taken = new Set(['show as', 'show', ...submenus.map(item => item.label.toLowerCase())])
  const optionMenus = rendererOptionMenus(p, settingsControls(p, features), taken)
  if (optionMenus.length) groups.push({id: 'renderer-options', label: title ?? 'Renderer', entries: optionMenus})
  return {groups}
}

/** Whether a projection has anything to set: hosts omit an empty Settings menu. */
export const hasSettingsModel = (model: SettingsModel) => model.groups.length > 0

/** Every label a person reads in a Settings model: submenus and group headings, level by level. Each level's are unique. */
export function settingsLabels(model: SettingsModel): string[][] {
  const levels: string[][] = []
  const top: string[] = []
  for (const group of model.groups) {
    if (group.label) top.push(group.label)
    for (const entry of group.entries) {
      if (entry.type === 'submenu') {
        top.push(entry.label)
        levels.push(entry.groups.flatMap(inner => (inner.label ? [inner.label] : [])))
      }
    }
  }
  return [top, ...levels]
}
