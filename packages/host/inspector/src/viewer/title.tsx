import {useId, useRef, useState} from 'react'
import {ChevronDown} from 'lucide-react'
import {SwitcherPopup} from '../shell/switcher.js'
import type {SwitcherItem} from '../shell/switcher.js'

/**
 * The viewer header's title, which is also the menu of the repository's projections: choosing one shows it in this
 * page's viewer (`view/choose`), as if the agent had shown it. It reads as the title, not a button: no fill or border
 * at rest, a small chevron after the text, a faint wash on hover and while open, and the focus ring for the keyboard
 * (styles.css). It opens the Inspector's own projection switcher popup from its start (Enter, Space, Arrow Down or a
 * click): a search by title or ID over the list, the current one checked. With fewer than two projections, or while
 * the page has lost its server, it is the title alone.
 */
export function ViewerTitle({
  title,
  current,
  projections,
  colorMode,
  onChoose,
}: {
  title: string
  current: string | undefined
  projections: readonly SwitcherItem[]
  colorMode: 'light' | 'dark'
  /** Shows another projection; absent while nothing can reach the server. */
  onChoose: ((id: string) => void) | undefined
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
  return (
    <>
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
          onClose={() => setOpen(false)}
          onChoose={chosen => {
            setOpen(false)
            if (chosen !== menu.current) menu.onChoose(chosen)
          }}
        />
      )}
    </>
  )
}
