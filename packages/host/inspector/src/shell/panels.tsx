import type {ReactNode} from 'react'
import type {Diagnostic} from '@githubnext/projections-schemas'
import type {ComputedComparison, ExtractionChoice} from '@githubnext/projections-host'
import {Prose} from '@githubnext/projections-host/ui'
import {
  Badge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@githubnext/projections-host/ui/components'
import type {InspectorJob} from '../types.js'

const empty = 'pj:text-xs pj:text-muted-foreground'
/** Raw text in a recessed well (the shared `surface-inset`) with a divider edge. */
const pre =
  'pj:overflow-auto pj:whitespace-pre-wrap pj:break-all pj:rounded-md pj:border pj:border-divider pj:bg-surface-inset pj:p-3 pj:font-mono pj:text-xs'
/** Change chips, as the host's table draws them: the `-muted` fill over the raised surface with its same-hue `-border` edge. */
const statusTone: Record<string, string> = {
  added: 'pj:border-added-border pj:bg-surface-raised pj:bg-linear-to-r pj:from-added-muted pj:to-added-muted pj:text-added',
  removed: 'pj:border-removed-border pj:bg-surface-raised pj:bg-linear-to-r pj:from-removed-muted pj:to-removed-muted pj:text-removed',
  modified: 'pj:border-modified-border pj:bg-surface-raised pj:bg-linear-to-r pj:from-modified-muted pj:to-modified-muted pj:text-modified',
  moved: 'pj:border-moved-border pj:bg-surface-raised pj:bg-linear-to-r pj:from-moved-muted pj:to-moved-muted pj:text-moved',
}

export function Empty({children}: {children: ReactNode}) {
  return <p className={empty}>{children}</p>
}

export function DiagnosticsList({diagnostics}: {diagnostics: readonly Diagnostic[]}) {
  if (!diagnostics.length) return <Empty>No diagnostics.</Empty>
  return (
    <ul className="pi-diagnostics pj:flex pj:flex-col pj:divide-y pj:rounded-md pj:border pj:border-divider pj:bg-surface-raised">
      {diagnostics.map((diagnostic, index) => (
        <li key={index} className="pj:flex pj:min-w-0 pj:flex-col pj:gap-0.5 pj:px-3 pj:py-2 pj:text-xs">
          <span className="pj:flex pj:flex-wrap pj:items-center pj:gap-2">
            <Badge variant={diagnostic.severity === 'error' ? 'destructive' : 'secondary'} className="pj:px-1.5 pj:py-0 pj:text-[10px]">
              {diagnostic.severity}
            </Badge>
            <span className="pj:font-mono pj:font-medium">{diagnostic.code}</span>
            <code className="pj:break-all pj:font-mono pj:text-muted-foreground">{diagnostic.path}</code>
          </span>
          <p className="pj:break-words pj:text-sm">
            <Prose>{diagnostic.message}</Prose>
          </p>
        </li>
      ))}
    </ul>
  )
}

export function RawOutput({jobs}: {jobs: readonly InspectorJob[]}) {
  if (!jobs.some(item => item.outputs.length)) {
    return <Empty>No raw extractor output. Saved artifacts contain the normalized extraction, not the process output.</Empty>
  }
  return (
    <div className="pj:flex pj:flex-col pj:gap-4">
      {jobs.toReversed().map(item => (
        <section key={item.id} className="pi-output pj:flex pj:min-w-0 pj:flex-col pj:gap-1.5">
          <h3 className="pj:text-xs pj:font-semibold">
            Run {item.id}: {item.status}
          </h3>
          {item.outputs.length ? (
            item.outputs.map((output, index) => (
              <div key={index} className="pj:grid pj:min-w-0 pj:gap-1.5 pj:lg:grid-cols-2">
                <div className="pj:min-w-0">
                  <h4 className={empty}>{output.ref} · stdout</h4>
                  <pre className={pre}>{output.stdout || '(empty stdout)'}</pre>
                </div>
                <div className="pj:min-w-0">
                  <h4 className={empty}>{output.ref} · stderr</h4>
                  <pre className={pre}>{output.stderr || '(empty stderr)'}</pre>
                </div>
              </div>
            ))
          ) : (
            <Empty>No output was captured.</Empty>
          )}
        </section>
      ))}
    </div>
  )
}

export function ExtractionJson({choices}: {choices: readonly ExtractionChoice[]}) {
  if (!choices.length) return <Empty>No extraction loaded.</Empty>
  return (
    <div className={cn('pj:grid pj:min-w-0 pj:gap-3', choices.length > 1 && 'pj:lg:grid-cols-2')}>
      {choices.map(choice => (
        <section key={choice.key} className="pi-output pj:flex pj:min-w-0 pj:flex-col pj:gap-1.5">
          <h3 className="pj:text-xs pj:font-semibold">{choice.label}</h3>
          <pre className={pre}>{JSON.stringify(choice.document.extraction, null, 2)}</pre>
        </section>
      ))}
    </div>
  )
}

export function ChangesTable({
  comparison,
  beforeLabel,
  afterLabel,
}: {
  comparison: ComputedComparison | undefined
  beforeLabel: string
  afterLabel: string
}) {
  if (!comparison) return <Empty>Changes appear when two extractions are compared: mark revisions A and B in the sidebar.</Empty>
  return (
    <div className="pi-table-scroll pj:min-w-0 pj:overflow-hidden pj:rounded-md pj:border pj:border-divider pj:bg-surface-raised">
      <Table className="pj:caption-top pj:text-xs">
        <TableCaption className="pj:mt-0 pj:bg-surface-header pj:px-3 pj:pt-2 pj:pb-0.5 pj:text-left pj:text-foreground">
          Changes from {beforeLabel} to {afterLabel}, in presentation order.{' '}
          <span className="pj:text-muted-foreground">
            Computed in this browser by the{' '}
            {comparison.comparator.id === 'default' ? 'default' : <code className="pj:font-mono">{comparison.comparator.id}</code>}{' '}
            comparator (<code className="pj:break-all pj:font-mono">{comparison.comparator.digest}</code>).
          </span>
        </TableCaption>
        <TableHeader className="pj:bg-surface-header pj:[&_tr]:border-divider">
          <TableRow className="pj:hover:bg-transparent">
            <TableHead>Step</TableHead>
            <TableHead>Collection</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Correspondence</TableHead>
            <TableHead>Before IDs</TableHead>
            <TableHead>After IDs</TableHead>
            <TableHead>Summary</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {comparison.comparison.steps.flatMap((step, index) =>
            step.changes.map(id => {
              const change = comparison.comparison.changes.find(item => item.id === id)
              if (!change) return null
              return (
                <TableRow key={id}>
                  <TableCell className="pj:whitespace-nowrap pj:tabular-nums">
                    {index + 1}
                    {step.kind ? ` · ${step.kind}` : ''}
                  </TableCell>
                  <TableCell>{change.collection}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn('pj:font-medium', statusTone[change.status])}>
                      {change.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{change.correspondence}</TableCell>
                  <TableCell>
                    <code className="pj:font-mono">{change.before.join(', ') || '—'}</code>
                  </TableCell>
                  <TableCell>
                    <code className="pj:font-mono">{change.after.join(', ') || '—'}</code>
                  </TableCell>
                  <TableCell className="pj:min-w-40">{change.summary ? <Prose>{change.summary}</Prose> : ''}</TableCell>
                </TableRow>
              )
            }),
          )}
        </TableBody>
      </Table>
    </div>
  )
}

/** One extraction's digests (and, in full, its provenance record). */
export function ProvenanceSection({choice, full = false}: {choice: ExtractionChoice; full?: boolean}) {
  return (
    <section className="pi-output pj:flex pj:min-w-0 pj:flex-col pj:gap-1.5 pj:text-xs">
      <h3 className="pj:font-semibold">{choice.label}</h3>
      <p className="pj:break-all">
        Extraction digest: <code className="pj:font-mono pj:text-muted-foreground">{choice.document.digest}</code>
      </p>
      <p className="pj:break-all">
        Definition digest: <code className="pj:font-mono pj:text-muted-foreground">{choice.document.provenance.definitionDigest}</code>
      </p>
      {full && <pre className={pre}>{JSON.stringify(choice.document.provenance, null, 2)}</pre>}
    </section>
  )
}

export function ProvenanceList({choices}: {choices: readonly ExtractionChoice[]}) {
  if (!choices.length) return <Empty>No provenance loaded.</Empty>
  return (
    <div className={cn('pj:grid pj:min-w-0 pj:gap-3', choices.length > 1 && 'pj:lg:grid-cols-2')}>
      {choices.map(choice => (
        <ProvenanceSection key={choice.key} choice={choice} full />
      ))}
    </div>
  )
}
