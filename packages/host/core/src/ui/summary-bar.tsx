import type {CSSProperties} from 'react'
import {useRef} from 'react'
import {Activity, Ellipsis, Sparkle} from 'lucide-react'
import {summaryCountText, summaryDeltas, summaryDeltaText, summaryDeltaWords} from '@githubnext/projections-renderer-sdk/presentation'
import type {SummaryDelta} from '@githubnext/projections-renderer-sdk/presentation'
import {iconMaskStyle} from '@githubnext/projections-renderer-sdk/protocol'
import type {ProjectionController} from '../projection.js'
import {figuresSentence, sameSummaryFilter, summaryFilterable, summaryFilterOf, useSummaryFit} from '../summary.js'
import type {SummaryFigure} from '../summary.js'
import {Popover, PopoverContent, PopoverTrigger} from './components/popover.js'
import {scopeHiddenShort, scopeHiddenText} from '../scope.js'
import {cn} from './lib/utils.js'

const deltaTone: Record<SummaryDelta, string> = {
  added: 'pj:text-added',
  removed: 'pj:text-removed',
  modified: 'pj:text-modified',
}

/** Between two figures: a small muted dot, drawn by components.css (`.ph-summary-separator`), not part of either. */
const Separator = () => <span aria-hidden="true" className="ph-summary-separator" />

/** A figure's button. Pressed (a filter on) and keyboard focus are drawn by projector.css (`.ph-summary-button`). */
const figureButton =
  'ph-summary-button pj:inline-flex pj:h-5 pj:shrink-0 pj:items-center pj:rounded-sm pj:px-1 pj:whitespace-nowrap pj:transition-colors pj:hover:bg-accent pj:hover:text-foreground pj:focus-visible:outline-hidden'

/**
 * A fact's icon: its theme icon token drawn in the text color, a badge (`badgeIconNames`: a change kind, a planned
 * action or breaking) as its disc with the glyph cut out, as in the renderer; nothing for a name the theme lacks.
 */
const factIcon = (icon: string): CSSProperties => ({
  width: 12,
  height: 12,
  flex: 'none',
  backgroundColor: 'currentColor',
  ...iconMaskStyle(icon),
})

/** A fact's tooltip: its description, then what activating it does when it filters. */
const factTitle = (figure: SummaryFigure, pressed: boolean | undefined) =>
  [figure.description, pressed === undefined ? undefined : pressed ? 'Show every item' : `Show only the ${figure.noun.plural}`]
    .filter(Boolean)
    .join('\n') || undefined

/**
 * A fact figure: its icon, count and noun, in its tone; a filter toggle when it names its items. In a comparison its
 * changes follow, in their change colors as a count's do, as words for assistive technology; they don't filter.
 */
function Fact({
  projection: p,
  figure,
  first,
  measure,
}: {
  projection: ProjectionController
  figure: SummaryFigure
  first: boolean
  measure?: boolean
}) {
  const filter = summaryFilterOf(figure)
  const pressed = sameSummaryFilter(p.summaryFilter, filter)
  const tone = figure.tone && figure.tone !== 'neutral' ? deltaTone[figure.tone] : undefined
  const content = (
    <>
      {figure.icon && <span aria-hidden="true" data-icon={figure.icon} style={factIcon(figure.icon)} />}
      <span className="ph-cap">{summaryCountText(figure.count, figure.noun)}</span>
    </>
  )
  const filterable = summaryFilterable(figure)
  return (
    <li
      className="ph-summary-figure pj:flex pj:shrink-0 pj:items-center"
      data-summary-figure=""
      data-summary-key={figure.key}
      data-summary-fact=""
    >
      {!first && <Separator />}
      {filterable ? (
        <button
          type="button"
          className={cn(figureButton, 'pj:gap-1', tone)}
          aria-pressed={pressed}
          aria-description={figure.description}
          title={factTitle(figure, pressed)}
          data-summary-total={figure.count}
          data-tone={figure.tone}
          tabIndex={measure ? -1 : undefined}
          onClick={() => p.setSummaryFilter(pressed ? null : filter)}
        >
          {content}
        </button>
      ) : (
        <span
          className={cn('pj:inline-flex pj:h-5 pj:items-center pj:gap-1 pj:px-1 pj:whitespace-nowrap', tone)}
          title={factTitle(figure, undefined)}
          data-summary-total={figure.count}
          data-tone={figure.tone}
        >
          {content}
          {figure.description && <span className="pj:sr-only">, {figure.description}</span>}
        </span>
      )}
      {p.comparing &&
        summaryDeltas
          .filter(delta => figure[delta] > 0)
          .map(delta => (
            <span
              key={delta}
              className={cn('pj:inline-flex pj:h-5 pj:items-center pj:px-0.5 pj:whitespace-nowrap pj:tabular-nums', deltaTone[delta])}
              data-summary-delta={delta}
            >
              <span aria-hidden="true" className="ph-cap">
                {summaryDeltaText(delta, figure[delta])}
              </span>
              <span className="pj:sr-only">{summaryDeltaWords(delta, figure[delta])}</span>
            </span>
          ))}
    </li>
  )
}

