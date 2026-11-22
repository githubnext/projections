// React 19 wrappers for the VSCode Elements (@vscode-elements/elements, MIT) this UI uses: typed properties, typed
// events, refs to the element, and the registrations they need (importing this module defines the elements once).
import {createElement, useCallback, useEffect, useLayoutEffect, useRef} from 'react'
import type {HTMLAttributes, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, Ref, RefObject} from 'react'
import '@vscode-elements/elements/dist/vscode-badge/index.js'
import '@vscode-elements/elements/dist/vscode-button/index.js'
import '@vscode-elements/elements/dist/vscode-checkbox/index.js'
import '@vscode-elements/elements/dist/vscode-collapsible/index.js'
import '@vscode-elements/elements/dist/vscode-context-menu-item/index.js'
import '@vscode-elements/elements/dist/vscode-divider/index.js'
import '@vscode-elements/elements/dist/vscode-icon/index.js'
import '@vscode-elements/elements/dist/vscode-option/index.js'
import '@vscode-elements/elements/dist/vscode-progress-ring/index.js'
import '@vscode-elements/elements/dist/vscode-radio/index.js'
import '@vscode-elements/elements/dist/vscode-radio-group/index.js'
import '@vscode-elements/elements/dist/vscode-single-select/index.js'
import '@vscode-elements/elements/dist/vscode-tab-header/index.js'
import '@vscode-elements/elements/dist/vscode-tab-panel/index.js'
import '@vscode-elements/elements/dist/vscode-tabs/index.js'
import '@vscode-elements/elements/dist/vscode-table/index.js'
import '@vscode-elements/elements/dist/vscode-table-body/index.js'
import '@vscode-elements/elements/dist/vscode-table-cell/index.js'
import '@vscode-elements/elements/dist/vscode-table-header/index.js'
import '@vscode-elements/elements/dist/vscode-table-header-cell/index.js'
import '@vscode-elements/elements/dist/vscode-table-row/index.js'
import '@vscode-elements/elements/dist/vscode-textfield/index.js'
import '@vscode-elements/elements/dist/vscode-toolbar-button/index.js'
import '@vscode-elements/elements/dist/vscode-toolbar-container/index.js'
import '@vscode-elements/elements/dist/vscode-tree/index.js'
import '@vscode-elements/elements/dist/vscode-tree-item/index.js'
import type {VscodeBadge} from '@vscode-elements/elements/dist/vscode-badge/vscode-badge.js'
import type {VscodeButton} from '@vscode-elements/elements/dist/vscode-button/vscode-button.js'
import type {VscodeCheckbox} from '@vscode-elements/elements/dist/vscode-checkbox/vscode-checkbox.js'
import type {VscodeCollapsible} from '@vscode-elements/elements/dist/vscode-collapsible/vscode-collapsible.js'
import type {VscodeContextMenuItem} from '@vscode-elements/elements/dist/vscode-context-menu-item/vscode-context-menu-item.js'
import type {VscodeDivider} from '@vscode-elements/elements/dist/vscode-divider/vscode-divider.js'
import type {VscodeIcon} from '@vscode-elements/elements/dist/vscode-icon/vscode-icon.js'
import type {VscodeOption} from '@vscode-elements/elements/dist/vscode-option/vscode-option.js'
import type {VscodeProgressRing} from '@vscode-elements/elements/dist/vscode-progress-ring/vscode-progress-ring.js'
import type {VscodeRadio} from '@vscode-elements/elements/dist/vscode-radio/vscode-radio.js'
import type {VscodeRadioGroup} from '@vscode-elements/elements/dist/vscode-radio-group/vscode-radio-group.js'
import type {VscodeSingleSelect} from '@vscode-elements/elements/dist/vscode-single-select/vscode-single-select.js'
import type {VscodeTabHeader} from '@vscode-elements/elements/dist/vscode-tab-header/vscode-tab-header.js'
import type {VscodeTabPanel} from '@vscode-elements/elements/dist/vscode-tab-panel/vscode-tab-panel.js'
import type {VscodeTabs} from '@vscode-elements/elements/dist/vscode-tabs/vscode-tabs.js'
import type {VscodeTable} from '@vscode-elements/elements/dist/vscode-table/vscode-table.js'
import type {VscodeTableBody} from '@vscode-elements/elements/dist/vscode-table-body/vscode-table-body.js'
import type {VscodeTableCell} from '@vscode-elements/elements/dist/vscode-table-cell/vscode-table-cell.js'
import type {VscodeTableHeader} from '@vscode-elements/elements/dist/vscode-table-header/vscode-table-header.js'
import type {VscodeTableHeaderCell} from '@vscode-elements/elements/dist/vscode-table-header-cell/vscode-table-header-cell.js'
import type {VscodeTableRow} from '@vscode-elements/elements/dist/vscode-table-row/vscode-table-row.js'
import type {VscodeTextfield} from '@vscode-elements/elements/dist/vscode-textfield/vscode-textfield.js'
import type {VscodeToolbarButton} from '@vscode-elements/elements/dist/vscode-toolbar-button/vscode-toolbar-button.js'
import type {VscodeToolbarContainer} from '@vscode-elements/elements/dist/vscode-toolbar-container/vscode-toolbar-container.js'
import type {VscodeTree} from '@vscode-elements/elements/dist/vscode-tree/vscode-tree.js'
import type {VscodeTreeItem} from '@vscode-elements/elements/dist/vscode-tree-item/vscode-tree-item.js'

