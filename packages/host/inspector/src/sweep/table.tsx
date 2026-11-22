import {
  Badge,
  Checkbox,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@githubnext/projections-host/ui/components'
import {CircleAlert, ShieldAlert} from 'lucide-react'
import type {Sweep, SweepCell, SweepChange, SweepProjection} from '../types.js'
import {cellHref, cellSummary, changeLabel, columnStats, statsText} from './stats.js'
import {ChangedCell} from './thumbnails.js'
import type {ThumbnailQueue} from './thumbnails.js'

/** A projection's adoption state in the grid: a candidate to adopt, adopted already, or defined by hand. */
export interface Adoptable {
  /** The definition that adopted it, or null while it's only a candidate. */
  adopted: string | null
}

/** What the grid's table shows: the sweep's projections (as ordered) on the changes (as filtered). */
export interface SweepTableProps {
  sweep: Sweep
  projections: SweepProjection[]
  rows: SweepChange[]
  cells: Map<string, SweepCell>
  signals: Map<string, number>
  titles: Map<string, string>
  adoptable: Map<string, Adoptable>
  selected: ReadonlySet<string>
  onSelect: (id: string, selected: boolean) => void
  running: boolean
  queue: ThumbnailQueue
}

/** A skipped or failed projection's reason, in its column's header. */
function SkippedStatus({row}: {row: SweepProjection}) {
  return (
    <span className="pj:flex pj:items-center pj:gap-1 pj:text-xs pj:font-normal" title={row.error}>
      {row.status === 'trust' ? (
        <ShieldAlert className="pj:size-3" aria-hidden="true" />
      ) : (
        <CircleAlert className="pj:size-3" aria-hidden="true" />
      )}
      {row.status === 'trust' ? 'Skipped: runs repository code (--trust)' : 'Failed'}
    </span>
  )
}

/** A projection's adoption, in its column's header: adopted, a candidate to tick, or defined here. */
function AdoptionStatus({
  row,
  adoption,
  selected,
  onSelect,
}: {
  row: SweepProjection
  adoption: Adoptable | undefined
  selected: ReadonlySet<string>
  onSelect: (id: string, selected: boolean) => void
}) {
  const checkbox = `pi-adopt-${row.projection}`
  if (adoption?.adopted) {
    return (
      <Badge variant="secondary" className="pj:mt-1 pj:w-fit">
        Adopted
      </Badge>
    )
  }
  if (!adoption) return <span className="pj:mt-1 pj:text-xs pj:font-normal pj:text-muted-foreground">Defined here</span>
  return (
    <span className="pj:mt-1 pj:flex pj:items-center pj:gap-2 pj:font-normal">
      <Checkbox id={checkbox} checked={selected.has(row.projection)} onCheckedChange={value => onSelect(row.projection, value === true)} />
      <Label htmlFor={checkbox} className="pj:text-xs">
        Adopt
      </Label>
    </span>
  )
}

/** A projection's column header: its title and ID, how often it changed, and its adoption. */
function ProjectionHead({row, ...props}: SweepTableProps & {row: SweepProjection}) {
  const stats = columnStats(row.projection, props.sweep.cells)
  const text = statsText(stats)
  return (
    <TableHead scope="col" className="pj:min-w-44 pj:align-bottom" data-projection={row.projection}>
      <span className="pj:flex pj:flex-col pj:gap-0.5 pj:py-1 pj:whitespace-normal">
        <span>{props.titles.get(row.projection) ?? row.projection}</span>
        <code className="pj:font-mono pj:text-xs pj:font-normal pj:text-muted-foreground">{row.projection}</code>
        {row.status === 'ready' && stats.swept > 0 && (
          <span className="pi-sweep-stats pj:text-xs pj:font-normal" data-signal={stats.signal}>
            {text.summary}
            {text.hint && <span className="pj:block pj:text-muted-foreground">{text.hint}</span>}
          </span>
        )}
        {row.status !== 'ready' && <SkippedStatus row={row} />}
        <AdoptionStatus row={row} adoption={props.adoptable.get(row.projection)} selected={props.selected} onSelect={props.onSelect} />
      </span>
    </TableHead>
  )
}

/** One projection on one change: skipped, waiting, or its result, opening that change in the Inspector. */
function SweepTableCell({row, change, ...props}: SweepTableProps & {row: SweepProjection; change: SweepChange}) {
  const cell = props.cells.get(`${row.projection}|${change.after}`)
  if (row.status !== 'ready') return <TableCell aria-label="Skipped" />
  if (!cell) return <TableCell className="pj:text-xs pj:text-muted-foreground">{props.running ? 'Waiting…' : '—'}</TableCell>
  return (
    <TableCell className="pi-sweep-cell pj:align-top" data-status={cell.status} data-projection={cell.projection}>
      {cell.status === 'changed' ? (
        <ChangedCell
          cell={cell}
          label={`${props.titles.get(cell.projection) ?? cell.projection} on ${changeLabel(change)}`}
          queue={props.queue}
        />
      ) : (
        <a
          href={cellHref(cell)}
          className="pj:flex pj:items-center pj:gap-1 pj:rounded-sm pj:text-xs"
          title={cell.error ?? `Open ${changeLabel(change)} in the Inspector`}
        >
          {cell.status === 'failed' && <CircleAlert className="pj:size-3" aria-hidden="true" />}
          {cellSummary(cell)}
        </a>
      )}
    </TableCell>
  )
}

/** A change's row: its label and title, highlighted when several projections changed on it. */
function ChangeRow({change, ...props}: SweepTableProps & {change: SweepChange}) {
  const signal = props.signals.get(change.after) ?? 0
  return (
    <TableRow data-change={change.after} data-highlight={signal >= 2 || undefined}>
      <TableHead scope="row" className="pj:max-w-64 pj:align-top">
        <span className="pj:flex pj:flex-col pj:gap-0.5 pj:font-normal pj:whitespace-normal">
          <code className="pj:font-mono pj:text-xs">{changeLabel(change)}</code>
          <span className="pj:line-clamp-2 pj:text-xs pj:text-muted-foreground" title={change.title}>
            {change.title}
          </span>
          {signal >= 2 && (
            <Badge variant="outline" className="pj:mt-1 pj:w-fit">
              {signal} projections changed
            </Badge>
          )}
        </span>
      </TableHead>
      {props.projections.map(row => (
        <SweepTableCell key={row.projection} {...props} row={row} change={change} />
      ))}
    </TableRow>
  )
}

/** The sweep's table: a column per projection, a row per change. */
export function SweepTable(props: SweepTableProps) {
  return (
    <div className="pi-sweep pj:overflow-x-auto pj:rounded-md pj:border pj:border-divider">
      <Table aria-label="Projections on recent changes">
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="pj:align-bottom">
              Change
            </TableHead>
            {props.projections.map(row => (
              <ProjectionHead key={row.projection} {...props} row={row} />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.map(change => (
            <ChangeRow key={change.after} {...props} change={change} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
