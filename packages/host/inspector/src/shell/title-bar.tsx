import {createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState} from 'react'
import type {ReactNode, RefObject} from 'react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Toolbar,
  ToolbarButton,
  cn,
  fitWidth,
  useFitPlan,
} from '@githubnext/projections-host/ui/components'
import {Ellipsis, Monitor, Moon, PanelBottom, PanelLeft, PanelRight, Settings, Sun} from 'lucide-react'
import {shortcutLabel} from './controls.js'
import type {Layout} from './layout.js'
import type {ThemePreference} from './theme.js'

/**
 * How condensed the title bar is. It is planned from its own width (`useFitPlan`), never wrapped or clipped: each
 * level collapses one more thing, in priority order, and the bar shows the lowest level that fits. Items read the
 * level with `useTitleBar` and draw the matching form.
 */
export const titleLevel = {
  /** Everything inline, labeled. */
  full: 0,
  /** "Commands" keeps only its shortcut. */
  commandsText: 1,
  /** Open becomes an icon. */
  actionIcons: 2,
  /** The "Projections Inspector" mark is visually hidden. */
  titleText: 3,
  /** The status line is visually hidden (it stays a live region), so the centred document title keeps its room. */
  statusText: 4,
  /** Open and Commands move into More. The Settings gear, already an icon, stays in the bar. */
  overflow: 5,
} as const
const titleLevels = [0, 1, 2, 3, 4, 5] as const

/** Where a title-bar item renders: in the bar, or in its More popover. */
interface TitleBarState {
  level: number
  place: 'bar' | 'more'
}
const TitleBarContext = createContext<TitleBarState>({level: 0, place: 'bar'})
/** The title bar's level and where the calling item renders. */
export const useTitleBar = () => useContext(TitleBarContext)

/** How long ago `at` was, in words that stay short: "just now", "12 s ago", "3 min ago", "2 h ago". */
export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds} s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  return `${Math.floor(seconds / 3600)} h ago`
}

/**
 * The title bar's one-line status: what the Inspector is showing and what just happened, in plain words, for
 * example "Watching the working tree · re-extracted 3 s ago (`extract.py` changed)". It takes the bar's spare room
 * and truncates, with the whole line as its tooltip. It is a polite live region; the relative time updates every few
 * seconds but is hidden from assistive technology (which gets the clock time instead), so it isn't re-announced.
 */
export function TitleActivity({
  kind,
  plain,
  children,
  at,
  verb,
  reason,
  ...data
}: {
  /** What it says, for styling and tests: `reading`, `watching`, `extracting`, `failed`, `artifact`, … */
  kind: string
  /** The whole line as text, its tooltip. */
  plain: string
  children: ReactNode
  /** When `verb` happened, shown as a relative time after the message. */
  at?: number | undefined
  verb?: string | undefined
  /** Why, after the time, for example "(`extract.py` changed)". */
  reason?: ReactNode
} & {[key: `data-${string}`]: string | boolean | undefined}) {
  const {level, place} = useTitleBar()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (at === undefined) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [at])
  if (place !== 'bar') return null
  return (
    <span
      role="status"
      aria-live="polite"
      title={plain}
      data-toolbar-region="status"
      data-activity={kind}
      {...(level >= titleLevel.statusText ? {} : {'data-fit-min': '120', style: {minWidth: 120}})}
      className={cn(
        'pi-activity pj:min-w-0 pj:text-right pj:text-xs pj:text-muted-foreground',
        level >= titleLevel.statusText ? 'pj:sr-only' : 'pj:relative pj:flex-1 pj:truncate pj:px-1.5',
      )}
      {...data}
    >
      {children}
      {at !== undefined && verb && (
        <>
          {' · '}
          {verb} <span aria-hidden="true">{relativeTime(at, now)}</span>
          <span className="pj:sr-only">at {new Date(at).toLocaleTimeString()}</span>
        </>
      )}
      {reason && <> {reason}</>}
    </span>
  )
}

/**
 * A title-bar file button ("Open"): the file input (named `name`) lies over its face, so it is the control itself
 * and stays mounted for keyboard shortcuts and tests. From `titleLevel.actionIcons` it shows the icon alone; from
 * `titleLevel.overflow` More holds a button of the same name that opens the input.
 */
