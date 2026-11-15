import {useRef, useState} from 'react'
import type {ReactNode, RefObject} from 'react'
import type {VscodeToolbarButton} from '@vscode-elements/elements/dist/vscode-toolbar-button/vscode-toolbar-button.js'
import {ActionButton} from './elements.js'
import {Overlay} from './overlay/overlay.js'

/**
 * Opens a widget or menu from somewhere other than its own action, for example the overflow menu: no action is drawn,
 * it anchors to `anchorRef` and returns focus there when it closes.
 */
export interface PopoverControl {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef: RefObject<HTMLElement | null>
}

/**
 * An action bar button that opens a widget (VS Code's editor widget: Filter, About); Escape and a press outside close it
 * and return focus to the button.
 */
export function ToolbarPopover({
  icon,
  label,
  title,
  children,
  className,
  active = false,
  initialFocus,
  control,
  focusId,
}: {
  icon: string
  /** The button's accessible name. */
  label: string
  /** The widget's accessible name. */
  title: string
  children: ReactNode
  className: string
  /** Marks the button, for example while a filter applies (`data-active`). */
  active?: boolean
  initialFocus?: RefObject<Element | null>
  control?: PopoverControl | undefined
  /** `data-focus-id`, so focus follows the control when the toolbar's layout changes. */
  focusId?: string
}) {
  const [own, setOwn] = useState(false)
  const button = useRef<VscodeToolbarButton>(null)
  const open = control ? control.open : own
  const setOpen = control ? control.onOpenChange : setOwn
  const overlay = (
    <Overlay
      open={open}
      onClose={() => setOpen(false)}
      anchor={control ? control.anchorRef : button}
      role="dialog"
      label={title}
      className={`phv-widget ${className}-popover`}
      initialFocus={initialFocus}
    >
      {children}
    </Overlay>
  )
  if (control) return overlay
  return (
    <span className={`phv-popover-anchor ${className}`} data-active={active || undefined}>
      <ActionButton
        ref={button}
        icon={icon}
        label={label}
        popup="dialog"
        expanded={open}
        onClick={() => setOpen(!open)}
        data-focus-id={focusId}
        data-icon={icon}
      />
      {overlay}
    </span>
  )
}