/** The VSCode Elements version this UI is built and tested with (pinned exactly; README "Decisions"). */
export const vscodeElementsVersion = '2.5.1'

type Handler<E extends Event> = (event: E) => void
/** Wrapper props: the element's own properties, its events as `on…` handlers, HTML attributes, children and a ref. */
export type ElementProps<T extends HTMLElement, P extends object, E extends Record<string, Event> = Record<never, Event>> = P & {
  [K in keyof E]?: Handler<E[K]> | undefined
} & Omit<HTMLAttributes<T>, keyof P | keyof E | 'children'> & {
    ref?: Ref<T> | undefined
    children?: ReactNode
    /** Any `data-*` attribute. */
    [data: `data-${string}`]: string | number | boolean | undefined
  }

/** Attaches `events` (event name → handler) to the element, always calling the latest handler. */
function useEvents(ref: RefObject<HTMLElement | null>, events: Record<string, Handler<Event> | undefined>) {
  const latest = useRef(events)
  useLayoutEffect(() => {
    latest.current = events
  })
  const names = Object.keys(events)
    .filter(name => events[name])
    .join(' ')
  useEffect(() => {
    const element = ref.current
    if (!element || !names) return
    const listeners = names.split(' ').map(name => [name, (event: Event) => latest.current[name]?.(event)] as const)
    for (const [name, listener] of listeners) element.addEventListener(name, listener)
    return () => {
      for (const [name, listener] of listeners) element.removeEventListener(name, listener)
    }
  }, [ref, names])
}

/** One ref callback that sets both refs. */
function useMergedRef<T>(own: RefObject<T | null>, other: Ref<T> | undefined) {
  return useCallback(
    (element: T | null) => {
      setRef(own, element)
      setRef(other, element)
    },
    [own, other],
  )
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

/**
 * A typed React wrapper for a custom element: React 19 sets the element's properties (and `class`, `style` and
 * attributes); `events` maps each `on…` prop to the DOM event it listens for on the element.
 */
export function createWrapper<T extends HTMLElement, P extends object, E extends Record<string, Event> = Record<never, Event>>(
  tag: string,
  events: {[K in keyof E]: string},
) {
  const eventProps = new Map(Object.entries(events) as [string, string][])
  function Wrapper({ref: outer, ...props}: ElementProps<T, P, E>) {
    const own = useRef<T>(null)
    const handlers: Record<string, Handler<Event> | undefined> = {}
    const rest: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(props)) {
      const event = eventProps.get(key)
      if (event) handlers[event] = value as Handler<Event> | undefined
      else rest[key] = value
    }
    useEvents(own, handlers)
    const ref = useMergedRef(own, outer)
    return createElement(tag, {...rest, ref})
  }
  Wrapper.displayName = tag
  return Wrapper
}