export function TitleFileButton({
  icon,
  label,
  name,
  title,
  accept,
  busy,
  inputRef,
  onFile,
}: {
  icon: ReactNode
  label: string
  name: string
  title: string
  accept: string
  busy?: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onFile: (file: File | undefined) => void
}) {
  const {level, place} = useTitleBar()
  const hidden = level >= titleLevel.overflow
  if (place === 'more')
    return hidden ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="pj:justify-start"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {icon}
        {name}
      </Button>
    ) : null
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      aria-label={name}
      disabled={busy}
      {...(hidden ? {tabIndex: -1} : {})}
      className={hidden ? 'pj:sr-only' : 'pj:absolute pj:inset-0 pj:size-full pj:cursor-pointer pj:opacity-0'}
      onChange={event => onFile(event.target.files?.[0])}
    />
  )
  if (hidden) return input
  const iconOnly = level >= titleLevel.actionIcons
  return (
    <span
      title={title}
      data-toolbar-region="open"
      className={cn(
        'pi-file-button pj:relative pj:inline-flex pj:overflow-hidden pj:h-8 pj:shrink-0 pj:items-center pj:justify-center pj:gap-1.5 pj:rounded-md pj:text-xs pj:font-medium pj:text-muted-foreground pj:transition-colors pj:hover:bg-accent pj:hover:text-foreground pj:has-[input:focus-visible]:ring-3 pj:has-[input:focus-visible]:ring-ring/50 pj:[&_svg]:size-4 pj:[&_svg]:shrink-0',
        iconOnly ? 'pj:w-8' : 'pj:px-2',
        busy && 'pj:opacity-50',
      )}
    >
      {icon}
      {!iconOnly && <span aria-hidden="true">{label}</span>}
      <ToolbarButton asChild disabled={busy}>
        {input}
      </ToolbarButton>
    </span>
  )
}

/** The narrowest the centred title may get before the bar collapses something else, and the widest it asks for. */
const centerMin = 96
const centerWant = 200

/**
 * While a person is using the title bar (focus in it, or in a popover or menu it opened), the levels that keep the
 * control in their hands mounted: Open, Commands and the panel toggles are in the bar below `overflow`, More only at
 * it; the other levels only restyle. A new status replans the bar (its `titleKey` changes), which would otherwise try
 * the full level first and remount, unfocusing, the control under the keyboard.
 */
function titleLock(bar: HTMLElement, level: number): ((candidate: number) => boolean) | undefined {
  const active = bar.ownerDocument.activeElement
  if (!active || active === bar.ownerDocument.body) return undefined
  const popover = active.closest('[role="dialog"], [role="menu"]')
  const opener = popover?.id ? bar.querySelector(`[aria-controls="${CSS.escape(popover.id)}"]`) : null
  if (!bar.contains(active) && !opener) return undefined
  const overflow = level >= titleLevel.overflow
  return candidate => candidate >= titleLevel.overflow === overflow
}

/** One choice of a title-bar picker. */
export interface PickerOption {
  value: string
  label: string
}

/** The theme choices in the Settings menu. */
const themeChoices: readonly {value: ThemePreference; label: string; icon: ReactNode}[] = [
  {value: 'auto', label: 'System', icon: <Monitor />},
  {value: 'light', label: 'Light', icon: <Sun />},
  {value: 'dark', label: 'Dark', icon: <Moon />},
]

/**
 * The title bar's Settings menu: an icon-only gear button (named "Settings", with a tooltip) that opens a shadcn
 * `DropdownMenu` of app-level preferences, today the Theme as a radio group. It is a toolbar item, so it takes part in
 * the bar's roving focus; Enter, Space or Arrow Down opens it, the arrows move between items, Enter or Space chooses
 * and Escape closes it, returning focus to the gear. Already an icon, it stays in the bar at every level.
 */
