import {useRef, useState} from 'react'
import {hasSettingsModel, settingsModel} from '@githubnext/projections-host'
import type {ProjectionController, SettingsEntry, SettingsSubmenu} from '@githubnext/projections-host'
import type {VscodeToolbarButton} from '@vscode-elements/elements/dist/vscode-toolbar-button/vscode-toolbar-button.js'
import {VscodeRendererControl, vscodeControlIcons} from './controls.js'
import {ActionButton} from './elements.js'
import {Menu} from './overlay/menu.js'
import {Overlay} from './overlay/overlay.js'
import type {MenuItem} from './overlay/menu-entry.js'
import {uiCodicons} from './codicons.js'
import {on} from './features.js'
import type {ViewKind, VscodeProjectionFeatures} from './features.js'
import type {PopoverControl} from './toolbar-popover.js'
import {viewIcons} from './view-controls.js'
import type {ShowAsProps} from './view-controls.js'

/** Settings' features: the renderer's declared controls only while they apply. */
const modelFeatures = (features: VscodeProjectionFeatures | undefined) => ({
  changesOnly: on(features, 'changesOnly'),
  highlighting: on(features, 'highlighting'),
  rendererChoice: on(features, 'rendererChoice'),
  speed: on(features, 'speed'),
  playback: on(features, 'playback'),
  rendererControls: on(features, 'rendererControls'),
  zoom: on(features, 'zoom'),
})

/** What `SettingsMenu` would offer for a projection, so a toolbar can omit an empty menu; pass `views` when it offers "Show as". */
export function hasSettings(p: ProjectionController, features?: VscodeProjectionFeatures, views: readonly ViewKind[] = []): boolean {
  const showAs = views.length > 1 ? {view: views[0]!, views, onViewChange: () => {}} : undefined
  return hasSettingsModel(settingsModel(p, modelFeatures(features), showAs))
}

/** A Settings model's entries as VS Code menu items in `group` (submenus nest theirs). */
function settingsItems(entries: readonly (SettingsEntry | SettingsSubmenu)[], group: string, openRange: (id: string) => void): MenuItem[] {
  return entries.flatMap((entry): MenuItem[] => {
    const control = 'control' in entry && typeof entry.control === 'string' ? {'data-control': entry.control} : {}
    switch (entry.type) {
      case 'choice':
        return entry.options.map(option => ({
          id: option.id,
          group,
          label: option.label,
          icon: option.view ? viewIcons[option.view] : undefined,
          checked: option.checked,
          onSelect: option.select,
          ...(option.view ? {'data-view': option.view} : {}),
          ...control,
        }))
      case 'toggle':
        return [
          {
            id: entry.id,
            group,
            label: entry.label,
            detail: entry.detail,
            checked: entry.checked,
            checkbox: true,
            onSelect: () => entry.set(!entry.checked),
            ...control,
          },
        ]
      case 'action':
        return [
          {
            id: entry.id,
            group,
            label: entry.label,
            icon: entry.icon ? vscodeControlIcons[entry.icon] : undefined,
            onSelect: entry.run,
            ...control,
          },
        ]
      case 'range':
        return [{id: entry.id, group, label: `${entry.label}…`, onSelect: () => openRange(entry.id), 'data-control': entry.id}]
      case 'submenu': {
        const inner: Record<string, string> = {}
        const items = entry.groups.flatMap(sub => {
          if (sub.label) inner[sub.id] = sub.label
          return settingsItems(sub.entries, sub.id, openRange)
        })
        return [
          {
            id: entry.id,
            group,
            label: entry.label,
            detail: entry.detail,
            submenu: {items, groupLabels: inner},
            'data-submenu-id': entry.id,
          },
        ]
      }
    }
  })
}

/**
 * The settings as VS Code's menu (`menuitemradio` and `menuitemcheckbox` items in named groups, and submenus): "Show
 * as" (given `view`, `views` and `onViewChange` with two views or more) and "Changes only" at the top; then
 * "Highlight changes", "Renderer", "Playback" (animated: loop, holds and speed) and the renderer's declared option
 * groups as submenus (see `settingsModel`). A declared range, which a menu can't hold, opens from its item ("Depth…")
 * in a widget.
 */
export function SettingsMenu({
  projection: p,
  features,
  control,
  view,
  views = [],
  onViewChange,
  rendererTitle,
}: {
  projection: ProjectionController
  features?: VscodeProjectionFeatures | undefined
  control?: PopoverControl | undefined
} & Partial<ShowAsProps>) {
  const [own, setOwn] = useState(false)
  const [range, setRange] = useState<string | null>(null)
  const button = useRef<VscodeToolbarButton>(null)
  const showAs = view && onViewChange && views.length > 1 ? {view, views, onViewChange, rendererTitle} : undefined
  const model = settingsModel(p, modelFeatures(features), showAs)
  if (!hasSettingsModel(model)) return null
  const open = control ? control.open : own
  const setOpen = control ? control.onOpenChange : setOwn
  const anchor = control ? control.anchorRef : button
  const groupLabels: Record<string, string> = {}
  const items = model.groups.flatMap(group => {
    if (group.label) groupLabels[group.id] = group.label
    return settingsItems(group.entries, group.id, setRange)
  })
  const ranged = range ? p.controls.find(item => item.id === range && item.type === 'range') : undefined
  return (
    <>
      {!control && (
        <ActionButton
          ref={button}
          icon={uiCodicons.settings}
          label="Settings"
          popup="menu"
          expanded={open}
          className="phv-settings"
          onClick={() => setOpen(!open)}
          data-focus-id="settings"
          data-icon="gear"
        />
      )}
      <Menu open={open} onClose={() => setOpen(false)} anchor={anchor} label="Settings" items={items} groupLabels={groupLabels} />
      <Overlay
        open={ranged !== undefined}
        onClose={() => setRange(null)}
        anchor={anchor}
        role="dialog"
        label={ranged?.label ?? ''}
        className="phv-widget phv-settings-popover"
      >
        {ranged && (
          <>
            <h3 className="phv-widget-title">{ranged.label}</h3>
            <VscodeRendererControl control={ranged} projection={p} />
          </>
        )}
      </Overlay>
    </>
  )
}