/** One figure: its total, then in a comparison each change count that happened, each a filter toggle. */
function Figure({
  projection: p,
  figure,
  first,
  measure,
}: {
  projection: ProjectionController
  figure: SummaryFigure
  first: boolean
  measure?: boolean
}) {
  if (figure.type === 'fact') return <Fact projection={p} figure={figure} first={first} {...(measure ? {measure} : {})} />
  const toggle = (status?: SummaryDelta) => {
    const next = summaryFilterOf(figure, status)
    p.setSummaryFilter(sameSummaryFilter(p.summaryFilter, next) ? null : next)
  }
  const pressed = (status?: SummaryDelta) => sameSummaryFilter(p.summaryFilter, summaryFilterOf(figure, status))
  const total = summaryCountText(figure.count, figure.noun)
  const tab = measure ? -1 : undefined
  return (
    <li
      className="ph-summary-figure pj:flex pj:shrink-0 pj:items-center"
      data-summary-figure=""
      data-summary-key={figure.key}
      data-kinds={figure.kinds.map(kind => kind.kind).join(' ')}
    >
      {!first && <Separator />}
      <button
        type="button"
        className={figureButton}
        aria-pressed={pressed()}
        title={pressed() ? 'Show every item' : `Show only the ${figure.noun.plural}`}
        data-summary-total={figure.count}
        tabIndex={tab}
        onClick={() => toggle()}
      >
        <span className="ph-cap">{total}</span>
      </button>
      {p.comparing &&
        summaryDeltas
          .filter(delta => figure[delta] > 0)
          .map(delta => (
            <button
              key={delta}
              type="button"
              className={cn(figureButton, 'pj:px-0.5 pj:tabular-nums', deltaTone[delta])}
              aria-pressed={pressed(delta)}
              aria-label={`${summaryCountText(figure[delta], figure.noun)} ${delta}`}
              title={pressed(delta) ? 'Show every item' : `Show only the ${figure.noun.plural} ${delta}`}
              data-summary-delta={delta}
              tabIndex={tab}
              onClick={() => toggle(delta)}
            >
              <span className="ph-cap">{summaryDeltaText(delta, figure[delta])}</span>
            </button>
          ))}
    </li>
  )
}

/**
 * The summary bar along the bottom of every projection view, like an editor's status bar: a band of the header's
 * surface, edge to edge, 28px under the hairline that rules it off above (so its 20px figures sit on whole pixels),
 * whose figures sit centred, at least as far from its edges as a capital E's cap height is from its top and bottom (its
 * padding is that space less the figure's own 4px and the E's left side bearing, about 0.1em). It shows a figure per kind in the renderer's words (`12 workspaces · 18
 * dependencies`), and in a comparison the changes of each in their change colors (`+1 −1`). Every figure filters to
 * its items, within the scope; pressed again, every item returns. The count of items that varied within
 * tolerance sits at its end as the same kind of toggle, and so does the count of items whose generated values were
 * regenerated from the same inputs ("N regenerated"). Figures that don't fit move into a "…" popover.
 */
/**
 * What the Changes scope leaves out, at the bar's end: "57 unchanged tables hidden" (every kind in its tooltip) and Show
 * all, which shows every item. Nothing while another scope shows, or when Changes hides nothing.
 */
function ScopeHiddenFigure({projection: p}: {projection: ProjectionController}) {
  const short = p.comparing && p.scope === 'changes' ? scopeHiddenShort(p.scopeHidden) : undefined
  if (!short) return null
  return (
    <span data-summary-fixed="" data-scope-hidden="" className="pj:flex pj:shrink-0 pj:items-center pj:gap-1">
      <span className="ph-cap" title={scopeHiddenText(p.scopeHidden)}>
        {short}
      </span>
      <button type="button" className={cn(figureButton, 'ph-scope-show-all pj:text-foreground')} onClick={() => p.setScope('all')}>
        <span className="ph-cap">Show all</span>
      </button>
    </span>
  )
}

