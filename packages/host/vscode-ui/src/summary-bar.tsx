import type {CSSProperties} from 'react'
import {useEffect, useReducer, useRef, useState} from 'react'
import {
  figuresSentence,
  iconMaskStyle,
  summaryCountText,
  summaryDeltas,
  summaryDeltaText,
  summaryDeltaWords,
  summaryFilterable,
  summaryFactTitle,
  summaryToggle,
  summaryToggleTitle,
  useSummaryFit,
  scopeHiddenShort,
  scopeHiddenText,
} from '@githubnext/projections-host'
import type {ProjectionController, SummaryDelta, SummaryFigure} from '@githubnext/projections-host'
import {uiCodicons} from './codicons.js'
import {regeneratedLabel} from './view-controls.js'
import {Overlay} from './overlay/overlay.js'
import {runningIndicator, runningText} from './running.js'
import type {Running} from './running.js'

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

/** Between two figures: a small muted dot, drawn by controls.css (`.phv-summary-separator`), not part of either. */
const Separator = () => <span aria-hidden="true" className="phv-summary-separator" />

/**
 * A fact figure: its icon, count and noun, in its tone; a filter toggle when it names its items. In a comparison its
 * changes follow, in the Git decoration colors as a count's do, as words for assistive technology; they don't filter.
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
  const {pressed, next} = summaryToggle(p.summaryFilter, figure)
  const content = (
    <>
      {figure.icon && <span aria-hidden="true" data-icon={figure.icon} style={factIcon(figure.icon)} />}
      <span className="phv-cap">{summaryCountText(figure.count, figure.noun)}</span>
    </>
  )
  return (
    <li className="phv-summary-figure" data-summary-figure="" data-summary-key={figure.key} data-summary-fact="">
      {!first && <Separator />}
      {summaryFilterable(figure) ? (
        <button
          type="button"
          className={'phv-summary-button phv-summary-fact'}
          aria-pressed={pressed}
          aria-description={figure.description}
          title={summaryFactTitle(figure, pressed)}
          data-summary-total={figure.count}
          data-tone={figure.tone}
          tabIndex={measure ? -1 : undefined}
          onClick={() => p.setSummaryFilter(next)}
        >
          {content}
        </button>
      ) : (
        <span className={'phv-summary-fact'} title={summaryFactTitle(figure)} data-summary-total={figure.count} data-tone={figure.tone}>
          {content}
          {figure.description && <span className="phv-visually-hidden">, {figure.description}</span>}
        </span>
      )}
      {p.comparing &&
        summaryDeltas
          .filter(delta => figure[delta] > 0)
          .map(delta => (
            <span key={delta} className="phv-summary-delta phv-summary-fact-delta" data-summary-delta={delta}>
              <span aria-hidden="true" className="phv-cap">
                {summaryDeltaText(delta, figure[delta])}
              </span>
              <span className="phv-visually-hidden">{summaryDeltaWords(delta, figure[delta])}</span>
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
  const pressed = (status?: SummaryDelta) => summaryToggle(p.summaryFilter, figure, status).pressed
  const toggle = (status?: SummaryDelta) => p.setSummaryFilter(summaryToggle(p.summaryFilter, figure, status).next)
  const tab = measure ? -1 : undefined
  return (
    <li
      className="phv-summary-figure"
      data-summary-figure=""
      data-summary-key={figure.key}
      data-kinds={figure.kinds.map(kind => kind.kind).join(' ')}
    >
      {!first && <Separator />}
      <button
        type="button"
        className="phv-summary-button"
        aria-pressed={pressed()}
        title={summaryToggleTitle(figure, pressed())}
        data-summary-total={figure.count}
        tabIndex={tab}
        onClick={() => toggle()}
      >
        <span className="phv-cap">{summaryCountText(figure.count, figure.noun)}</span>
      </button>
      {p.comparing &&
        summaryDeltas
          .filter(delta => figure[delta] > 0)
          .map(delta => (
            <button
              key={delta}
              type="button"
              className="phv-summary-button phv-summary-delta"
              data-summary-delta={delta}
              aria-pressed={pressed(delta)}
              aria-label={`${summaryCountText(figure[delta], figure.noun)} ${delta}`}
              title={pressed(delta) ? 'Show every item' : `Show only the ${figure.noun.plural} ${delta}`}
              tabIndex={tab}
              onClick={() => toggle(delta)}
            >
              <span className="phv-cap">{summaryDeltaText(delta, figure[delta])}</span>
            </button>
          ))}
    </li>
  )
}

/** A job as the bar shows it: only once it has run a moment, then for at least a moment (`runningIndicator`). */
function useShownRunning(running: Running | undefined): Running | undefined {
  const [, changed] = useReducer((count: number) => count + 1, 0)
  const [indicator] = useState(() => runningIndicator(changed))
  useEffect(() => {
    const before = indicator.current
    indicator.set(running)
    if (indicator.current !== before) changed()
  }, [indicator, running])
  useEffect(() => () => indicator.dispose(), [indicator])
  return indicator.current
}

/**
 * The summary bar along the bottom of every projection view, drawn like VS Code's status bar: 22px of small
 * description-foreground text over the side bar's background, under a hairline. A figure per kind in the renderer's
 * words (`12 workspaces · 18 dependencies`), and in a comparison the changes of each in VS Code's Git decoration colors
 * (`+1 −1`); every figure filters to its items. The counts of items regenerated from the same inputs (the sparkle
 * codicon) and that varied within tolerance (the pulse codicon) sit at its end. Figures that don't fit move into a "…"
 * widget. A host that runs the view's jobs (`running`, `null`
 * while none runs) gets a slot at the very end, kept whether or not a job runs so nothing moves: a spinning `sync`
 * codicon (still under reduced motion) while one extracts or compares, with "Extracting…" or "Comparing…" as its
 * tooltip and in a polite live region.
 */
