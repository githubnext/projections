import {useState, type ReactNode} from 'react'
import {type ViewSubject, type Row, describeChange, rowStatusCounts, statusLabel} from '../model.js'
import {variedWithin} from '@githubnext/projections-renderer-sdk/presentation'
import {figuresSentence, type SummaryFigure} from '../summary.js'
import type {AnnotationMark} from '@githubnext/projections-renderer-sdk/protocol'
import {AnnotationMarker} from './annotations.js'
import {Prose} from './prose.js'
import {Badge} from './components/badge.js'
import {Button} from './components/button.js'
import {Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow} from './components/table.js'
import {cn} from './lib/utils.js'

/** The props of the built-in views, `TableView` and `TextView`: the rows to show, the selection and annotations. */
export interface BuiltInViewProps {
  subject: ViewSubject
  /** The rows to show: the host's rows after its find and "changes only" settings. */
  rows: readonly Row[]
  /** How many rows exist before filtering. */
  total?: number
  /** Comparison mode: the current presentation position (0 before, 1 after). */
  progress: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Annotation markers by row ID (`ProjectionController.annotationMarks`). */
  annotations?: ReadonlyMap<string, AnnotationMark> | undefined
  /** Called when a row's annotation marker is activated (`ProjectionController.activateAnnotation`). */
  onAnnotationActivate?: ((rowId: string) => void) | undefined
  /** The summary bar's figures (`ProjectionController.summary`), which the text view states in the bar's words. */
  summary?: readonly SummaryFigure[] | undefined
}

/** A row's annotation marker, when it has one and the view can report activations. */
function Marker({row, annotations, onAnnotationActivate}: {row: Row} & Pick<BuiltInViewProps, 'annotations' | 'onAnnotationActivate'>) {
  const mark = annotations?.get(row.id)
  return mark && onAnnotationActivate ? (
    <AnnotationMarker mark={mark} rowLabel={row.label} onActivate={onAnnotationActivate} className="pj:ml-1.5" />
  ) : null
}

const pageSize = 100

/**
 * Text and chip colors for a change status. A change chip is its `-muted` fill painted over the raised surface (so it
 * is opaque, and its text AA, on any row, selected rows included) with its same-hue `-border` edge: never a fill alone.
 */
export const statusTone: Record<string, string> = {
  added: 'pj:border-added-border pj:bg-surface-raised pj:bg-linear-to-r pj:from-added-muted pj:to-added-muted pj:text-added',
  removed: 'pj:border-removed-border pj:bg-surface-raised pj:bg-linear-to-r pj:from-removed-muted pj:to-removed-muted pj:text-removed',
  modified: 'pj:border-modified-border pj:bg-surface-raised pj:bg-linear-to-r pj:from-modified-muted pj:to-modified-muted pj:text-modified',
  moved: 'pj:border-moved-border pj:bg-surface-raised pj:bg-linear-to-r pj:from-moved-muted pj:to-moved-muted pj:text-moved',
  unchanged: 'pj:text-muted-foreground',
}

function SelectButton({
  row,
  selected,
  onSelect,
  children,
}: {
  row: Row
  selected: boolean
  onSelect: BuiltInViewProps['onSelect']
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="ph-link pj:max-w-full pj:whitespace-normal pj:rounded-xs pj:text-left pj:font-medium pj:underline pj:decoration-muted-foreground/40 pj:underline-offset-4 pj:transition-colors pj:hover:decoration-foreground pj:focus-visible:outline-hidden pj:focus-visible:ring-1 pj:focus-visible:ring-ring pj:aria-pressed:decoration-foreground pj:aria-pressed:decoration-2"
      aria-pressed={selected}
      data-row-id={row.id}
      onClick={() => onSelect(selected ? null : row.id)}
    >
      {children}
    </button>
  )
}

const Code = ({children}: {children: ReactNode}) => <code className="pj:font-mono pj:text-xs pj:text-muted-foreground">{children}</code>

