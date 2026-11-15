import {useCallback, useEffect, useMemo, useState} from 'react'
import type {ReactNode} from 'react'
import {ScopedRoot, cn} from '@githubnext/projections-host/ui/components'
import {CommandPalette} from './palette.js'
import type {Command} from './palette.js'
import {isMac, shortcutLabel} from './controls.js'
import {BottomPanel, SecondarySidebar, Sidebar, clamp, limits, useLayout, useNarrow} from './layout.js'
import type {PanelTab} from './layout.js'
import {StatusBar} from './status-bar.js'
import {TitleBar} from './title-bar.js'

export type {Command} from './palette.js'
export type {PanelTab} from './layout.js'
export {iconButton, shortcutLabel} from './controls.js'
export {StatusItem} from './status-bar.js'
export {TitleActivity, TitleFileButton, TitleSettings, TitleSpacer, relativeTime, titleLevel, useTitleBar} from './title-bar.js'
export type {PickerOption} from './title-bar.js'

export interface ShellProps {
  colorMode: 'light' | 'dark'
  /**
   * The title bar's centre: the document title, for example the projection switcher. It stays centred in the window
   * while the sides have room, and truncates (with its whole text as a tooltip) before anything else collapses.
   */
  center?: ReactNode
  /**
   * Title bar content on the right: the status line (`TitleActivity`), actions (`TitleFileButton`) and the Settings
   * menu (`TitleSettings`). It renders twice: in the bar, and in More once the bar overflows; each item draws itself
   * in one place (see `useTitleBar`).
   */
  title: ReactNode
  /** What the title bar holds, for example the chosen projection: measured layouts are kept until it changes. */
  titleKey?: string
  /** Accessible name of the sidebar, for example `Revisions` or `Scenarios`. */
  sidebarLabel: string
  sidebar: ReactNode
  /**
   * A docked panel on the right of the stage (like an editor's secondary side bar), for example the Inspector's
   * Details: toggled from the title bar and with ⌥⌘B / Ctrl+Alt+B, resizable, its visibility and width remembered,
   * and a sheet below the drawer width.
   */
  secondary?: {label: string; content: ReactNode; actions?: ReactNode} | undefined
  /** The content being developed. It gets all remaining space. */
  children: ReactNode
  panelTabs: readonly PanelTab[]
  panelTab: string
  onPanelTab: (id: string) => void
  /** Opens the panel at a tab, for example Diagnostics after a failed extraction. A new `at` opens it again. */
  panelRequest?: {tab: string; at: number} | undefined
  status: ReactNode
  commands: readonly Command[]
  /** Whether the sidebar starts open, until someone toggles it (default: open). */
  defaultSidebar?: boolean
  className?: string
  [data: `data-${string}`]: string | number | boolean | undefined
}

/**
 * The Inspector workbench: a full-viewport utility layout like an editor's, of rounded cards on a gutter. The title
 * bar (its document title centred) and the status bar sit on the gutter; between them float a resizable, collapsible
 * sidebar card, the main view (whose content is a card of its own, one gutter in), an optional docked card on the
 * right, and a resizable bottom panel card with tabs. Resize handles lie in the gutters. There is a command palette
 * (⌘K / Ctrl+K); ⌘B / Ctrl+B toggles the sidebar, ⌘J / Ctrl+J the panel and ⌥⌘B / Ctrl+Alt+B the docked card. Below
 * the drawer width the sidebar and docked card are sheets over the view.
 */
