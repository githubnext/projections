import type {KeyboardEvent} from 'react'
import {VscIcon} from '../elements.js'
import {activateOnKey} from './keys.js'
import {keyed} from '@githubnext/projections-renderer-sdk/presentation'

/** A VS Code menu item. Items with the same `group` are drawn together, separated from other groups. */
export interface MenuItem {
  id: string
  label: string
  /** A codicon drawn before the label. */
  icon?: string | undefined
  /** A choice or a setting: a checked item shows VS Code's check (`menuitemradio`, or `menuitemcheckbox` for `checkbox`). */
  checked?: boolean | undefined
  checkbox?: boolean | undefined
  disabled?: boolean | undefined
  /** Text at the end, where VS Code shows a keybinding, for example "Active", or a submenu's current value. */
  detail?: string | undefined
  group?: string | undefined
  /** Choosing it opens a submenu of these items beside the menu (VS Code's submenus), instead of `onSelect`. */
  submenu?: {items: readonly MenuItem[]; groupLabels?: Readonly<Record<string, string>> | undefined} | undefined
  onSelect?: (() => void) | undefined
  [data: `data-${string}`]: string | undefined
}

const itemRole = ({checked, checkbox}: MenuItem) => (checked === undefined ? 'menuitem' : checkbox ? 'menuitemcheckbox' : 'menuitemradio')

/** One menu item: its check column (in a menu of choices), codicon, label, detail and a submenu's chevron. */
export function MenuEntry({
  item,
  choices,
  expanded,
  register,
  onChoose,
  onHover,
  onKeys,
}: {
  item: MenuItem
  /** The menu has choices: every item keeps a check column. */
  choices: boolean
  /** Its submenu is open. */
  expanded: boolean
  register: (id: string, element: HTMLDivElement | null) => void
  onChoose: (item: MenuItem) => void
  /** The mouse moved onto it (VS Code focuses the item under the mouse and opens a submenu on hover). */
  onHover: (item: MenuItem) => void
  /** The menu's keys, after an item's own (Enter and Space): moving, opening a submenu and closing. */
  onKeys: (event: KeyboardEvent<HTMLDivElement>) => void
}) {
  const {id, label: text, icon, checked, checkbox: _checkbox, disabled, detail, group: _group, onSelect: _onSelect, submenu, ...data} = item
  const choose = () => onChoose(item)
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- its role is a menu item's (`itemRole`), which the rule can't read from an expression.
    <div
      ref={element => {
        register(id, element)
      }}
      role={itemRole(item)}
      tabIndex={-1}
      aria-checked={checked}
      aria-disabled={disabled === true || undefined}
      aria-haspopup={submenu ? 'menu' : undefined}
      aria-expanded={submenu ? expanded : undefined}
      className="phv-menu-item"
      data-menu-item={id}
      data-submenu={submenu ? id : undefined}
      {...data}
      onClick={choose}
      onPointerEnter={event => {
        if (event.pointerType !== 'mouse' || disabled) return
        event.currentTarget.focus({preventScroll: true})
        onHover(item)
      }}
      onKeyDown={event => {
        activateOnKey(choose)(event)
        onKeys(event)
      }}
    >
      {choices && (
        <span className="phv-menu-check" aria-hidden="true">
          {checked && <VscIcon name="check" />}
        </span>
      )}
      {icon ? <VscIcon name={icon} className="phv-menu-icon" aria-hidden="true" /> : <span className="phv-menu-icon" />}
      <span className="phv-menu-label">{text}</span> {detail && <span className="phv-menu-detail">{detail}</span>}
      {submenu && <VscIcon name="chevron-right" className="phv-menu-chevron" aria-hidden="true" />}
    </div>
  )
}

/** A submenu's first row where it covers its menu: it goes back to the menu. */
export function MenuBack({
  label,
  choices,
  onClose,
  onKeys,
}: {
  label: string
  choices: boolean
  onClose: () => void
  onKeys: (event: KeyboardEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      className="phv-menu-item phv-menu-back"
      data-back=""
      aria-label={`Back from ${label}`}
      onClick={onClose}
      onKeyDown={event => {
        activateOnKey(onClose)(event)
        onKeys(event)
      }}
    >
      {choices && <span className="phv-menu-check" aria-hidden="true" />}
      <VscIcon name="chevron-left" className="phv-menu-icon" aria-hidden="true" />
      <span className="phv-menu-label">{label}</span>
    </div>
  )
}

/** Runs of consecutive items in the same group. */
function groupItems(items: readonly MenuItem[]): {key: string; items: MenuItem[]}[] {
  const groups: {key: string; items: MenuItem[]}[] = []
  for (const item of items) {
    const last = groups.at(-1)
    if (last?.key === (item.group ?? '')) last.items.push(item)
    else groups.push({key: item.group ?? '', items: [item]})
  }
  return groups
}

/** The menu's items in their groups: a separator between groups, and each named group's heading over it. */
export function MenuGroups({
  items,
  groupLabels,
  separated,
  expanded,
  ...entry
}: Omit<Parameters<typeof MenuEntry>[0], 'item' | 'expanded'> & {
  items: readonly MenuItem[]
  groupLabels: Readonly<Record<string, string>>
  /** A separator above the first group too (under a back row). */
  separated: boolean
  /** The item whose submenu is open. */
  expanded: string | null
}) {
  return keyed(groupItems(items), group => group.key).map(([key, group], index) => {
    const name = groupLabels[group.key]
    return (
      <div key={key} role={name ? 'group' : 'none'} aria-label={name} className="phv-menu-group">
        {(index > 0 || separated) && <div role="separator" className="phv-menu-separator" />}
        {name && (
          <div aria-hidden="true" className="phv-menu-heading">
            {name}
          </div>
        )}
        {group.items.map(item => (
          <MenuEntry key={item.id} item={item} expanded={expanded === item.id} {...entry} />
        ))}
      </div>
    )
  })
}
