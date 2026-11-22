import {useLayoutEffect, useRef, useState} from 'react'
import type {KeyboardEvent, RefObject} from 'react'
import {Overlay} from './overlay.js'
import type {OverlayProps} from './overlay.js'
import {MenuBack, MenuGroups} from './menu-entry.js'
import type {MenuItem} from './menu-entry.js'
import {menuTarget, openingItem, show} from './keys.js'

/** The props of `Menu`: its items (grouped by `MenuItem.group`), its accessible name, and the overlay's placement. */
export interface MenuProps extends Omit<OverlayProps, 'role' | 'children' | 'manualFocus' | 'initialFocus'> {
  items: readonly MenuItem[]
  label: string
  /** Names of groups (`MenuItem.group`), shown over them in VS Code's small caption type and naming their `group`. */
  groupLabels?: Readonly<Record<string, string>> | undefined
}

const enabledItems = (root: ParentNode | null | undefined, selector: string) => [
  ...(root?.querySelectorAll<HTMLElement>(`${selector}:not([aria-disabled=true])`) ?? []),
]

/**
 * VS Code's context menu (`--vscode-menu-*`): a `menu` of `menuitem`s (`menuitemradio` with a check for choices),
 * with codicons, separators between groups and VS Code's keys: arrows, Home and End move, Enter and Space choose,
 * a letter jumps to the next item starting with it, Escape and Tab close it. Focus starts on the checked item. It is
 * never taller than the room beside its anchor and scrolls inside, keeping the focused item in view. An item with
 * a `submenu` opens it beside the menu (Right Arrow, Enter, Space, a click or hovering): Left Arrow or Escape closes
 * it again; where neither side has room it covers the menu, with a row to go back.
 */
export function Menu(props: MenuProps) {
  return <MenuLevel {...props} />
}

function MenuLevel({
  items,
  label,
  groupLabels = {},
  open,
  onClose,
  onDone,
  back,
  focusFirst = true,
  ...overlay
}: MenuProps & {
  /** Focus its checked (else first) item when it opens: not for a submenu opened by hovering. */
  focusFirst?: boolean
  /** Closes the whole menu once an item is chosen; a submenu's `onClose` only closes it. */
  onDone?: () => void
  /** A submenu covering its menu: a first row that goes back to it. */
  back?: string | undefined
}) {
  const list = useRef<HTMLDivElement>(null)
  const [sub, setSub] = useState<string | null>(null)
  const [subFocus, setSubFocus] = useState(true)
  const [inPlace, setInPlace] = useState(false)
  const anchors = useRef(new Map<string, HTMLDivElement>())
  const subAnchor = useRef<HTMLDivElement | null>(null)
  const done = onDone ?? onClose
  const choices = items.some(item => item.checked !== undefined)
  const nested = back !== undefined
  const enabled = () => enabledItems(list.current, ':scope [role^=menuitem]')
  useLayoutEffect(() => {
    if (!open) {
      setSub(null)
      return
    }
    if (focusFirst) show(openingItem(enabled()))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only opening focuses an item; a later focusFirst change doesn't.
  }, [open])
  const openSub = (id: string, focus = true) => {
    if (sub === id) {
      // Already open (hovered): move into it.
      const menu = list.current?.parentElement?.querySelector(':scope > .phv-submenu')
      if (focus) show(openingItem(enabledItems(menu, '[role^=menuitem]')))
      return
    }
    subAnchor.current = anchors.current.get(id) ?? null
    setSubFocus(focus)
    setSub(id)
  }
  const closeSub = (focus: boolean) => {
    const id = sub
    setSub(null)
    if (focus && id) show(anchors.current.get(id))
  }
  const choose = (item: MenuItem) => {
    if (item.disabled) return
    if (item.submenu) {
      openSub(item.id)
      return
    }
    done()
    item.onSelect?.()
  }
  const hover = (item: MenuItem) => {
    if (item.submenu) {
      if (sub !== item.id) openSub(item.id, false)
    } else if (sub) setSub(null)
  }
  const register = (id: string, element: HTMLDivElement | null) => {
    if (element) anchors.current.set(id, element)
    else anchors.current.delete(id)
  }
  /** What a key does besides moving focus: open a submenu, go back from one, or close the menu. */
  const command = (event: KeyboardEvent<HTMLDivElement>, target: HTMLElement): (() => void) | undefined => {
    const submenu = target.dataset.submenu
    if (event.key === 'ArrowRight' && submenu) return () => openSub(submenu)
    if (event.key === 'ArrowLeft' && nested) {
      return () => {
        event.stopPropagation()
        onClose()
      }
    }
    return event.key === 'Tab' ? done : undefined
  }
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const action = command(event, target)
    if (action) {
      event.preventDefault()
      action()
      return
    }
    const all = enabled()
    const next = menuTarget(event.key, all, all.indexOf(target))
    if (next === undefined) return
    event.preventDefault()
    show(all[next])
  }
  const opened = items.find(item => item.id === sub && !!item.submenu)
  return (
    <Overlay
      {...overlay}
      open={open}
      onClose={onClose}
      role="none"
      manualFocus
      className={`phv-menu-overlay ${nested ? 'phv-submenu' : ''}`}
      {...(nested
        ? {
            placement: 'beside' as const,
            inline: true,
            returnFocus: false,
            onPlaced: (placed: {inPlace: boolean}) => setInPlace(placed.inPlace),
          }
        : {})}
    >
      <div ref={list} role="menu" aria-label={label} className="phv-menu" onKeyDown={move}>
        {nested && inPlace && <MenuBack label={label} choices={choices} onClose={onClose} />}
        <MenuGroups
          items={items}
          groupLabels={groupLabels}
          separated={nested && inPlace}
          choices={choices}
          expanded={sub}
          register={register}
          onChoose={choose}
          onHover={hover}
        />
      </div>
      {opened?.submenu && (
        <SubmenuLevel key={opened.id} item={opened} anchor={subAnchor} onClose={() => closeSub(true)} onDone={done} focusFirst={subFocus} />
      )}
    </Overlay>
  )
}

/** A submenu: a menu level beside the item it opens from, focused on its checked (else first) item when it opens. */
function SubmenuLevel({
  item,
  anchor,
  onClose,
  onDone,
  focusFirst,
}: {
  item: MenuItem
  anchor: RefObject<HTMLDivElement | null>
  onClose: () => void
  onDone: () => void
  focusFirst: boolean
}) {
  return (
    <MenuLevel
      open
      focusFirst={focusFirst}
      onClose={onClose}
      onDone={onDone}
      anchor={anchor}
      label={item.label}
      back={item.label}
      items={item.submenu!.items}
      groupLabels={item.submenu!.groupLabels ?? {}}
    />
  )
}