export function Shell({
  colorMode,
  center,
  title,
  sidebarLabel,
  sidebar,
  secondary,
  children,
  panelTabs,
  panelTab,
  onPanelTab,
  panelRequest,
  status,
  commands,
  className,
  titleKey = '',
  defaultSidebar,
  ...data
}: ShellProps) {
  const [layout, update] = useLayout(sidebarLabel, defaultSidebar)
  const narrow = useNarrow()
  const [palette, setPalette] = useState(false)
  const toggleSidebar = useCallback(() => update({sidebar: !layout.sidebar}), [update, layout.sidebar])
  const togglePanel = useCallback(() => update({panel: !layout.panel}), [update, layout.panel])
  const toggleSecondary = useCallback(() => update({secondary: !layout.secondary}), [update, layout.secondary])
  const showPanel = useCallback(
    (tab: string) => {
      onPanelTab(tab)
      update({panel: true})
    },
    [onPanelTab, update],
  )

  useEffect(() => {
    if (panelRequest) showPanel(panelRequest.tab)
    // Only a new request opens the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelRequest?.at])

  const secondaryName = secondary ? `${layout.secondary ? 'Hide' : 'Show'} ${secondary.label.toLowerCase()} panel` : ''
  const all = useMemo<Command[]>(
    () => [
      ...commands,
      {
        id: 'view.sidebar',
        group: 'View',
        label: `${layout.sidebar ? 'Hide' : 'Show'} ${sidebarLabel.toLowerCase()} sidebar`,
        shortcut: shortcutLabel('b'),
        run: toggleSidebar,
      },
      {id: 'view.panel', group: 'View', label: `${layout.panel ? 'Hide' : 'Show'} panel`, shortcut: shortcutLabel('j'), run: togglePanel},
      ...(secondary
        ? [
            {
              id: 'view.secondary',
              group: 'View',
              label: secondaryName,
              keywords: 'docked right side bar',
              shortcut: shortcutLabel('b', {alt: true}),
              run: toggleSecondary,
            },
          ]
        : []),
      ...panelTabs.map(tab => ({id: `panel.${tab.id}`, group: 'Panel', label: `Show ${tab.label}`, run: () => showPanel(tab.id)})),
    ],
    [
      commands,
      layout.sidebar,
      sidebarLabel,
      toggleSidebar,
      layout.panel,
      togglePanel,
      secondary,
      secondaryName,
      toggleSecondary,
      panelTabs,
      showPanel,
    ],
  )

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!(isMac ? event.metaKey : event.ctrlKey) || event.shiftKey) return
      // With Alt, `key` is a composed character (⌥B is ∫ on a Mac): the physical key names the letter.
      const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase()
      if (key === 'k' && !event.altKey) {
        event.preventDefault()
        setPalette(open => !open)
        return
      }
      const pressed = shortcutLabel(key, {alt: event.altKey})
      const command = all.find(item => item.shortcut === pressed && !item.disabled)
      if (command) {
        event.preventDefault()
        command.run()
      }
    }
    addEventListener('keydown', listener)
    return () => removeEventListener('keydown', listener)
  }, [all])

  const active = panelTabs.find(tab => tab.id === panelTab) ?? panelTabs[0]
  return (
    <ScopedRoot colorMode={colorMode} className={cn('pi pi-shell', className)} {...data}>
      <div className="pi-frame pj:flex pj:h-dvh pj:w-full pj:flex-col pj:overflow-hidden pj:bg-background pj:text-foreground">
        <TitleBar
          center={center}
          title={title}
          titleKey={titleKey}
          sidebarLabel={sidebarLabel}
          layout={layout}
          secondary={secondary}
          secondaryName={secondaryName}
          toggleSidebar={toggleSidebar}
          togglePanel={togglePanel}
          toggleSecondary={toggleSecondary}
          onPalette={() => setPalette(true)}
        />
        <div className="pi-body pj:relative pj:flex pj:min-h-0 pj:flex-1">
          {layout.sidebar && (
            <Sidebar
              label={sidebarLabel}
              narrow={narrow}
              width={layout.sidebarWidth}
              onResize={value => update({sidebarWidth: clamp(value, limits.sidebar)})}
              onClose={toggleSidebar}
            >
              {sidebar}
            </Sidebar>
          )}
          <div className="pi-center pj:relative pj:flex pj:min-w-0 pj:flex-1 pj:flex-col">
            <main className="pi-main pj:relative pj:flex pj:min-h-0 pj:flex-1 pj:flex-col pj:overflow-auto">{children}</main>
            {layout.panel && active && (
              <BottomPanel
                tabs={panelTabs}
                active={active}
                narrow={narrow}
                height={layout.panelHeight}
                onResize={value => update({panelHeight: clamp(value, limits.panel)})}
                onTab={onPanelTab}
                onClose={togglePanel}
              />
            )}
          </div>
          {secondary && layout.secondary && (
            <SecondarySidebar
              label={secondary.label}
              actions={secondary.actions}
              narrow={narrow}
              width={layout.secondaryWidth}
              onResize={value => update({secondaryWidth: clamp(value, limits.secondary)})}
              onClose={toggleSecondary}
            >
              {secondary.content}
            </SecondarySidebar>
          )}
        </div>
        <StatusBar>{status}</StatusBar>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={all} colorMode={colorMode} />
    </ScopedRoot>
  )
}