export function TitleSettings({
  theme,
  onTheme,
  definition,
}: {
  theme: ThemePreference
  onTheme: (value: ThemePreference) => void
  /**
   * The advanced "Definition from" choice: the revision whose projection definition every extraction applies. It is
   * the "Advanced" group's radio group, scrolling within the menu when the history is long.
   */
  definition?: {value: string; options: readonly PickerOption[]; onChange: (value: string) => void; disabled?: boolean} | undefined
}) {
  const {place} = useTitleBar()
  const id = useId()
  if (place !== 'bar') return null
  return (
    <DropdownMenu>
      <ToolbarButton asChild>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="pi-settings pj:text-muted-foreground pj:hover:text-foreground pj:data-[state=open]:bg-accent pj:data-[state=open]:text-foreground"
            aria-label="Settings"
            title="Settings"
            data-toolbar-region="settings"
          >
            <Settings />
          </Button>
        </DropdownMenuTrigger>
      </ToolbarButton>
      <DropdownMenuContent align="end" collisionPadding={8} className={cn('pi-settings-menu', definition ? 'pj:w-64' : 'pj:w-44')}>
        <DropdownMenuLabel id={`${id}-theme`}>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup aria-labelledby={`${id}-theme`} value={theme} onValueChange={value => onTheme(value as ThemePreference)}>
          {themeChoices.map(choice => (
            <DropdownMenuRadioItem key={choice.value} value={choice.value} className="pj:py-1 pj:text-xs pj:[&_svg]:text-muted-foreground">
              {choice.icon}
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {definition && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel id={`${id}-advanced`}>Advanced · Definition from</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              aria-label="Definition from"
              value={definition.value}
              onValueChange={definition.onChange}
              className="pi-definition-from pj:max-h-48 pj:overflow-y-auto"
            >
              {definition.options.map(option => (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  disabled={definition.disabled}
                  className="pj:py-1 pj:text-xs"
                  title={`Definition from: ${option.label}`}
                >
                  <span className="pj:block pj:min-w-0 pj:truncate">{option.label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A flexible space between the title bar's groups. */
export const TitleSpacer = () => <span aria-hidden="true" data-fit-min="0" className="pj:flex-1" />

/**
 * The workbench's title bar: the sidebar toggle and the "Projections Inspector" mark, the document title (`center`)
 * centred in the window, and on the right the `title` items, the command palette and the panel toggles. It condenses
 * by `titleLevel` to fit its width, the last level moving actions into More.
 */
export function TitleBar({
  center,
  title,
  titleKey,
  sidebarLabel,
  layout,
  secondary,
  secondaryName,
  toggleSidebar,
  togglePanel,
  toggleSecondary,
  onPalette,
}: {
  center?: ReactNode
  title: ReactNode
  titleKey: string
  sidebarLabel: string
  layout: Pick<Layout, 'sidebar' | 'panel' | 'secondary'>
  secondary: {label: string} | undefined
  secondaryName: string
  toggleSidebar: () => void
  togglePanel: () => void
  toggleSecondary: () => void
  onPalette: () => void
}) {
  const bar = useRef<HTMLDivElement>(null)
  // The title bar is three columns, its centre centred in the window: each side needs room for the wider side's
  // content, which this sets before `useFitPlan` (below) measures the bar, so a plan fits only when it stays centred.
  useLayoutEffect(() => {
    const element = bar.current
    if (!element) return
    const [start, middle, end] = [...element.children] as HTMLElement[]
    const row = (column: HTMLElement | undefined) => (column?.firstElementChild ? fitWidth(column.firstElementChild) : 0)
    const side = Math.ceil(Math.max(row(start), row(end)))
    for (const column of [start, end]) column?.setAttribute('data-fit-min', String(side))
    element.style.setProperty('--pi-side', `${side}px`)
    const label = middle?.querySelector<HTMLElement>('.pi-switcher-title, [data-center-title]')
    const control = label?.closest<HTMLElement>('button, [data-center]') ?? label
    const natural = control && label ? control.offsetWidth - label.clientWidth + label.scrollWidth : 0
    middle?.setAttribute('data-fit-min', String(Math.min(centerWant, Math.max(centerMin, Math.ceil(natural)))))
  })
  const {plan: level} = useFitPlan(bar, titleLevels, {key: titleKey, lock: titleLock})
  const [more, setMore] = useState(false)
  const toggle = (name: string, pressed: boolean, tip: string, icon: ReactNode, run: () => void) => (
    <ToolbarButton asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="pj:text-muted-foreground pj:hover:text-foreground pj:aria-pressed:text-foreground"
        aria-label={name}
        aria-pressed={pressed}
        title={tip}
        onClick={run}
      >
        {icon}
      </Button>
    </ToolbarButton>
  )
  // In More (the bar's last level), the panel toggles are menu buttons of the same names with their shortcuts.
  const moreToggle = (name: string, pressed: boolean, shortcut: string, run: () => void) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="pj:justify-between"
      aria-label={name}
      aria-pressed={pressed}
      onClick={() => {
        setMore(false)
        run()
      }}
    >
      {name}
      <kbd className="pj:rounded-sm pj:border pj:bg-background pj:px-1 pj:font-mono pj:text-[10px]">{shortcut}</kbd>
    </Button>
  )
  const overflow = level >= titleLevel.overflow
  return (
    <header className="pi-titlebar pj:h-10 pj:shrink-0">
      <Toolbar
        ref={bar}
        aria-label="Inspector"
        data-fit="row"
        className="pi-titlebar-grid pj:grid pj:h-full pj:w-full pj:overflow-hidden pj:py-0"
      >
        <div className="pi-title-start pj:flex pj:min-w-0 pj:items-center">
          <div data-fit="row" className="pj:flex pj:min-w-0 pj:items-center pj:gap-1">
            {toggle(
              `${layout.sidebar ? 'Hide' : 'Show'} ${sidebarLabel.toLowerCase()} sidebar`,
              layout.sidebar,
              `Toggle sidebar (${shortcutLabel('b')})`,
              <PanelLeft />,
              toggleSidebar,
            )}
            <span
              className={cn(
                'pi-title pj:shrink-0 pj:whitespace-nowrap pj:px-1 pj:text-xs pj:font-medium pj:text-muted-foreground',
                level >= titleLevel.titleText && 'pj:sr-only',
              )}
            >
              Projections Inspector
            </span>
          </div>
        </div>
        <div className="pi-title-center pj:flex pj:min-w-0 pj:items-center pj:justify-center">{center}</div>
        <div className="pi-title-end pj:flex pj:min-w-0 pj:items-center pj:justify-end">
          <div data-fit="row" className="pj:flex pj:min-w-0 pj:flex-1 pj:items-center pj:justify-end pj:gap-1">
            <TitleBarContext.Provider value={{level, place: 'bar'}}>{title}</TitleBarContext.Provider>
            {level >= titleLevel.overflow && (
              <Popover open={more} onOpenChange={setMore}>
                <ToolbarButton asChild>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="pj:text-muted-foreground pj:hover:text-foreground pj:data-[state=open]:bg-accent"
                      aria-label="More actions"
                      title="More actions"
                    >
                      <Ellipsis />
                    </Button>
                  </PopoverTrigger>
                </ToolbarButton>
                <PopoverContent align="end" collisionPadding={8} aria-label="More actions" className="pi-more pj:w-72 pj:gap-3 pj:p-3">
                  <TitleBarContext.Provider value={{level, place: 'more'}}>{title}</TitleBarContext.Provider>
                  {moreToggle(`${layout.panel ? 'Hide' : 'Show'} panel`, layout.panel, shortcutLabel('j'), togglePanel)}
                  {secondary && moreToggle(secondaryName, layout.secondary, shortcutLabel('b', {alt: true}), toggleSecondary)}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="pj:justify-between"
                    aria-label="Command palette"
                    onClick={() => {
                      setMore(false)
                      onPalette()
                    }}
                  >
                    Command palette
                    <kbd className="pj:rounded-sm pj:border pj:bg-background pj:px-1 pj:font-mono pj:text-[10px]">{shortcutLabel('k')}</kbd>
                  </Button>
                </PopoverContent>
              </Popover>
            )}
            {level < titleLevel.overflow && (
              <ToolbarButton asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="pj:h-8 pj:gap-1.5 pj:px-2 pj:text-xs pj:text-muted-foreground pj:hover:text-foreground"
                  onClick={() => onPalette()}
                  aria-label="Command palette"
                  title={`Command palette (${shortcutLabel('k')})`}
                >
                  {level < titleLevel.commandsText && <span>Commands</span>}
                  <kbd className="pj:rounded-sm pj:border pj:bg-background pj:px-1 pj:font-mono pj:text-[10px]">{shortcutLabel('k')}</kbd>
                </Button>
              </ToolbarButton>
            )}
            {!overflow &&
              toggle(
                `${layout.panel ? 'Hide' : 'Show'} panel`,
                layout.panel,
                `Toggle panel (${shortcutLabel('j')})`,
                <PanelBottom />,
                togglePanel,
              )}
            {secondary &&
              !overflow &&
              toggle(
                secondaryName,
                layout.secondary,
                `Toggle ${secondary.label.toLowerCase()} panel (${shortcutLabel('b', {alt: true})})`,
                <PanelRight />,
                toggleSecondary,
              )}
          </div>
        </div>
      </Toolbar>
    </header>
  )
}