/** `vscode-icon`: a codicon by `name`, `size` in pixels; an `actionIcon` is focusable and fires `onVscClick`. */
export const VscIcon = createWrapper<
  VscodeIcon,
  {name: string; size?: number; spin?: boolean; actionIcon?: boolean; label?: string},
  {onVscClick: CustomEvent}
>('vscode-icon', {onVscClick: 'vsc-click'})
/**
 * `vscode-toolbar-button`, unpatched: a `toggleable` one flips `checked` itself and fires `onToggle` (its `change`).
 * Prefer `ActionButton`, which adds what the element lacks for accessibility.
 */
export const VscToolbarButton = createWrapper<
  VscodeToolbarButton,
  {icon?: string; label?: string; toggleable?: boolean; checked?: boolean; disabled?: boolean},
  {onToggle: Event}
>('vscode-toolbar-button', {onToggle: 'change'})
/** `vscode-toolbar-container`, the row that lays out toolbar buttons with VS Code's spacing. */
export const VscToolbarContainer = createWrapper<VscodeToolbarContainer, object>('vscode-toolbar-container', {})
/** `vscode-button`, a primary (or `secondary`) button with an optional codicon before or after its text. */
export const VscButton = createWrapper<
  VscodeButton,
  {secondary?: boolean; icon?: string; iconAfter?: string; disabled?: boolean; block?: boolean; type?: 'button' | 'submit' | 'reset'}
>('vscode-button', {})
/**
 * `vscode-single-select`, a dropdown of `VscOption` children. `onChange` fires when the user picks one; read the new
 * `value` from the event's target. A `combobox` also takes typed text, matched by `filter`.
 */
export const VscSingleSelect = createWrapper<
  VscodeSingleSelect,
  {
    value?: string
    label?: string
    disabled?: boolean
    combobox?: boolean
    filter?: 'contains' | 'fuzzy' | 'startsWith' | 'startsWithPerTerm'
    position?: 'above' | 'below'
  },
  {onChange: Event}
>('vscode-single-select', {onChange: 'change'})
/** `vscode-option`, one choice in a `VscSingleSelect`; its text content is the label, `description` the hint below. */
export const VscOption = createWrapper<VscodeOption, {value?: string; description?: string; selected?: boolean; disabled?: boolean}>(
  'vscode-option',
  {},
)
/** `vscode-textfield`, a text input: `onInput` fires on every keystroke, `onChange` when the edit is committed. */
export const VscTextfield = createWrapper<
  VscodeTextfield,
  {value?: string; label?: string; placeholder?: string; type?: 'text' | 'search'; disabled?: boolean},
  {onInput: InputEvent; onChange: Event}
>('vscode-textfield', {onInput: 'input', onChange: 'change'})
/** `vscode-checkbox`, a checkbox (or a switch, with `toggle`); `onChange` fires when the user flips it. */
export const VscCheckbox = createWrapper<
  VscodeCheckbox,
  {checked?: boolean; label?: string; toggle?: boolean; disabled?: boolean; value?: string},
  {onChange: Event}
>('vscode-checkbox', {onChange: 'change'})
/** `vscode-radio-group`, which lays out its `Radio` children and gives them arrow-key navigation. */
export const VscRadioGroup = createWrapper<VscodeRadioGroup, {variant?: 'horizontal' | 'vertical'}>('vscode-radio-group', {})
/** `vscode-radio`, unpatched; prefer `Radio`, which announces it to assistive technology as a radio. */
export const VscRadio = createWrapper<
  VscodeRadio,
  {checked?: boolean; label?: string; name?: string; value?: string; disabled?: boolean},
  {onChange: Event}