/** The host's built-in table: every entity and relationship, or every change and unchanged item. */
export function TableView({subject, rows, total = rows.length, selectedId, onSelect, annotations, onAnnotationActivate}: BuiltInViewProps) {
  const comparing = subject.mode === 'comparison'
  const [limit, setLimit] = useState(pageSize)
  return (
    <div className="ph-table-view pj:flex pj:min-w-0 pj:flex-col pj:gap-4" data-view="table">
      <p role="status" className="ph-row-count pj:text-xs pj:text-muted-foreground">
        {rows.length.toLocaleString()} of {total.toLocaleString()} rows
      </p>
      {(['entities', 'relationships'] as const).map(collection => {
        const items = rows.filter(row => row.collection === collection)
        const shown = items.slice(0, limit)
        return (
          <div
            className="ph-table-scroll pj:min-w-0 pj:overflow-hidden pj:rounded-lg pj:border pj:border-divider pj:bg-surface-raised"
            key={collection}
          >
            <Table data-collection={collection} className="pj:caption-top">
              <TableCaption className="pj:mt-0 pj:bg-surface-header pj:px-3 pj:pt-2 pj:pb-0.5 pj:text-left pj:font-medium pj:text-foreground">
                {collection === 'entities' ? 'Entities' : 'Relationships'}{' '}
                <span className="pj:font-normal pj:text-muted-foreground">({items.length.toLocaleString()})</span>
              </TableCaption>
              <TableHeader className="pj:bg-surface-header pj:[&_tr]:border-divider">
                <TableRow className="pj:hover:bg-transparent">
                  {comparing && (
                    <TableHead scope="col" className="pj:w-12">
                      Step
                    </TableHead>
                  )}
                  {comparing && <TableHead scope="col">Change</TableHead>}
                  <TableHead scope="col">{collection === 'entities' ? 'Entity' : 'Relationship'}</TableHead>
                  <TableHead scope="col">Kind</TableHead>
                  {collection === 'relationships' && (
                    <>
                      <TableHead scope="col">From</TableHead>
                      <TableHead scope="col">To</TableHead>
                    </>
                  )}
                  {comparing ? (
                    <>
                      <TableHead scope="col">Before</TableHead>
                      <TableHead scope="col">After</TableHead>
                      <TableHead scope="col">Summary</TableHead>
                    </>
                  ) : (
                    <TableHead scope="col">ID</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map(row => (
                  <TableRow
                    key={row.id}
                    data-row-id={row.id}
                    data-status={row.status}
                    data-selected={row.id === selectedId || undefined}
                    className="pj:data-[selected]:bg-lens-muted pj:data-[selected]:shadow-[inset_2px_0_0_var(--pj-lens)]"
                  >
                    {comparing && (
                      <TableCell className="pj:tabular-nums pj:text-muted-foreground">
                        {row.step === undefined ? '—' : row.step + 1}
                      </TableCell>
                    )}
                    {comparing && (
                      <TableCell>
                        <Badge variant="outline" className={cn('pj:whitespace-nowrap pj:font-medium', statusTone[row.status ?? ''])}>
                          {row.status && statusLabel(row.status)}
                          {row.correspondence && !['exact', 'none'].includes(row.correspondence) ? ` · ${row.correspondence}` : ''}
                        </Badge>
                      </TableCell>
                    )}
                    <TableHead scope="row" className="pj:h-auto pj:p-2 pj:font-normal pj:text-foreground">
                      <SelectButton row={row} selected={row.id === selectedId} onSelect={onSelect}>
                        {row.label}
                      </SelectButton>
                      <Marker row={row} annotations={annotations} onAnnotationActivate={onAnnotationActivate} />
                    </TableHead>
                    <TableCell className="pj:text-muted-foreground">{row.kind}</TableCell>
                    {collection === 'relationships' && (
                      <>
                        <TableCell>
                          <Code>{row.from}</Code>
                        </TableCell>
                        <TableCell>
                          <Code>{row.to}</Code>
                        </TableCell>
                      </>
                    )}
                    {comparing ? (
                      <>
                        <TableCell>
                          <Code>{row.before.join(', ') || '—'}</Code>
                        </TableCell>
                        <TableCell>
                          <Code>{row.after.join(', ') || '—'}</Code>
                        </TableCell>
                        <TableCell className="pj:min-w-40">{row.summary ? <Prose>{row.summary}</Prose> : ''}</TableCell>
                      </>
                    ) : (
                      <TableCell>
                        <Code>{row.id}</Code>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!items.length && (
                  <TableRow className="pj:hover:bg-transparent">
                    <TableCell colSpan={8} className="pj:py-6 pj:text-center pj:text-muted-foreground">
                      No {collection} match.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {items.length > shown.length && (
              <div className="pj:border-t pj:p-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setLimit(value => value + pageSize)}>
                  Show {Math.min(pageSize, items.length - shown.length)} more {collection}
                </Button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The host's built-in text view: a plain-language outline in reading order. */
export function TextView({subject, rows, progress, selectedId, onSelect, annotations, onAnnotationActivate, summary}: BuiltInViewProps) {
  const marker = (row: Row) => <Marker row={row} annotations={annotations} onAnnotationActivate={onAnnotationActivate} />
  // The summary bar's sentence, word for word, so the text says what the bar says.
  const summarized = summary?.length ? (
    <p data-summary-sentence="">Summary: {figuresSentence(summary, subject.mode === 'comparison')}.</p>
  ) : null
  if (subject.mode === 'extraction') {
    const {extraction} = subject
    const relationships = new Map<string, Row[]>()
    for (const row of rows) {
      if (row.collection === 'relationships' && row.from) relationships.set(row.from, [...(relationships.get(row.from) ?? []), row])
    }
    const labels = new Map(extraction.entities.map(entity => [entity.id, entity.label]))
    return (
      <div className="ph-text-view pj:flex pj:min-w-0 pj:max-w-[80ch] pj:flex-col pj:gap-3 pj:text-sm pj:leading-relaxed" data-view="text">
        <p>
          This extraction ({extraction.schema}) has {extraction.entities.length.toLocaleString()}{' '}
          {extraction.entities.length === 1 ? 'entity' : 'entities'} and {extraction.relationships.length.toLocaleString()}{' '}
          {extraction.relationships.length === 1 ? 'relationship' : 'relationships'}.
        </p>
        {summarized}
        <ul className="ph-outline pj:list-disc pj:space-y-1 pj:rounded-lg pj:border pj:border-divider pj:bg-surface-raised pj:py-2 pj:pr-3 pj:pl-8 pj:marker:text-muted-foreground">
          {rows
            .filter(row => row.collection === 'entities')
            .map(row => (
              <li key={row.id} data-item-id={row.id}>
                <SelectButton row={row} selected={row.id === selectedId} onSelect={onSelect}>
                  {row.label}
                </SelectButton>
                {marker(row)}{' '}
                <span className="pj:text-muted-foreground">
                  ({row.kind}
                  {row.label === row.id ? '' : `, ${row.id}`})
                </span>
                {relationships.get(row.id)?.length ? (
                  <ul className="pj:mt-1 pj:list-[circle] pj:space-y-1 pj:pl-5">
                    {relationships.get(row.id)!.map(edge => (
                      <li key={edge.id} data-item-id={edge.id}>
                        <SelectButton row={edge} selected={edge.id === selectedId} onSelect={onSelect}>
                          {edge.kind}
                        </SelectButton>
                        {marker(edge)} <span className="pj:text-muted-foreground">→</span> {labels.get(edge.to ?? '') ?? edge.to}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
        </ul>
        {rows.some(row => row.collection === 'relationships' && !extraction.entities.some(entity => entity.id === row.from)) && (
          <p className="pj:text-muted-foreground">Some relationships start outside the listed entities; see the table view.</p>
        )}
      </div>
    )
  }
  const {comparison} = subject
  const counts = rowStatusCounts(rows.filter(row => row.step !== undefined))
  const listed = new Set(rows.map(row => row.id))
  const byId = new Map(rows.map(row => [row.id, row]))
  const unchanged = rows.filter(row => row.step === undefined).length
  const varied = rows.filter(row => variedWithin(row)).length
  // Changes that varied only within tolerance are unchanged items, counted with them.
  const changeCount = comparison.changes.filter(change => !variedWithin(change)).length
  const total = comparison.steps.length
  const current = total ? Math.min(total - 1, Math.floor(progress * total - 1e-9)) : -1
  return (
    <div className="ph-text-view pj:flex pj:min-w-0 pj:max-w-[80ch] pj:flex-col pj:gap-3 pj:text-sm pj:leading-relaxed" data-view="text">
      <p>
        {changeCount
          ? `${changeCount.toLocaleString()} ${changeCount === 1 ? 'change' : 'changes'} in ${total} ${total === 1 ? 'step' : 'steps'}: ${counts.added} added, ${counts.removed} removed, ${counts.modified} modified${counts.unchanged ? `, ${counts.unchanged} identity-only` : ''}.`
          : 'The two extractions are equivalent: nothing changed.'}{' '}
        {unchanged.toLocaleString()} {unchanged === 1 ? 'item is' : 'items are'} unchanged
        {varied ? `, ${varied.toLocaleString()} of them varied within tolerance` : ''}.
      </p>
      {summarized}
      <ol className="ph-steps pj:flex pj:flex-col pj:gap-2">
        {comparison.steps.map((step, index) =>
          !step.changes.some(id => listed.has(id)) ? null : (
            <li
              key={index}
              value={index + 1}
              data-step={index}
              aria-current={progress > 0 && progress < 1 && index === current ? 'step' : undefined}
              className="ph-step pj:overflow-hidden pj:rounded-lg pj:border pj:border-divider pj:bg-surface-raised pj:aria-[current=step]:border-lens pj:aria-[current=step]:ring-1 pj:aria-[current=step]:ring-lens"
            >
              <p className="ph-step-heading pj:border-b pj:border-divider pj:bg-surface-header pj:px-3 pj:py-1.5 pj:font-medium">
                Step {index + 1} of {total}
                {step.kind ? ` (${step.kind})` : ''}
                {step.summary ? (
                  <span className="pj:font-normal pj:text-muted-foreground">
                    : <Prose>{step.summary}</Prose>
                  </span>
                ) : (
                  ''
                )}
              </p>
              <ul className="pj:list-disc pj:space-y-0.5 pj:py-2 pj:pr-3 pj:pl-8 pj:marker:text-muted-foreground">
                {step.changes.map(id => {
                  const row = byId.get(id)
                  return row ? (
                    <li key={id} data-item-id={id}>
                      <SelectButton row={row} selected={id === selectedId} onSelect={onSelect}>
                        <Prose>{describeChange(row)}</Prose>
                      </SelectButton>
                      {marker(row)}
                    </li>
                  ) : null
                })}
              </ul>
            </li>
          ),
        )}
      </ol>
    </div>
  )
}
