import {useEffect, useId, useMemo} from 'react'
import {
  codeStatisticsControlsFor,
  codeStatisticsOptions,
  categoryPalette,
  humanizeKind,
  languageCategory,
  plainCategory,
} from '@githubnext/projections-renderer-kit'
import {EmptyDomain, useFrameFill, useFrameSizing, useLegend} from '@githubnext/projections-renderer-kit/react'
import type {RendererLegend} from '@githubnext/projections-renderer-kit'
import type {RendererProps} from '@githubnext/projections-renderer-kit/react'
import {genericMetrics, sentenceCase, sharedUnit} from '@githubnext/projections-renderer-sdk/presentation'
import type {StatisticsKey} from '@githubnext/projections-renderer-sdk/presentation'
import type {Entity} from '@githubnext/projections-schemas'
import {codeStatisticsMeasures, statisticsMotion} from './timeline.js'
import type {StatisticsMotion} from './timeline.js'
import type {accepts} from './accepts.js'
import {BarsChart} from './bars.js'
import {statisticsColumns} from './columns.js'
import {rowPresentation} from './presentation.js'
import {amount, composition, compositionSeries, languageSeries} from './series.js'
import type {Series} from './series.js'
import {ShareChart} from './share.js'
import {StatisticsTable, statisticsTableControls} from './table.js'
import {DiffShareChart} from './share-diff.js'

/** Rows drawn at once; the host's table presents the complete model. */
export const statisticsRowLimit = 24

/** Diff mode draws one static frame: every language of either revision at its After count, fully present. */
const settled: StatisticsMotion = {size: 1, opacity: 1, mix: 1, local: 1}

/** What generic measurements' rows are: their shared entity kind (`scope`), else `item`. */
function metricRows(entities: readonly (Entity | undefined)[]): string {
  const kinds = new Set(entities.flatMap(entity => (entity ? [entity.kind] : [])))
  const [kind] = kinds
  return kinds.size === 1 && kind ? humanizeKind(kind).singular : 'item'
}

