import type {ProjectionController} from '@githubnext/projections-host'
import type {Diagnostic} from '@githubnext/projections-schemas'
import {Prose} from './prose.js'
import {uiCodicons} from './codicons.js'
import {rendererLabel} from './features.js'
import {ToolbarPopover} from './toolbar-popover.js'
import type {PopoverControl} from './toolbar-popover.js'
import {keyed} from '@githubnext/projections-renderer-sdk/presentation'

/** The default for an optional list prop: one array, so a default never changes between renders. */
const none: readonly never[] = []

/** The sentence for the comparator that produced a comparison, with VS Code's workspace trust codicon. */
export function ComparatorLine({comparator, className}: {comparator: {id: string; digest: string}; className?: string}) {
  return (
    <p className={`phv-muted phv-comparator ${className ?? ''}`}>
      <span className={`codicon codicon-${uiCodicons.verified} phv-comparator-icon`} aria-hidden="true" />
      <span>
        Compared in this browser with{' '}
        {comparator.id === 'default' ? (
          'the default comparator'
        ) : (
          <>
            the custom comparator <code className="phv-code">{comparator.id}</code>
          </>
        )}{' '}
        (<code className="phv-code">{comparator.digest.slice(0, 19)}…</code>)
        {comparator.id === 'default' ? '' : ', validated against both extractions'}.
      </span>
    </p>
  )
}

/** Limitations the extractions declare in `metadata.limitations`. */
export function subjectLimitations(p: Pick<ProjectionController, 'subject'>): string[] {
  const {subject} = p
  return [
    ...new Set(
      (subject.mode === 'extraction' ? [subject.extraction] : [subject.before, subject.after]).flatMap(extraction =>
        Array.isArray(extraction.metadata?.limitations)
          ? extraction.metadata.limitations.filter((item): item is string => typeof item === 'string')
          : [],
      ),
    ),
  ]
}

/** An About action whose widget (VS Code's hover) holds the title, summary, active renderer, comparator, diagnostics and limitations. */
export function InfoButton({
  projection: p,
  comparator,
  diagnostics = none,
  control,
}: {
  projection: ProjectionController
  comparator?: {id: string; digest: string} | undefined
  diagnostics?: readonly Diagnostic[] | undefined
  control?: PopoverControl
}) {
  const {subject} = p
  const counts = subject.mode === 'extraction' ? subject.extraction : subject.after
  const limitations = subjectLimitations(p)
  const errors = diagnostics.some(diagnostic => diagnostic.severity === 'error')
  return (
    <ToolbarPopover
      icon={uiCodicons.info}
      label="About this projection"
      title="About this projection"
      className="phv-info"
      active={errors}
      control={control}
      focusId="info"
    >
      <h3 className="phv-widget-title" tabIndex={-1} data-autofocus="">
        {p.projection.title}
      </h3>
      <p className="phv-muted phv-popover-note">
        <code className="phv-code">{counts.schema}</code> · {counts.entities.length.toLocaleString()} entities ·{' '}
        {counts.relationships.length.toLocaleString()} relationships
        {subject.mode === 'comparison' ? ` · ${subject.comparison.changes.length.toLocaleString()} changes` : ''}
      </p>
      <p className="phv-popover-line">
        <span className={`codicon codicon-${uiCodicons.verified} phv-active-icon`} aria-hidden="true" />
        <span>
          <span className="phv-muted">Showing:</span> <strong>{rendererLabel(p)}</strong>
        </span>
      </p>
      {comparator && <ComparatorLine comparator={comparator} />}
      {(diagnostics.length > 0 || limitations.length > 0) && (
        <div className="phv-widget-section">
          <h4 className="phv-section-title">Diagnostics and limitations</h4>
          <ul className="phv-info-list">
            {keyed(diagnostics, diagnostic => `${diagnostic.code}:${diagnostic.path}:${diagnostic.message}`).map(([key, diagnostic]) => (
              <li key={key} data-severity={diagnostic.severity}>
                <span
                  className={`codicon codicon-${diagnostic.severity === 'error' ? 'error' : diagnostic.severity === 'warning' ? 'warning' : 'info'}`}
                  aria-hidden="true"
                />
                <span>
                  <strong>
                    {diagnostic.severity}: {diagnostic.code}
                  </strong>{' '}
                  <Prose>{diagnostic.message}</Prose> <code className="phv-code">{diagnostic.path}</code>
                </span>
              </li>
            ))}
            {keyed(limitations, limitation => limitation).map(([key, limitation]) => (
              <li key={`limitation-${key}`} data-severity="limitation">
                <span className="codicon codicon-info" aria-hidden="true" />
                <span>{limitation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ToolbarPopover>
  )
}
