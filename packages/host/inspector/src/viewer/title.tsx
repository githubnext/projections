import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react'
import {ChevronDown} from 'lucide-react'
import {SwitcherPopup, type SwitcherItem} from '../shell/switcher.js'

/**
 * The viewer header's title, which is also the menu of the repository's projections: choosing one shows it in this
 * page's viewer (`view/choose`), as if the agent had shown it. It reads as the title, not a button: no fill or border
 * at rest, a small chevron after the text, a faint wash on hover and while open, and the focus ring for the keyboard
 * (styles.css). It opens the Inspector's own projection switcher popup from its start (Enter, Space, Arrow Down or a
 * click): a search by title or ID over the list, the current one checked, then "Pin projections pane" (`onPin`),
 * which turns the list into a pane beside the stage (viewer/pane.tsx). With fewer than two projections, the pane
 * pinned, or while the page has lost its server, it is the title alone. `focus` moves focus to it once the pane closes;
 * a menu that goes away while it holds focus (the pane pinned again as the page widens) says so (`onMenuGone`).
 */
export function ViewerTitle({
  title,
  current,
  projections,
  colorMode,
  onChoose,
  onPin,
  focus = false,
  onFocused,
  menuFocused = false,
  onMenuFocus,
  onMenuGone,
}: {
  title: string
  current: string | undefined
  projections: readonly SwitcherItem[]
  colorMode: 'light' | 'dark'
  /** Shows another projection; absent while nothing can reach the server, or while the pane lists them. */
  onChoose: ((id: string) => void) | undefined
  /** Pins the projections pane; absent where it wouldn't fit. */
  onPin?: (() => void) | undefined
  /** Takes focus (once the pane closes), then says so (`onFocused`). */
  focus?: boolean
  onFocused?: () => void
  /** Whether the menu (its trigger or popup) holds focus, as `onMenuFocus` last said. */
  menuFocused?: boolean
  /** Focus came into the menu (`true`) or left it (`false`). */
  onMenuFocus?: ((inside: boolean) => void) | undefined
  /** The menu went away while it held focus; `lost`: focus was left on the page. */
  onMenuGone?: ((lost: boolean) => void) | undefined
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const text = (
    <span className="pi-viewer-title pi-viewer-text pj:min-w-0 pj:truncate pj:font-semibold" title={title}>
      {title}
    </span>
  )
  const menu = onChoose && current && projections.length > 1 ? {onChoose, current} : undefined
  const hasMenu = Boolean(menu)
  // A menu that goes away (the pane pinned again as the page widens) closes, so it doesn't reopen when it comes back.
  useEffect(() => {
    if (!hasMenu) setOpen(false)
  }, [hasMenu])
  const slot = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (hasMenu || !menuFocused) return
    onMenuGone?.(!document.activeElement || document.activeElement === document.body)
  }, [hasMenu, menuFocused, onMenuGone])
  useEffect(() => {
    if (!focus || !hasMenu) return
    trigger.current?.focus()
    onFocused?.()
  }, [focus, hasMenu, onFocused])
  return (
    // Whether the menu holds focus, so that if it goes away with focus (which leaves it on the page) it says so.
    <div
      ref={slot}
      className="pi-viewer-title-slot pj:contents"
      onFocus={() => {
        if (!menuFocused) onMenuFocus?.(true)
      }}
      onBlur={event => {
        if (!slot.current?.contains(event.relatedTarget as Node | null)) onMenuFocus?.(false)
      }}
    >
      <h1 className="pj:m-0 pj:flex pj:min-w-0 pj:flex-1 pj:items-center pj:text-[13px] pj:font-normal">
        {menu ? (
          <button
            ref={trigger}
            type="button"
            className="pi-viewer-title-menu"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? `${id}-dialog` : undefined}
            aria-label={`${title}, switch projection`}
            data-state={open ? 'open' : 'closed'}
            onClick={() => setOpen(value => !value)}
            onKeyDown={event => {
              if (event.key === 'ArrowDown' && !open) {
                event.preventDefault()
                setOpen(true)
              }
            }}
          >
            {text}
            <ChevronDown aria-hidden="true" className="pi-viewer-chevron" />
          </button>
        ) : (
          text
        )}
      </h1>
      {menu && open && (
        <SwitcherPopup
          id={`${id}-dialog`}
          items={projections}
          current={menu.current}
          trigger={trigger}
          colorMode={colorMode}
          align="start"
          onPin={
            onPin &&
            (() => {
              setOpen(false)
              onPin()
            })
          }
          onClose={() => setOpen(false)}
          onChoose={chosen => {
            setOpen(false)
            if (chosen !== menu.current) menu.onChoose(chosen)
          }}
        />
      )}
    </div>
  )
}
