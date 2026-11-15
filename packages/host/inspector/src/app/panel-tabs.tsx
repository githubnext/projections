import type {ComponentProps} from 'react'
import type {PanelTab} from '../shell/layout.js'
import {ChangesTable, DiagnosticsList, ExtractionJson, ProvenanceList, RawOutput} from '../shell/panels.js'

/** The bottom panel's tabs: diagnostics, the runner's raw output, the shown pair's extractions, changes and provenance. */
export function inspectorPanelTabs({
  diagnostics,
  jobs,
  pairChoices,
  comparison,
  beforeLabel,
  afterLabel,
}: {
  diagnostics: ComponentProps<typeof DiagnosticsList>['diagnostics']
  /** The runner's jobs, when one is connected. */
  jobs: ComponentProps<typeof RawOutput>['jobs'] | undefined
  pairChoices: ComponentProps<typeof ExtractionJson>['choices']
  comparison: ComponentProps<typeof ChangesTable>['comparison']
  beforeLabel: string
  afterLabel: string
}): PanelTab[] {
  const errors = diagnostics.filter(item => item.severity === 'error').length
  return [
    {
      id: 'diagnostics',
      label: 'Diagnostics',
      badge: diagnostics.length || undefined,
      tone: errors ? 'destructive' : 'default',
      content: <DiagnosticsList diagnostics={diagnostics} />,
    },
    ...(jobs ? [{id: 'raw', label: 'Raw output', content: <RawOutput jobs={jobs} />}] : []),
    {id: 'extraction', label: 'Extraction', content: <ExtractionJson choices={pairChoices} />},
    {
      id: 'changes',
      label: 'Changes',
      content: <ChangesTable comparison={comparison} beforeLabel={beforeLabel} afterLabel={afterLabel} />,
    },
    {id: 'provenance', label: 'Provenance', content: <ProvenanceList choices={pairChoices} />},
  ]
}
