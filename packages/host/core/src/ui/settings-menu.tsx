import {useId, useState} from 'react'
import {Settings2} from 'lucide-react'
import {hasSettingsModel, settingsModel} from '../settings.js'
import type {SettingsEntry, SettingsFeatures, SettingsGroup, SettingsSubmenu} from '../settings.js'
import type {ProjectionController} from '../projection.js'
import {RendererControl, rendererControlIcons as controlIcons} from './controls.js'
import {Button} from './components/button.js'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './components/dropdown-menu.js'
import {Popover, PopoverAnchor, PopoverContent} from './components/popover.js'
import {cn} from './lib/utils.js'
import {featureOn} from '../view-model.js'
import type {ProjectionFeatures} from '../view-model.js'
import {viewIcons} from './view-controls.js'
import type {ShowAsOptions} from './view-controls.js'

/** Settings' features: the renderer's declared controls only while the renderer is shown. */
const modelFeatures = (features: ProjectionFeatures | undefined, showAs: ShowAsOptions | undefined): SettingsFeatures => ({
  changesOnly: featureOn(features, 'changesOnly'),
  highlighting: featureOn(features, 'highlighting'),
  rendererChoice: featureOn(features, 'rendererChoice'),
  speed: featureOn(features, 'speed'),
  playback: featureOn(features, 'playback'),
  rendererControls: featureOn(features, 'rendererControls') && (!showAs || showAs.view === 'renderer'),
  zoom: featureOn(features, 'zoom'),
})

/** What `SettingsMenu` would offer for a projection (and its `showAs` choice), so a toolbar can omit an empty menu. */
export function hasSettings(p: ProjectionController, features?: ProjectionFeatures, showAs?: ShowAsOptions): boolean {
  return hasSettingsModel(settingsModel(p, modelFeatures(features, showAs), showAs))
}

const menuIcon = 'pj:size-4 pj:shrink-0 pj:text-muted-foreground'

/** A Settings model's entries as menu items; a range opens its widget (`openRange`), as a menu can't hold one. */
function SettingsEntries({entries, openRange}: {entries: readonly (SettingsEntry | SettingsSubmenu)[]; openRange: (id: string) => void}) {
  return entries.map(entry => {
    switch (entry.type) {
      case 'choice':
        return (
          <DropdownMenuRadioGroup
            key={entry.id}
            value={entry.options.find(option => option.checked)?.id ?? ''}
            onValueChange={value => entry.options.find(option => option.id === value)?.select()}
          >
            {entry.options.map(option => {
              const Icon = option.view ? viewIcons[option.view] : undefined
              return (
                <DropdownMenuRadioItem key={option.id} value={option.id} data-view={option.view} data-control={entry.control}>
                  {Icon && <Icon aria-hidden="true" className={menuIcon} />}
                  {option.label}
                </DropdownMenuRadioItem>
              )
            })}
          </DropdownMenuRadioGroup>
        )
      case 'toggle':
        return (
          <DropdownMenuCheckboxItem
            key={entry.id}
            checked={entry.checked}
            onCheckedChange={checked => entry.set(checked)}
            title={entry.description}
            data-control={entry.control}
          >
            {entry.label} {entry.detail && <span className="pj:ml-auto pj:pl-4 pj:text-xs pj:text-muted-foreground">{entry.detail}</span>}
          </DropdownMenuCheckboxItem>
        )
      case 'action':
        return (
          <DropdownMenuItem key={entry.id} onSelect={entry.run} title={entry.description} data-control={entry.control}>
            {entry.icon && <span className={cn(menuIcon, 'pj:[&_svg]:size-4')}>{controlIcons[entry.icon]}</span>}
            {entry.label}
          </DropdownMenuItem>
        )
      case 'range':
        return (
          <DropdownMenuItem key={entry.id} onSelect={() => openRange(entry.id)} title={entry.description} data-control={entry.id}>
            {entry.label}…
          </DropdownMenuItem>
        )
      case 'submenu':
        return <SettingsSubmenuItem key={entry.id} entry={entry} openRange={openRange} />
    }
  })
}