>('vscode-radio', {onChange: 'change'})
/** `vscode-badge`, a count or label pill; `variant` picks VS Code's counter styles. */
export const VscBadge = createWrapper<VscodeBadge, {variant?: 'default' | 'counter' | 'activity-bar-counter' | 'tab-header-counter'}>(
  'vscode-badge',
  {},
)
/** `vscode-progress-ring`, VS Code's indeterminate spinner. */
export const VscProgressRing = createWrapper<VscodeProgressRing, object>('vscode-progress-ring', {})
/** `vscode-divider`, a horizontal rule in VS Code's separator colour. */
export const VscDivider = createWrapper<VscodeDivider, object>('vscode-divider', {})
/** `vscode-context-menu-item`, one row of a menu: `label` and `keybinding`, or a `separator`. */
export const VscContextMenuItem = createWrapper<
  VscodeContextMenuItem,
  {label?: string; keybinding?: string; value?: string; separator?: boolean; selected?: boolean; disabled?: boolean}
>('vscode-context-menu-item', {})
/**
 * `vscode-tabs`, which pairs its `VscTabHeader` children (slot `header`) with its `VscTabPanel` children in order.
 * `onVscTabsSelect` reports the newly selected tab's zero-based `selectedIndex` in its `detail`.
 */
export const VscTabs = createWrapper<
  VscodeTabs,
  {selectedIndex?: number; panel?: boolean},
  {onVscTabsSelect: CustomEvent<{selectedIndex: number}>}
>('vscode-tabs', {onVscTabsSelect: 'vsc-tabs-select'})
/** `vscode-tab-header`, one tab's label in a `VscTabs`; give it `slot="header"`. */
export const VscTabHeader = createWrapper<VscodeTabHeader, {slot?: string}>('vscode-tab-header', {})
/** `vscode-tab-panel`, the content of the `VscTabHeader` at the same position in a `VscTabs`. */
export const VscTabPanel = createWrapper<VscodeTabPanel, object>('vscode-tab-panel', {})
/** `vscode-tree`, a tree of `VscTreeItem` children; `onVscTreeSelect` fires when the user selects an item. */
export const VscTree = createWrapper<VscodeTree, {indentGuides?: 'none' | 'onHover' | 'always'}, {onVscTreeSelect: CustomEvent}>(
  'vscode-tree',
  {onVscTreeSelect: 'vsc-tree-select'},
)
/** `vscode-tree-item`, one node of a `VscTree`: a `branch` with nested items, shown expanded when `open`. */
export const VscTreeItem = createWrapper<VscodeTreeItem, {open?: boolean; branch?: boolean}>('vscode-tree-item', {})
/** `vscode-table`, a data table; `columns` gives the initial column widths in order, in pixels or percentages. */
export const VscTable = createWrapper<
  VscodeTable,
  {columns?: string[]; zebra?: boolean; borderedRows?: boolean; compact?: boolean; resizable?: boolean}
>('vscode-table', {})
/** `vscode-table-header`, the header row group of a `VscTable`; give it `slot="header"`. */
export const VscTableHeader = createWrapper<VscodeTableHeader, {slot?: string}>('vscode-table-header', {})
/** `vscode-table-header-cell`, one column heading in a `VscTableHeader`. */
export const VscTableHeaderCell = createWrapper<VscodeTableHeaderCell, object>('vscode-table-header-cell', {})
/** `vscode-table-body`, the body row group of a `VscTable`; give it `slot="body"`. */
export const VscTableBody = createWrapper<VscodeTableBody, {slot?: string}>('vscode-table-body', {})
/** `vscode-table-row`, one row of a `VscTableBody`. */
export const VscTableRow = createWrapper<VscodeTableRow, object>('vscode-table-row', {})
/** `vscode-table-cell`, one cell of a `VscTableRow`; `columnLabel` labels it in the table's compact responsive view. */
export const VscTableCell = createWrapper<VscodeTableCell, {columnLabel?: string}>('vscode-table-cell', {})

