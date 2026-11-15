import {useMemo} from 'react'
import type {ReactNode} from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  cn,
} from '@githubnext/projections-host/ui/components'
import type {Definition} from '@githubnext/projections-schemas'
import {defaultThemeTokens, iconMaskStyle, iconToken} from '@githubnext/projections-renderer-sdk/protocol'
import {FileBraces, RotateCcw} from 'lucide-react'
import type {DefinitionWriter, PartName, PartOption, PartRow} from './model.js'
import {SaveToDefinition} from './save.js'

/**
 * A part's icon: its icon token (`--projections-icon-<part>`), which a host may define to draw its own, over the SDK's
 * default (brand/parts: a dot is the extraction). A mask in the text color, 14px like the row's other icons.
 */
function PartIcon({part}: {part: PartName}) {
  const image = `var(--projections-icon-${part}, ${defaultThemeTokens('light')[iconToken(part)]})`
  return (
    <span
      data-icon={part}
      className="pj:block pj:size-3.5 pj:bg-current"
      style={{...iconMaskStyle(part), WebkitMaskImage: image, maskImage: image}}
    />
  )
}

/**
 * The current projection's definition file and three parts as labelled selectors: **Extractor**, **Comparator** and
 * **Renderer**. A projection is a combination of three independent parts, and each can be swapped here for this
 * session: a changed part is marked "changed from definition" with Reset, and **Save to definition** shows the
 * definition file's diff. Choosing a part's name (or the definition) shows the diagnostics. The title bar names the
 * projection, so the section doesn't.
 */
export function PartsPanel({
  rows,
  definition,
  saved,
  onDiagnostics,
  onResetAll,
  writer,
}: {
  rows: readonly PartRow[]
  /** The definition file as it is, and as the overrides would write it. */
  definition: Definition
  saved: Definition
  onDiagnostics: (part: PartName | 'definition') => void
  onResetAll: () => void
  /** Writes the definition file through the local runner; without it the panel offers the edit to copy. */
  writer?: DefinitionWriter | undefined
}) {
  const changed = rows.some(row => row.changed)
  return (
    <div className="pi-parts pj:flex pj:flex-col pj:gap-2">
      <div className="pi-x-row pi-x-compact pj:text-xs" data-part="definition">
        <span aria-hidden="true" className="pi-x-icon pj:text-muted-foreground pj:[&_svg]:size-3.5">
          <FileBraces />
        </span>
        <button
          type="button"
          className="pi-x-title pj:font-medium pj:underline-offset-2 pj:hover:underline pj:focus-visible:outline-hidden pj:focus-visible:ring-1 pj:focus-visible:ring-ring"
          title="Show the definition's diagnostics"
          onClick={() => onDiagnostics('definition')}
        >
          Definition
        </button>
        <code className="pj:min-w-0 pj:flex-1 pj:truncate pj:text-right pj:font-mono pj:text-[11px] pj:text-muted-foreground">
          {definition.id}.json
        </code>
      </div>
      {rows.map(row => (
        <PartSelector key={row.part} row={row} onDiagnostics={() => onDiagnostics(row.part)}>
          {row.extra}
        </PartSelector>
      ))}
      {changed && <SaveToDefinition definition={definition} saved={saved} onResetAll={onResetAll} writer={writer} />}
    </div>
  )
}

function PartSelector({row, onDiagnostics, children}: {row: PartRow; onDiagnostics: () => void; children?: ReactNode}) {
  const groups = useMemo(() => {
    const map = new Map<string, PartOption[]>()
    for (const option of row.options) map.set(option.group, [...(map.get(option.group) ?? []), option])
    return [...map]
  }, [row.options])
  const current = row.options.find(option => option.value === row.value)
  return (
    <div className="pi-part pj:flex pj:flex-col pj:gap-1" data-part={row.part} data-changed={row.changed || undefined}>
      <div className="pi-x-row pi-x-compact pj:text-xs">
        <span aria-hidden="true" className="pi-x-icon pj:text-muted-foreground pj:[&_svg]:size-3.5">
          <PartIcon part={row.part} />
        </span>
        <button
          type="button"
          className="pi-x-title pj:font-medium pj:underline-offset-2 pj:hover:underline pj:focus-visible:outline-hidden pj:focus-visible:ring-1 pj:focus-visible:ring-ring"
          title={`Show the ${row.label.toLowerCase()}'s diagnostics`}
          onClick={onDiagnostics}
        >
          {row.label}
        </button>
        {row.status && (
          <span
            className="pi-status pj:inline-flex pj:shrink-0 pj:items-center pj:gap-1 pj:text-[11px] pj:text-muted-foreground pj:[&_svg]:size-3"
            data-status={row.status.kind}
          >
            {row.status.icon}
            {row.status.text}
          </span>
        )}
        <span className="pj:flex-1" />
        {row.changed && (
          <>
            <span className="pi-changed pj:shrink-0 pj:rounded-sm pj:border pj:border-modified pj:px-1 pj:text-[10px] pj:text-foreground">
              changed from definition
            </span>
            <button
              type="button"
              className="pj:inline-flex pj:size-5 pj:shrink-0 pj:items-center pj:justify-center pj:rounded-sm pj:text-muted-foreground pj:hover:bg-muted pj:hover:text-foreground"
              aria-label={`Reset the ${row.label.toLowerCase()} to the definition's`}
              title="Reset to the definition's"
              onClick={row.onReset}
            >
              <RotateCcw className="pj:size-3" />
            </button>
          </>
        )}
      </div>
      <div className="pi-x-block pj:flex pj:flex-col pj:gap-1">
        <Select value={row.value} onValueChange={row.onChange}>
          <SelectTrigger
            size="sm"
            aria-label={row.label}
            title={`${row.label}: ${current?.label ?? row.value}${current ? ` (${current.origin})` : ''}`}
            className="pi-part-trigger pj:h-7 pj:w-full pj:min-w-0 pj:bg-background pj:text-xs pj:[&_.pi-origin]:hidden pj:[&>[data-slot=select-value]]:block pj:[&>[data-slot=select-value]]:min-w-0 pj:[&>[data-slot=select-value]]:truncate"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start" collisionPadding={8} className="pj:max-w-[min(26rem,calc(100vw-1rem))]">
            {groups.map(([group, options]) => (
              <SelectGroup key={group}>
                <SelectLabel>{group}</SelectLabel>
                {options.map(option => (
                  <SelectItem key={option.value} value={option.value} disabled={option.disabled} className="pj:py-1 pj:text-xs">
                    <span className="pj:flex pj:min-w-0 pj:flex-col">
                      <span className="pj:truncate">{option.label}</span>
                      <span
                        className={cn(
                          'pi-origin pj:truncate pj:text-[11px] pj:text-muted-foreground',
                          option.reason && 'pj:whitespace-normal',
                        )}
                      >
                        {option.reason ?? option.origin}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <span className="pi-origin-line pj:truncate pj:px-0.5 pj:font-mono pj:text-[11px] pj:text-muted-foreground" title={current?.origin}>
          {current?.origin}
        </span>
        {children}
      </div>
    </div>
  )
}