export function SummaryBar({
  projection: p,
  running,
  className,
}: {
  projection: ProjectionController
  running?: Running | null | undefined
  className?: string
}) {
  const shownRunning = useShownRunning(running ?? undefined)
  const bar = useRef<HTMLDivElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const figures = p.summary
  const within = p.comparing ? (p.variation?.within ?? 0) : 0
  const regenerated = p.comparing ? (p.variation?.regenerated ?? 0) : 0
  const sentence = figuresSentence(figures, p.comparing)
  // What the Changes scope leaves out, at the bar's end beside Show all.
  const hiddenShort = p.comparing && p.scope === 'changes' ? scopeHiddenShort(p.scopeHidden) : undefined
  const shown = useSummaryFit(
    bar,
    figures.length,
    `${sentence}|${within}|${regenerated}|${p.comparing}|${running !== undefined}|${hiddenShort ?? ''}`,
  )
  const hidden = figures.slice(shown)
  return (
    <div
      ref={bar}
      role="group"
      aria-label="Summary"
      data-summary-bar=""
      data-sentence={sentence}
      className={`phv-summary-bar ${className ?? ''}`}
    >
      {/* Every figure once more, unseen and clipped to the bar, for measuring what fits (useSummaryFit). */}
      <div aria-hidden="true" data-summary-measure="" className="phv-summary-measure">
        <ul className="phv-summary-measure-row">
          {figures.map((figure, index) => (
            <Figure key={figure.key} projection={p} figure={figure} first={index === 0} measure />
          ))}
          <li data-summary-more="" className="phv-summary-more" />
        </ul>
      </div>
      <ul className="phv-summary-figures" aria-label={sentence}>
        {figures.slice(0, shown).map((figure, index) => (
          <Figure key={figure.key} projection={p} figure={figure} first={index === 0} />
        ))}
      </ul>
      {hidden.length > 0 && (
        <>
          <button
            ref={more}
            type="button"
            data-summary-overflow=""
            className="phv-summary-button phv-summary-more"
            aria-label={`${hidden.length.toLocaleString()} more`}
            title={`${hidden.length.toLocaleString()} more`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <span className={`codicon codicon-${uiCodicons.more}`} aria-hidden="true" />
          </button>
          <Overlay
            open={open}
            onClose={() => setOpen(false)}
            anchor={more}
            placement="below-start"
            role="dialog"
            label="More of the summary"
            className="phv-widget phv-summary-popover"
          >
            <ul className="phv-summary-list">
              {hidden.map(figure => (
                <Figure key={figure.key} projection={p} figure={figure} first />
              ))}
            </ul>
          </Overlay>
        </>
      )}
      <span aria-hidden="true" className="phv-summary-spacer" />
      {hiddenShort && (
        <span data-summary-fixed="" data-scope-hidden="" className="phv-summary-fixed phv-summary-hidden">
          <span className="phv-cap" title={scopeHiddenText(p.scopeHidden)}>
            {hiddenShort}
          </span>
          <button type="button" className="phv-summary-button phv-summary-show-all" onClick={() => p.setScope('all')}>
            <span className="phv-cap">Show all</span>
          </button>
        </span>
      )}
      {regenerated > 0 && (
        <span data-summary-fixed="" className="phv-summary-fixed">
          <button
            type="button"
            className="phv-summary-button phv-summary-varied phv-summary-regenerated"
            aria-pressed={p.regeneratedOnly}
            title={
              p.regeneratedOnly ? 'Show every item' : 'Show only the items whose generated values were regenerated from the same inputs'
            }
            data-regenerated={regenerated}
            data-focus-id="regenerated"
            onClick={() => p.setRegeneratedOnly(!p.regeneratedOnly)}
          >
            <span className={`codicon codicon-${uiCodicons.generated}`} aria-hidden="true" />
            <span className="phv-varied-text phv-cap">{regeneratedLabel(regenerated)}</span>
          </button>
        </span>
      )}
      {within > 0 && (
        <span data-summary-fixed="" className="phv-summary-fixed">
          <button
            type="button"
            className="phv-summary-button phv-summary-varied"
            aria-pressed={p.variedOnly}
            title={p.variedOnly ? 'Show every item' : 'Show only the items that varied within tolerance'}
            data-varied-within={within}
            data-focus-id="varied"
            onClick={() => p.setVariedOnly(!p.variedOnly)}
          >
            <span className={`codicon codicon-${uiCodicons.varied}`} aria-hidden="true" />
            <span className="phv-varied-text phv-cap">{within.toLocaleString()} varied within tolerance</span>
          </button>
        </span>
      )}
      {running !== undefined && (
        <span
          data-summary-fixed=""
          data-summary-running={shownRunning ?? ''}
          data-motion={p.reducedMotion ? 'reduced' : 'full'}
          className="phv-summary-running"
          role="status"
          aria-live="polite"
          title={shownRunning ? runningText(shownRunning) : undefined}
        >
          {shownRunning && (
            <>
              <span className="codicon codicon-sync codicon-modifier-spin" aria-hidden="true" />
              <span className="phv-visually-hidden">{runningText(shownRunning)}</span>
            </>
          )}
        </span>
      )}
    </div>
  )
}
