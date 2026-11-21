import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {CSSProperties, ReactNode} from 'react'
import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {statusParts} from '@githubnext/projections-renderer-kit'
import {EmptyDomain, Fold, Group, useFolds} from '@githubnext/projections-renderer-kit/react'
import type {ComparisonModel} from '@githubnext/projections-renderer-kit'
import type {RendererProps} from '@githubnext/projections-renderer-kit/react'
import type {RendererControl} from '@githubnext/projections-renderer-sdk/protocol'
import {lineLimit, readOutput, validateModel} from './model.js'
import {digits, segments} from './folding.js'
import {outputDiff} from './rows.js'
import type {TextDiffLayout, TextPresentation} from './model.js'
import type {Cell, LineKind, OutputDiff, Word} from './rows.js'
import type {Segment} from './folding.js'
import {splitLines} from './diff.js'
import type {accepts} from './accepts.js'

type Style = CSSProperties & Record<`--${string}`, string | number>

const diffCache = new WeakMap<ComparisonModel, Map<string, OutputDiff>>()

/** Below this width two columns read as one: the diff shows as one column. */
const narrowWidth = 640

const marks: Record<LineKind, string> = {equal: '', delete: '−', insert: '+'}
const spoken: Record<LineKind, string> = {equal: '', delete: 'Removed: ', insert: 'Added: '}

export function isLayout(value: unknown): value is TextDiffLayout {
  return value === 'split' || value === 'unified'
}

/**
 * Rows in extraction order: survivors and additions follow the after
 * extraction, and each removal follows the row it followed before.
 */
export function outputOrder(model: ComparisonModel): EntityChange<Entity>[] {
  const byRow = new Map(model.entities.map(row => [row.id, row]))
  const order = model.after.entities.map(entity => model.entityRow.after.get(entity.id)).filter(id => id !== undefined)
  let previous: string | undefined
  for (const entity of model.before.entities) {
    const id = model.entityRow.before.get(entity.id)
    if (id === undefined) continue
    if (!order.includes(id)) order.splice(previous === undefined ? 0 : order.indexOf(previous) + 1, 0, id)
    previous = id
  }
  return [...new Set(order)].map(id => byRow.get(id)!)
}

function Gutter({number, side}: {number: number | undefined; side?: 'old' | 'new'}) {
  return (
    <span className={`td-num${side ? ` td-num-${side}` : ''}`} aria-hidden="true">
      {number ?? ''}
    </span>
  )
}

function LineText({kind, text, ending, words}: {kind: LineKind; text: string; ending?: string | undefined; words?: Word[] | undefined}) {
  return (
    <>
      <span className="td-mark" aria-hidden="true">
        {marks[kind]}
      </span>
      {kind !== 'equal' && <span className="sr-only">{spoken[kind]}</span>}
      <span className="td-text">
        {words
          ? words.map((word, index) =>
              word.changed ? (
                <span key={index} className="td-word">
                  {word.text}
                </span>
              ) : (
                word.text
              ),
            )
          : text}
      </span>
      {ending && <span className="td-ending">{` ${ending}`}</span>}
    </>
  )
}

function LineNotice({shown, total}: {shown: number; total: number}) {
  if (total <= shown) return null
  return (
    <p className="graph-notice td-notice" role="status">
      Showing the first {shown.toLocaleString()} of {total.toLocaleString()} lines.
    </p>
  )
}

/** One revision's text as plain numbered lines: extractions and outputs whose text didn't change. */
function PlainLines({text, presentation}: {text: string; presentation: TextPresentation}) {
  const lines = useMemo(() => splitLines(text), [text])
  const shown = lines.slice(0, lineLimit)
  return (
    <div className="td-body" data-layout="plain" data-presentation={presentation}>
      <div className="td-lines" style={{'--digits': digits(lines.length)} as Style}>
        {!lines.length && (
          <div className="td-row td-empty">
            <span className="td-text td-placeholder">(no output)</span>
          </div>
        )}
        {shown.map((line, index) => (
          <div className="td-row" key={index}>
            <Gutter number={index + 1} />
            <span className="td-text">{line.text}</span>
          </div>
        ))}
      </div>
      <LineNotice shown={shown.length} total={lines.length} />
    </div>
  )
}

/** A folded run of unchanged lines, which activating shows; open, above the run, the way to fold it again. */
function Gap({count, open = false, onToggle, span}: {count: number; open?: boolean; onToggle: () => void; span?: boolean}) {
  return (
    <div className={`td-row td-gap${span ? ' td-span' : ''}`} data-fold={open ? 'open' : 'closed'}>
      <button type="button" className="td-expand" onClick={onToggle} aria-expanded={open}>
        <span aria-hidden="true">⋯</span> {open ? 'Hide ' : ''}
        {count.toLocaleString()} unchanged {count === 1 ? 'line' : 'lines'}
      </button>
    </div>
  )
}