export function CodeStatisticsRenderer(props: RendererProps<typeof accepts>) {
  const {model, schedule, progress, highlighting, comparing, selectedId, onSelect, locale} = props
  const diff = props.diff && comparing
  // Files, measure, grouping and chart are host-drawn controls; Files is offered when the extraction counts tests.
  // Generic measurements (no line counts) draw each entity's `data.value`, so only the chart is offered.
  const entities = useMemo(() => model.entities.flatMap(row => [row.before, row.after]), [model])
  const metrics = useMemo(() => genericMetrics(entities), [entities])
  const options = codeStatisticsOptions(props.controls)
  const measure: StatisticsKey = metrics ? 'value' : options.measure
  const byLanguage = metrics || options.byLanguage
  const scope = metrics ? 'all' : options.scope
  const chart = options.chart
  const {declareControls} = props
  // The table chart adds its sort, which its headings set too.
  const declared = useMemo(
    () => [...codeStatisticsControlsFor(entities), ...(chart === 'table' ? statisticsTableControls(metrics) : [])],
    [entities, chart, metrics],
  )
  useEffect(() => declareControls(declared), [declared, declareControls])
  const motionOf = useMemo(() => (diff ? () => settled : statisticsMotion(model, schedule)), [diff, model, schedule])
  const patternId = `stat-hatch-${useId().replaceAll(/[^A-Za-z0-9_-]/g, '')}`
  const number = useMemo(() => {
    const format = new Intl.NumberFormat(locale)
    return (value: number) => format.format(value)
  }, [locale])

  // Every language the comparison presents, present or not. Keeping the set
  // stable is what lets a language leave without shuffling its neighbours'
  // colours or snapping the rows below it upwards.
  const tracked = model.entities
  const motions = useMemo(() => new Map(tracked.map(change => [change.id, motionOf(change.id, progress)])), [tracked, motionOf, progress])

  // Colors depend only on each language and the whole document, never on progress, so they hold for the transition.
  // Generic measurements name things, not languages, so they take categorical colors chosen to stay apart.
  const categories = useMemo(
    () =>
      new Map(
        tracked.map(change => {
          const name = (change.after ?? change.before)?.label ?? change.id
          return [change.id, metrics ? plainCategory(change.id, name) : languageCategory(name)]
        }),
      ),
    [tracked, metrics],
  )
  const palette = useMemo(
    () =>
      categoryPalette(
        tracked.map(change => ({
          category: categories.get(change.id)!,
          weight: Math.max(amount(change.before, measure, scope), amount(change.after, measure, scope)),
        })),
        props.colorMode,
        {distinct: metrics},
      ),
    [tracked, categories, measure, scope, props.colorMode, metrics],
  )
  const series: Series[] = useMemo(
    () =>
      byLanguage
        ? languageSeries({tracked, motions, measure, scope, diff, palette, categories})
        : compositionSeries({tracked, motions, scope}),
    [tracked, motions, measure, byLanguage, scope, palette, categories, diff],
  )

  const unit = useMemo(() => sharedUnit(entities), [entities])
  const rows = metrics ? metricRows(entities) : byLanguage ? 'language' : 'line kind'
  const noun = metrics ? (unit ?? 'value') : byLanguage ? codeStatisticsMeasures.find(item => item.id === measure)!.unit : 'lines'
  const shown = series.slice(0, statisticsRowLimit)
  // The share chart's colour key, drawn once by the host. Series order and colour depend only on the larger of the two
  // counts, and labels are the latest revision's, so the key never changes while scrubbing.
  const legendKey =
    chart === 'share'
      ? shown.map(item => {
          const change = item.entity ? tracked.find(entry => entry.id === item.id) : undefined
          const entity = change && (change.after ?? change.before)
          return {label: entity ? (entity.label ?? entity.id) : item.label, ...item.swatch}
        })
      : []
  const legend: RendererLegend | undefined = legendKey.length
    ? {title: metrics ? sentenceCase(humanizeKind(rows).plural) : byLanguage ? 'Languages' : 'Line kinds', items: legendKey}
    : undefined
  useLegend(props.reportLegend, legend)
  const p = rowPresentation({diff, grouping: rows, noun, highlighting, emphasis: props.emphasis, selectedId, onSelect, number})
  const total = series.reduce((sum, item) => sum + p.value(item), 0)
  const totalBefore = series.reduce((sum, item) => sum + item.before, 0)
  const totalAfter = series.reduce((sum, item) => sum + item.after, 0)
  const scale = Math.max(1, ...shown.map(item => Math.max(item.before, item.after)))
  const labels = byLanguage
    ? tracked.flatMap(change => [change.before?.label ?? '', change.after?.label ?? ''])
    : composition.map(part => part.label)
  const columns = statisticsColumns({shown, tracked, labels, count: p.count, number, diff, highlighting})
  // A host that sizes the frame itself (a tab, a gallery's stage) gets the share chart grown to the frame's height; a
  // content-sized host gets it at its own size, as before.
  const fills = useFrameSizing() !== 'content' && chart === 'share' && shown.length > 0

  return (
    <div className="statistics-view pk-stage" style={columns} data-diff-highlighting={comparing} data-fills={fills ? '' : undefined}>
      {fills && <FillsFrame />}
      <div className="statistics-panel" data-chart={chart} data-projections-content="">
        {/* The host's summary bar states the total, its change and the languages; the chart starts at the top. */}
        {/* The table lists every language whatever the measure counts, so only an extraction without any is empty. */}
        {(chart === 'table' ? !tracked.length : !shown.length) ? (
          <EmptyDomain title="Nothing counted at this point">
            {metrics ? 'This extraction has no measurements to show.' : 'This extraction has no language counts to show.'}
          </EmptyDomain>
        ) : chart === 'table' ? (
          <StatisticsTable
            props={props}
            metrics={metrics}
            rows={metrics ? rows : 'language'}
            scope={scope}
            rowProgress={id => (diff ? 1 : (motions.get(id)?.local ?? 1))}
          />
        ) : chart === 'bars' ? (
          <BarsChart shown={shown} scale={scale} p={p} />
        ) : diff ? (
          <DiffShareChart shown={shown} total={total} totalBefore={totalBefore} totalAfter={totalAfter} p={p} />
        ) : (
          <ShareChart shown={shown} total={total} patternId={patternId} p={p} />
        )}

        {chart !== 'table' && series.length > shown.length && (
          <p className="graph-notice" role="status">
            Showing the largest {statisticsRowLimit} of {series.length} {metrics ? humanizeKind(rows).plural : 'languages'}. Use the host's
            table for the complete model.
          </p>
        )}
        {!byLanguage && chart !== 'table' && (
          <p className="domain-caption">Every physical line counts once. A line carrying both code and a comment counts as code.</p>
        )}
      </div>
    </div>
  )
}

/** While mounted, the renderer fills its frame's height (see `useFrameFill`), reporting no content height of its own. */
function FillsFrame() {
  useFrameFill(undefined)
  return null
}
