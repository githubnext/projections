import {useEffect, useId, useMemo, useRef, useState} from 'react'
import {ScopedRoot, cn} from '@githubnext/projections-host/ui/components'
import {CornerDownLeft, Search} from 'lucide-react'

/** Something a person can do from the command palette (and its shortcut, if any). */
export interface Command {
  id: string
  label: string
  /** Heading the command is listed under, for example `Extraction` or `View`. */
  group: string
  /** Shown beside the label and handled by the shell, for example `⌘O`. Single letters with ⌘ / Ctrl. */
  shortcut?: string
  /** Extra words that find the command. */
  keywords?: string
  disabled?: boolean
  run: () => void
}

function matches(command: Command, query: string): boolean {
  const haystack = `${command.group} ${command.label} ${command.keywords ?? ''}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean)
    .every(word => haystack.includes(word))
}

/**
 * The command palette: a modal list filtered as you type. Arrow keys move,
 * Enter runs, Escape closes; focus returns to where it was.
 */
export function CommandPalette({
  open,
  onClose,
  commands,
  colorMode,
}: {
  open: boolean
  onClose: () => void
  commands: readonly Command[]
  colorMode: 'light' | 'dark'
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<Element | null>(null)
  const id = useId()
  const shown = useMemo(() => commands.filter(command => !command.disabled && matches(command, query)), [commands, query])

  useEffect(() => {
    if (!open) return
    returnFocus.current = document.activeElement
    setQuery('')
    setIndex(0)
    requestAnimationFrame(() => input.current?.focus())
    return () => {
      ;(returnFocus.current as HTMLElement | null)?.focus?.()
    }
  }, [open])
  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    document.getElementById(`${id}-option-${index}`)?.scrollIntoView({block: 'nearest'})
  }, [id, index])

  if (!open) return null
  const run = (command: Command | undefined) => {
    if (!command) return
    onClose()
    // Run after the palette closes, so commands that move focus keep it.
    setTimeout(command.run, 0)
  }
  let group = ''
  return (
    <ScopedRoot colorMode={colorMode} className="pi-palette">
      <div
        className="pj:fixed pj:inset-0 pj:z-[100] pj:flex pj:items-start pj:justify-center pj:bg-black/40 pj:px-3 pj:pt-[12vh]"
        onMouseDown={event => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className="pj:flex pj:max-h-[60vh] pj:w-full pj:max-w-xl pj:flex-col pj:overflow-hidden pj:rounded-lg pj:border pj:bg-popover pj:text-popover-foreground pj:shadow-pop pj:inset-shadow-bevel"
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex(value => Math.min(shown.length - 1, value + 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex(value => Math.max(0, value - 1))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              run(shown[index])
            } else if (event.key === 'Tab') event.preventDefault()
          }}
        >
          <div className="pj:flex pj:items-center pj:gap-2 pj:border-b pj:px-3">
            <Search aria-hidden="true" className="pj:h-4 pj:w-4 pj:shrink-0 pj:text-muted-foreground" />
            <input
              ref={input}
              role="combobox"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-activedescendant={shown.length ? `${id}-option-${index}` : undefined}
              aria-label="Command"
              placeholder="Type a command"
              value={query}
              onChange={event => setQuery(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              data-focus-ring="none"
              className="pj:h-11 pj:w-full pj:bg-transparent pj:text-sm pj:placeholder:text-muted-foreground pj:focus:outline-hidden"
            />
          </div>
          <ul id={`${id}-list`} role="listbox" aria-label="Commands" className="pj:min-h-0 pj:flex-1 pj:overflow-y-auto pj:p-1">
            {!shown.length && (
              <li role="presentation" className="pj:px-3 pj:py-6 pj:text-center pj:text-sm pj:text-muted-foreground">
                No matching command.
              </li>
            )}
            {shown.map((command, position) => {
              const heading = command.group !== group ? command.group : undefined
              group = command.group
              return [
                heading && (
                  <li
                    key={`group-${heading}`}
                    role="presentation"
                    className="pj:px-2 pj:pb-1 pj:pt-2 pj:text-[11px] pj:font-medium pj:text-muted-foreground"
                  >
                    {heading}
                  </li>
                ),
                <li
                  key={command.id}
                  id={`${id}-option-${position}`}
                  role="option"
                  aria-selected={position === index}
                  data-command={command.id}
                  onMouseMove={() => setIndex(position)}
                  onClick={() => run(command)}
                  className={cn(
                    'pj:flex pj:cursor-pointer pj:items-center pj:gap-2 pj:rounded-md pj:px-2 pj:py-1.5 pj:text-sm',
                    position === index && 'pj:bg-accent pj:text-accent-foreground',
                  )}
                >
                  <span className="pj:min-w-0 pj:flex-1 pj:truncate">{command.label}</span>
                  {command.shortcut && (
                    <kbd className="pj:rounded-sm pj:border pj:bg-background pj:px-1.5 pj:font-mono pj:text-[10px] pj:text-muted-foreground">
                      {command.shortcut}
                    </kbd>
                  )}
                  {position === index && <CornerDownLeft aria-hidden="true" className="pj:h-3.5 pj:w-3.5 pj:text-muted-foreground" />}
                </li>,
              ]
            })}
          </ul>
        </div>
      </div>
    </ScopedRoot>
  )
}