interface DiffProps {
  diff: OutputDiff
  presentation: TextPresentation
  expanded: ReadonlySet<number>
  expand: (start: number) => void
  collapse: (start: number) => void
}

/** One column: removed lines then added lines in each change, with old and new line numbers. */
function UnifiedDiff({diff, presentation, expanded, expand, collapse}: DiffProps) {
  const rows = diff.unified.slice(0, lineLimit)
  const parts = segments(
    rows.map(row => row.kind !== 'equal'),
    undefined,
    expanded,
  )
  const style = {'--digits-old': digits(diff.before.length), '--digits-new': digits(diff.after.length)} as Style
  return (
    <div className="td-body" data-layout="unified" data-presentation={presentation}>
      <div className="td-lines td-diff" style={style}>
        {parts.map((part: Segment) =>
          part.kind !== 'rows' ? (
            <Gap
              key={`${part.kind}-${part.start}`}
              count={part.end - part.start}
              open={part.kind === 'open'}
              onToggle={() => (part.kind === 'open' ? collapse : expand)(part.start)}
            />
          ) : (
            rows.slice(part.start, part.end).map((line, offset, run) => (
              <div
                className={`td-row td-${line.kind}${line.kind === 'equal' ? '' : ' pk-region pk-region-run'}`}
                key={part.start + offset}
                {...region(line.kind, run[offset - 1]?.kind, run[offset + 1]?.kind)}
              >
                <Gutter number={line.old} side="old" />
                <Gutter number={line.new} side="new" />
                <LineText kind={line.kind} text={line.text} ending={line.ending} words={line.words} />
              </div>
            ))
          ),
        )}
      </div>
      <LineNotice shown={rows.length} total={diff.unified.length} />
    </div>
  )
}

/**
 * A changed line is a change region (kit `pk-region`): tinted, with a left edge, and a top or bottom edge where its run
 * of same-kind lines starts or ends, so the tint always has a defining edge.
 */
function region(kind: string, previous: string | undefined, next: string | undefined) {
  if (kind === 'equal') return {}
  return {
    'data-change': kind === 'delete' ? 'removed' : 'added',
    'data-run-start': previous === kind ? undefined : '',
    'data-run-end': next === kind ? undefined : '',
  }
}

function SplitCell({
  cell,
  side,
  previous,
  next,
}: {
  cell: Cell | undefined
  side: 'before' | 'after'
  previous: Cell | undefined
  next: Cell | undefined
}) {
  if (!cell) return <div className={`td-cell td-filler td-side-${side}`} aria-hidden="true" />
  const changed = region(cell.kind, previous?.kind, next?.kind)
  return (
    <div className={`td-cell td-${cell.kind} td-side-${side}${cell.kind === 'equal' ? '' : ' pk-region pk-region-run'}`} {...changed}>
      <Gutter number={cell.number} side={side === 'before' ? 'old' : 'new'} />
      <LineText kind={cell.kind} text={cell.text} ending={cell.ending} words={cell.words} />
    </div>
  )
}

/**
 * Two aligned columns, before on the left and after on the right. A changed
 * line sits beside its replacement; a line on one side only faces a blank
 * filler, so unchanged lines stay aligned. Lines wrap within their column and
 * both cells of a row share its height.
 */
function SplitDiff({diff, presentation, expanded, expand, collapse}: DiffProps) {
  const rows = diff.split.slice(0, lineLimit)
  const parts = segments(
    rows.map(row => row.left?.kind !== 'equal' || row.right?.kind !== 'equal'),
    undefined,
    expanded,
  )
  const style = {'--digits-old': digits(diff.before.length), '--digits-new': digits(diff.after.length)} as Style
  return (
    <div className="td-body" data-layout="split" data-presentation={presentation}>
      <div className="td-split td-diff" style={style}>
        <div className="td-caption td-side-before">Before</div>
        <div className="td-caption td-side-after">After</div>
        {parts.map((part: Segment) =>
          part.kind !== 'rows' ? (
            <Gap
              key={`${part.kind}-${part.start}`}
              count={part.end - part.start}
              open={part.kind === 'open'}
              onToggle={() => (part.kind === 'open' ? collapse : expand)(part.start)}
              span
            />
          ) : (
            rows.slice(part.start, part.end).map((row, offset, run) => (
              <div className="td-pair" key={part.start + offset}>
                <SplitCell cell={row.left} side="before" previous={run[offset - 1]?.left} next={run[offset + 1]?.left} />
                <SplitCell cell={row.right} side="after" previous={run[offset - 1]?.right} next={run[offset + 1]?.right} />
              </div>
            ))
          ),
        )}
      </div>
      <LineNotice shown={rows.length} total={diff.split.length} />
    </div>
  )
}

