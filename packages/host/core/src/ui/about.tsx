import {Info, ShieldCheck} from 'lucide-react'
import type {Diagnostic} from '@githubnext/projections-schemas'
import type {ProjectionController} from '../projection.js'
import {Badge} from './components/badge.js'
import {cn} from './lib/utils.js'
import {rendererLabel} from '../view-model.js'
import {ToolbarPopover} from './toolbar-popover.js'
import {keyed} from '@githubnext/projections-renderer-sdk/presentation'

/** The default for an optional list prop: one array, so a default never changes between renders. */
const none: readonly never[] = []

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

/** The sentence naming the comparator that produced a comparison. */
export function ComparatorLine({comparator, className}: {comparator: {id: string; digest: string}; className?: string}) {
  return (
    <p className={cn('pj:flex pj:min-w-0 pj:items-start pj:gap-1.5 pj:break-words pj:text-xs pj:text-muted-foreground', className)}>
      <ShieldCheck aria-hidden="true" className="pj:mt-px pj:size-3.5 pj:shrink-0" />
      <span>
        Compared in this browser with{' '}
        {comparator.id === 'default' ? (
          'the default comparator'
        ) : (
          <>
            the custom comparator <code className="pj:font-mono">{comparator.id}</code>
          </>
        )}{' '}
        (<code className="pj:break-all pj:font-mono">{comparator.digest.slice(0, 19)}…</code>)
        {comparator.id === 'default' ? '' : ', validated against both extractions'}.
      </span>
    </p>
  )
}

/**
 * An About button ("About this projection") whose popover holds the title, schema and counts, the active renderer,
 * the comparator and the diagnostics and limitations. A dot marks error diagnostics.
 */
export function InfoButton({
  projection: p,
  comparator,
  diagnostics = none,
}: {
  projection: ProjectionController
  comparator?: {id: string; digest: string} | undefined
  diagnostics?: readonly Diagnostic[] | undefined
}) {
  const {subject} = p
  const counts = subject.mode === 'extraction' ? subject.extraction : subject.after
  const limitations = subjectLimitations(p)
  return (
    <ToolbarPopover
      icon={<Info />}
      label="About this projection"
      title="About this projection"
      className="ph-info"
      contentClassName="pj:w-96"
      active={diagnostics.some(item => item.severity === 'error')}
    >
      <div className="pj:flex pj:min-w-0 pj:flex-col pj:gap-0.5">
        <h3 className="pj:break-words pj:font-semibold pj:leading-tight">{p.projection.title}</h3>
        <p className="pj:text-xs pj:text-muted-foreground">
          <code className="pj:font-mono">{counts.schema}</code> · {counts.entities.length.toLocaleString()} entities ·{' '}
          {counts.relationships.length.toLocaleString()} relationships
          {subject.mode === 'comparison' ? ` · ${subject.comparison.changes.length.toLocaleString()} changes` : ''}
        </p>
      </div>
      <p className="ph-info-active pj:text-xs">
        <span className="pj:text-muted-foreground">Showing:</span> <strong className="pj:font-medium">{rendererLabel(p)}</strong>
      </p>
      {comparator && <ComparatorLine comparator={comparator} />}
      {(diagnostics.length > 0 || limitations.length > 0) && (
        <section
          className="ph-diagnostics pj:flex pj:min-w-0 pj:flex-col pj:gap-1.5 pj:border-t pj:pt-3"
          aria-label="Diagnostics and limitations"
        >
          <h4 className="pj:text-xs pj:font-medium">Diagnostics and limitations</h4>
          <ul className="pj:flex pj:max-h-64 pj:flex-col pj:gap-2 pj:overflow-auto pj:text-xs">
            {keyed(diagnostics, diagnostic => `${diagnostic.code}:${diagnostic.path}:${diagnostic.message}`).map(([key, diagnostic]) => (
              <li
                key={key}
                className={cn('pj:flex pj:min-w-0 pj:flex-col pj:gap-0.5', diagnostic.severity === 'error' ? 'ph-error' : 'ph-warning')}
              >
                <span className="pj:flex pj:items-center pj:gap-1.5">
                  <Badge
                    variant={diagnostic.severity === 'error' ? 'destructive' : 'secondary'}
                    className="pj:px-1.5 pj:py-0 pj:text-[11px] pj:font-medium"
                  >
                    {diagnostic.severity}
                  </Badge>
                  <strong className="pj:font-mono pj:font-medium">{diagnostic.code}</strong>
                </span>
                <span className="pj:break-words">{diagnostic.message}</span>
                <code className="pj:break-all pj:font-mono pj:text-muted-foreground">{diagnostic.path}</code>
              </li>
            ))}
            {keyed(limitations, limitation => limitation).map(([key, limitation]) => (
              <li key={`limitation-${key}`} className="ph-warning pj:flex pj:min-w-0 pj:items-baseline pj:gap-1.5">
                <Badge variant="secondary" className="pj:px-1.5 pj:py-0 pj:text-[11px] pj:font-medium">
                  limitation
                </Badge>
                <span className="pj:min-w-0 pj:break-words">{limitation}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </ToolbarPopover>
  )
}