export function SummaryBar({projection: p, className}: {projection: ProjectionController; className?: string}) {
  const bar = useRef<HTMLDivElement>(null)
  const figures = p.summary
  const within = p.comparing ? (p.variation?.within ?? 0) : 0
  const regenerated = p.comparing ? (p.variation?.regenerated ?? 0) : 0
  const sentence = figuresSentence(figures, p.comparing)
  const shown = useSummaryFit(
    bar,
    figures.length,
    `${sentence}|${within}|${regenerated}|${p.comparing}|${p.scope === 'changes' ? (scopeHiddenShort(p.scopeHidden) ?? '') : ''}`,
  )
  const hidden = figures.slice(shown)
  return (
    <div
      ref={bar}
      role="group"
      aria-label="Summary"
      data-summary-bar=""
      data-sentence={sentence}
      className={cn(
        'ph-summary-bar pj:relative pj:flex pj:h-[calc(1.75rem_+_1px)] pj:min-w-0 pj:shrink-0 pj:items-center pj:gap-1 pj:overflow-hidden pj:border-t pj:border-divider pj:bg-surface-header pj:[--pj-summary-surface:var(--pj-surface-header)] pj:px-[calc((1.75rem_-_1cap)/2_-_0.25rem_-_0.1em)] pj:text-xs pj:text-muted-foreground',
        className,
      )}
    >
      {/* Every figure once more, unseen and clipped to the bar, for measuring what fits (useSummaryFit). */}
      <div
        aria-hidden="true"
        data-summary-measure=""
        className="pj:pointer-events-none pj:invisible pj:absolute pj:inset-0 pj:overflow-hidden"
      >
        <ul className="pj:flex pj:w-max pj:items-center">
          {figures.map((figure, index) => (
            <Figure key={figure.key} projection={p} figure={figure} first={index === 0} measure />
          ))}
          <li data-summary-more="" className="pj:inline-flex pj:size-5 pj:shrink-0" />
        </ul>
      </div>
      {/* With the trailing spacer, centres the figures in the bar (the toggles stay at its end). */}
      <span aria-hidden="true" className="ph-summary-lead pj:flex-1" />
      <ul className="ph-summary-figures pj:flex pj:min-w-0 pj:items-center" aria-label={sentence}>
        {figures.slice(0, shown).map((figure, index) => (
          <Figure key={figure.key} projection={p} figure={figure} first={index === 0} />
        ))}
      </ul>
      {hidden.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(figureButton, 'ph-summary-more pj:size-5 pj:justify-center pj:px-0 pj:[&_svg]:size-3.5')}
              aria-label={`${hidden.length.toLocaleString()} more`}
              title={`${hidden.length.toLocaleString()} more`}
            >
              <Ellipsis aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="top"
            collisionPadding={8}
            aria-label="More of the summary"
            className="ph-summary-popover pj:[--pj-summary-surface:var(--pj-popover)] pj:w-auto pj:max-w-[calc(100vw-1rem)] pj:gap-1 pj:p-2 pj:text-xs pj:text-muted-foreground"
          >
            <ul className="pj:flex pj:flex-col pj:gap-1">
              {hidden.map(figure => (
                <Figure key={figure.key} projection={p} figure={figure} first />
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
      <span aria-hidden="true" className="pj:flex-1" />
      <ScopeHiddenFigure projection={p} />
      {regenerated > 0 && (
        <span data-summary-fixed="" className="pj:flex pj:shrink-0">
          <button
            type="button"
            className={cn(figureButton, 'ph-regenerated-toggle pj:gap-1 pj:[&_svg]:size-3 pj:[&_svg]:shrink-0')}
            aria-pressed={p.regeneratedOnly}
            title={
              p.regeneratedOnly ? 'Show every item' : 'Show only the items whose generated values were regenerated from the same inputs'
            }
            data-regenerated={regenerated}
            onClick={() => p.setRegeneratedOnly(!p.regeneratedOnly)}
          >
            <Sparkle aria-hidden="true" />
            <span className="ph-cap">{regenerated.toLocaleString()} regenerated</span>
          </button>
        </span>
      )}
      {within > 0 && (
        <span data-summary-fixed="" className="pj:flex pj:shrink-0">
          <button
            type="button"
            className={cn(figureButton, 'ph-varied-toggle pj:gap-1 pj:[&_svg]:size-3 pj:[&_svg]:shrink-0')}
            aria-pressed={p.variedOnly}
            title={p.variedOnly ? 'Show every item' : 'Show only the items that varied within tolerance'}
            data-varied-within={within}
            onClick={() => p.setVariedOnly(!p.variedOnly)}
          >
            <Activity aria-hidden="true" />
            <span className="ph-cap">{within.toLocaleString()} varied within tolerance</span>
          </button>
        </span>
      )}
    </div>
  )
}