function OutputSection({
  row,
  props,
  layout,
  diffs,
}: {
  row: EntityChange<Entity>
  props: RendererProps
  layout: TextDiffLayout
  diffs: Map<string, OutputDiff>
}) {
  const {selectedId, onSelect, comparing} = props
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const expand = useCallback((start: number) => setExpanded(previous => new Set([...previous, start])), [])
  const collapse = useCallback((start: number) => setExpanded(previous => new Set([...previous].filter(item => item !== start))), [])
  const before = row.before && readOutput(row.before),
    after = row.after && readOutput(row.after)
  const output = (after ?? before)!
  const emphasis = props.emphasis(row)
  const selected = selectedId === row.id
  let body: ReactNode
  if (!comparing || (before && after && before.text === after.text)) {
    body = <PlainLines text={output.text} presentation={output.presentation} />
  } else {
    let diff = diffs.get(row.id)
    if (!diff) diffs.set(row.id, (diff = outputDiff(before?.text ?? '', after?.text ?? '')))
    const shared: DiffProps = {diff, presentation: output.presentation, expanded, expand, collapse}
    body = (
      <>
        {!diff.minimal && (
          <p className="graph-notice td-notice" role="status">
            This output is too large to compare line by line, so it is shown as replaced.
          </p>
        )}
        {layout === 'unified' ? <UnifiedDiff {...shared} /> : <SplitDiff {...shared} />}
      </>
    )
  }
  return (
    // A formatted output's label is its command, in the code font; a prose output's is a title.
    <Group
      className="text-diff-command"
      id={row.id}
      selected={selected}
      onSelect={onSelect}
      title={output.label}
      titleFont={output.presentation === 'formatted' ? 'code' : 'text'}
      {...(comparing ? {change: row, emphasis, mark: row} : {})}
    >
      {body}
    </Group>
  )
}

/** The layout control the host draws for a comparison with output. */
export const textDiffControls = [
  {
    id: 'textDiffLayout',
    label: 'Layout',
    type: 'choice',
    default: 'split',
    choices: [
      {value: 'split', label: 'Two columns'},
      {value: 'unified', label: 'One column'},
    ],
  },
] as const satisfies RendererControl[]

function useNarrow() {
  const ref = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  // Measured before paint, so a narrow frame never flashes two columns.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    setNarrow(element.clientWidth < narrowWidth)
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => setNarrow(element.clientWidth < narrowWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, narrow] as const
}

/**
 * Captured text outputs: one revision as numbered lines, or a comparison as a
 * static line diff of every output, in two aligned columns or one.
 */
export function TextDiffView(props: RendererProps<typeof accepts>) {
  const {model, comparing, controls, declareControls, highlighting} = props
  useMemo(() => validateModel(model), [model])
  const rows = useMemo(() => outputOrder(model), [model])
  const diffs = diffCache.get(model) ?? diffCache.set(model, new Map()).get(model)!
  // Two columns or one is a host-drawn control, offered only when there is a comparison to lay out.
  const offered = comparing && rows.length > 0
  useEffect(() => declareControls(offered ? textDiffControls : []), [offered, declareControls])
  const chosen: TextDiffLayout = isLayout(controls.textDiffLayout) ? controls.textDiffLayout : 'split'
  const [ref, narrow] = useNarrow()
  const layout = narrow ? 'unified' : chosen
  // The Changes scope folds the outputs it doesn't show; each output's diff folds its unchanged lines in every scope.
  const {entries, expand, collapse} = useFolds(rows, row => row.id, props.scope)
  // One status width for every header, from the longest status this comparison can show.
  const parts = Math.max(1, ...rows.map(row => statusParts(row).length))
  const style: Style = {
    '--emphasis': comparing ? highlighting : 0,
    ...(comparing ? {'--pk-status-width': parts > 1 ? '21ch' : '11ch'} : {}),
  }
  return (
    <div className="text-diff-view pk-stage" ref={ref} data-layout={layout} style={style}>
      {!rows.length ? (
        <EmptyDomain title="No output">
          {comparing ? 'No output was captured in either revision.' : 'No output was captured for this revision.'}
        </EmptyDomain>
      ) : (
        entries.map(entry =>
          entry.type === 'fold' ? (
            <Fold
              key={`fold:${entry.key}`}
              count={entry.items.length}
              noun="outputs"
              open={entry.open}
              onToggle={() => (entry.open ? collapse : expand)(entry.key)}
            />
          ) : (
            <OutputSection key={entry.item.id} row={entry.item} props={props} layout={layout} diffs={diffs} />
          ),
        )
      )}
    </div>
  )
}