const CollapsibleElement = createWrapper<
  VscodeCollapsible,
  {heading: string; description?: string | undefined; open?: boolean | undefined}
>('vscode-collapsible', {})

/**
 * `vscode-collapsible`, a sidebar view section with VS Code's header type and chevron, whose shadow header is also
 * exposed as a button with `aria-expanded` (the element draws a focusable header with no role).
 */
export function VscCollapsible({
  heading,
  description,
  open,
  onOpenChange,
  children,
  className,
  actions,
  ...rest
}: {
  heading: string
  description?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
  className?: string
  /** Header actions (VS Code shows them on hover and focus), for example toolbar buttons. */
  actions?: ReactNode
  [data: `data-${string}`]: string | undefined
}) {
  const ref = useRef<VscodeCollapsible>(null)
  const latest = useRef(onOpenChange)
  useLayoutEffect(() => {
    latest.current = onOpenChange
  })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const label = () => {
      const header = element.shadowRoot?.querySelector('.collapsible-header')
      if (!header) return
      header.setAttribute('role', 'button')
      header.setAttribute('aria-expanded', String(element.open))
    }
    void element.updateComplete.then(label)
    const toggle = (event: Event) => {
      latest.current?.((event as CustomEvent<{open: boolean}>).detail.open)
      void element.updateComplete.then(label)
    }
    element.addEventListener('vsc-collapsible-toggle', toggle)
    return () => element.removeEventListener('vsc-collapsible-toggle', toggle)
  }, [open])
  return (
    <CollapsibleElement ref={ref} heading={heading} description={description} open={open} className={className} {...rest}>
      {actions ? (
        <div slot="actions" className="phv-collapsible-actions">
          {actions}
        </div>
      ) : null}
      {children}
    </CollapsibleElement>
  )
}

/** Focuses a control: a VSCode Element's inner control when its shadow root doesn't delegate focus, else the element. */
export function focusControl(element: Element | null | undefined): boolean {
  if (!(element instanceof HTMLElement)) return false
  const inner = element.shadowRoot?.querySelector<HTMLElement>('button, input, [tabindex="0"], [role="combobox"]')
  ;(inner && !element.shadowRoot?.delegatesFocus ? inner : element).focus()
  return true
}

/** The deepest focused element, through open shadow roots. */
export function deepActiveElement(root: Document | ShadowRoot = document): Element | null {
  let active = root.activeElement
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
  return active
}

/**
 * Runs `patch` on the element's shadow root once the element has rendered, after every render of the calling
 * component: for what a VSCode Element doesn't expose, such as a disabled or radio toolbar button.
 */
export function useShadowPatch<T extends HTMLElement & {updateComplete?: Promise<unknown>}>(
  ref: RefObject<T | null>,
  patch: (root: ShadowRoot, element: T) => void,
) {
  const latest = useRef(patch)
  useLayoutEffect(() => {
    latest.current = patch
    const element = ref.current
    if (!element) return
    const apply = () => element.shadowRoot && latest.current(element.shadowRoot, element)
    apply()
    void (element.updateComplete ?? Promise.resolve()).then(apply)
  })
}