/** A submenu item and its submenu, named by the item's label alone (not its current value). */
function SettingsSubmenuItem({entry, openRange}: {entry: SettingsSubmenu; openRange: (id: string) => void}) {
  const id = useId()
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-submenu-id={entry.id}>
        <span id={`${id}-label`} className="pj:truncate">
          {entry.label}
        </span>{' '}
        {entry.detail && <span className="pj:ml-auto pj:pl-4 pj:text-xs pj:text-muted-foreground">{entry.detail}</span>}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          aria-labelledby={`${id}-label`}
          collisionPadding={8}
          className="ph-settings-menu ph-settings-submenu pj:max-h-(--radix-dropdown-menu-content-available-height) pj:min-w-48 pj:max-w-[calc(100vw-1rem)] pj:overflow-y-auto"
        >
          <SettingsGroups groups={entry.groups} openRange={openRange} />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}

/** A menu level's groups: separated, each headed by its label (which also names it). */
function SettingsGroups({
  groups,
  openRange,
}: {
  groups: readonly SettingsGroup<SettingsEntry | SettingsSubmenu>[]
  openRange: (id: string) => void
}) {
  return groups.map((group, index) => (
    <DropdownMenuGroup key={group.id} aria-label={group.label} data-group={group.id}>
      {index > 0 && <DropdownMenuSeparator />}
      {group.label && <DropdownMenuLabel aria-hidden="true">{group.label}</DropdownMenuLabel>}
      <SettingsEntries entries={group.entries} openRange={openRange} />
    </DropdownMenuGroup>
  ))
}

/**
 * A Settings button opening a menu (`menuitemradio` and `menuitemcheckbox` items, and submenus): "Show as" (with
 * `showAs`: the renderer, Table or Text) at the top; then "Show" (the scope), "Highlight changes", "Renderer",
 * "Playback" (animated: loop, holds and speed) and the renderer's declared option groups as submenus (see
 * `settingsModel`; not while the table or text view is shown). It is never taller than the room beside its button and
 * scrolls inside. A declared range opens from its item ("Depth…") in a popover. Renders nothing when there is
 * nothing to set.
 */
export function SettingsMenu({
  projection: p,
  features,
  showAs,
}: {
  projection: ProjectionController
  features?: ProjectionFeatures | undefined
  showAs?: ShowAsOptions | undefined
}) {
  const [range, setRange] = useState<string | null>(null)
  const model = settingsModel(p, modelFeatures(features, showAs), showAs)
  if (!hasSettingsModel(model)) return null
  const ranged = range ? p.controls.find(control => control.id === range && control.type === 'range') : undefined
  return (
    <Popover open={ranged !== undefined} onOpenChange={open => !open && setRange(null)}>
      <DropdownMenu modal={false}>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ph-settings pj:relative pj:shrink-0 pj:text-muted-foreground pj:hover:text-foreground pj:data-[state=open]:bg-accent pj:data-[state=open]:text-foreground"
              aria-label="Settings"
              title="Settings"
            >
              <Settings2 />
            </Button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent
          align="end"
          collisionPadding={8}
          aria-label="Settings"
          className="ph-settings-menu ph-settings-popover pj:w-auto pj:min-w-56 pj:max-w-[calc(100vw-1rem)]"
        >
          <SettingsGroups groups={model.groups} openRange={setRange} />
        </DropdownMenuContent>
      </DropdownMenu>
      <PopoverContent
        align="end"
        collisionPadding={8}
        aria-label={ranged?.label}
        className="ph-settings-range pj:w-72 pj:max-w-[calc(100vw-1rem)] pj:gap-3 pj:p-3"
      >
        {ranged && <RendererControl projection={p} control={ranged} stack />}
      </PopoverContent>
    </Popover>
  )
}