/** The props of `ActionButton`: `pressed` for a toggle or `checked` for a choice, never both. */
export interface ActionButtonProps {
  /** The codicon, for example `gear`. */
  icon: string
  /** The accessible name, and the hover's text unless `title` differs. */
  label: string
  title?: string | undefined
  disabled?: boolean | undefined
  /** A two-state action, for example a filter that applies (`aria-pressed`). */
  pressed?: boolean | undefined
  /** A choice among actions, for example a comparison mode (`role="radio"` and `aria-checked`). */
  checked?: boolean | undefined
  /** The popup the action opens: its button gets `aria-haspopup` and `aria-expanded`. */
  popup?: 'menu' | 'dialog' | 'listbox' | undefined
  expanded?: boolean | undefined
  /** `-1` takes the action out of the tab order, for a roving group. */
  tabIndex?: number | undefined
  onClick?: ((event: ReactMouseEvent<HTMLElement>) => void) | undefined
  onKeyDown?: ((event: ReactKeyboardEvent<HTMLElement>) => void) | undefined
  className?: string | undefined
  ref?: Ref<VscodeToolbarButton> | undefined
  /** Visible text after the icon, for example a revision pair. */
  children?: ReactNode
  [data: `data-${string}`]: string | number | boolean | undefined
}

/**
 * A VS Code action bar button: `vscode-toolbar-button` with its codicon, hover and active backgrounds and focus
 * outline. Its shadow `button` gets what the element lacks: `disabled`, `aria-pressed`, a radio role for a choice
 * (with the checked look), `aria-haspopup` and `aria-expanded`, and a tab index for roving focus.
 */
export function ActionButton({
  icon,
  label,
  title,
  disabled = false,
  pressed,
  checked,
  popup,
  expanded,
  tabIndex,
  onClick,
  onKeyDown,
  className,
  ref,
  children,
  ...data
}: ActionButtonProps) {
  const own = useRef<VscodeToolbarButton>(null)
  const merged = useMergedRef(own, ref)
  const choice = checked !== undefined
  const controlled = choice || pressed !== undefined
  useShadowPatch(own, root => {
    const button = root.querySelector('button')
    if (!button) return
    button.disabled = disabled
    const set = (name: string, value: string | undefined) =>
      value === undefined ? button.removeAttribute(name) : button.getAttribute(name) !== value && button.setAttribute(name, value)
    set('role', choice ? 'radio' : undefined)
    set('aria-checked', choice ? String(checked) : undefined)
    set('aria-pressed', pressed === undefined ? undefined : String(pressed))
    set('aria-haspopup', popup)
    set('aria-expanded', popup ? String(Boolean(expanded)) : undefined)
    set('tabindex', tabIndex === undefined ? undefined : String(tabIndex))
  })
  // The element flips `checked` itself when a toggleable button is pressed; a choice stays as its owner says.
  useEffect(() => {
    const element = own.current
    if (!element || !controlled) return
    const keep = () => {
      element.checked = Boolean(checked ?? pressed)
    }
    element.addEventListener('change', keep)
    return () => element.removeEventListener('change', keep)
  }, [controlled, checked, pressed])
  return createElement(
    'vscode-toolbar-button',
    {
      ref: merged,
      icon,
      label,
      title: title ?? label,
      toggleable: controlled,
      checked: Boolean(checked ?? pressed),
      class: `phv-action ${className ?? ''}`,
      'data-disabled': disabled || undefined,
      onClick: disabled ? undefined : onClick,
      onKeyDown,
      ...data,
    },
    children,
  )
}

/**
 * `vscode-radio`, whose shadow input (a checkbox underneath) is exposed as the radio it draws: `role="radio"`, so
 * assistive technology announces a choice, not a checkbox.
 */
export function Radio({
  ref: outer,
  ...props
}: ElementProps<VscodeRadio, {checked?: boolean; label?: string; name?: string; value?: string; disabled?: boolean}, {onChange: Event}>) {
  const own = useRef<VscodeRadio>(null)
  const ref = useMergedRef(own, outer)
  useShadowPatch(own, root => {
    const input = root.querySelector('input')
    if (input && input.getAttribute('role') !== 'radio') input.setAttribute('role', 'radio')
  })
  return <VscRadio {...props} ref={ref} />
}
