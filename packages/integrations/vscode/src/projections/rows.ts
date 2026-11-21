import type {ProjectionFailure} from '../protocol.js'
import type {DefinitionPolicy, InvalidDefinition, ProjectionDefinition} from './definitions.ts'

/** What a projection tab last reported: its pair, extraction status and change counts. */
export interface TabSummary {
  projection?: string
  pair?: {before?: string; after?: string}
  status?: 'idle' | 'extracting' | 'failed' | 'ok' | 'trust'
  /** What the tab's job is doing now: extracting a side of its pair, or comparing the two. */
  running?: 'extracting' | 'comparing'
  /** Whether the tab's page moves less: VS Code's reduce motion (`vscode-reduce-motion`), or the system's. */
  reducedMotion?: boolean
  comparison?: {compared: boolean; rows: number; changes: Record<string, number>}
  error?: string
  /** The revision whose definition it applied (`HEAD`, or `working-tree`). */
  definitionRevision?: string
  /** The shown pair's extractions, by ref: the job and the result's identity (its definition digest and execution). */
  results?: Record<
    string,
    {
      job?: string
      definitionDigest?: string
      execution?: {source?: string; fidelity?: string; tree?: string; strategy?: string}
    }
  >
  /** The tab's switch of pair it shows (`ControlMessage`'s `generation`), once it was switched. */
  generation?: number
  /** How the tab shows it: its comparison mode and the modes offered, playback, the view kind and changes only. */
  view?: {mode?: string; modes?: string[]; playing?: boolean; showAs?: string; changesOnly?: boolean; zoom?: string[]}
}

/** The codicon for a renderer's kind; custom bundles and unknown renderers get a generic one. */
export function rendererIcon(renderer: ProjectionDefinition['renderer'] | undefined): string {
  if (typeof renderer !== 'string') return 'symbol-misc'
  const icons: Record<string, string> = {
    graph: 'type-hierarchy',
    dependencies: 'package',
    dag: 'git-merge',
    infrastructure: 'server-environment',
    database: 'database',
    api: 'symbol-interface',
    'file-packing': 'files',
    'code-statistics': 'graph',
    'dependency-injection': 'plug',
    'text-diff': 'diff',
    'runtime-policy': 'shield',
    'agentic-workflows': 'robot',
  }
  return icons[renderer] ?? 'symbol-structure'
}

/** The number of changes a compared summary counts (every status but unchanged). */
export function changeCount(summary: TabSummary): number | undefined {
  if (!summary.comparison?.compared) return undefined
  return Object.entries(summary.comparison.changes)
    .filter(([status]) => status !== 'unchanged')
    .reduce((total, [, count]) => total + (Number.isFinite(count) ? count : 0), 0)
}

/**
 * What a projection's row says: "3 changes", "no change", "needs trust", "failed", or "not compared" before a tab
 * compares it. On one revision (Now: no comparison) it says "extracted" once a tab showed it, else "not extracted".
 */
export function statusText({
  invalid,
  policy,
  executionAuthorized,
  summary,
  single = false,
}: {
  invalid?: boolean
  policy?: DefinitionPolicy
  executionAuthorized: boolean
  summary?: TabSummary
  single?: boolean
}): string {
  if (invalid) return 'failed'
  if (summary?.status === 'failed' || summary?.error) return 'failed'
  if (summary?.status === 'trust' || (policy?.requiresTrust && !executionAuthorized)) return 'needs trust'
  if (single) return summary?.status === 'ok' ? 'extracted' : summary?.status === 'extracting' ? 'extracting…' : 'not extracted'
  const count = summary ? changeCount(summary) : undefined
  if (count !== undefined) return count === 0 ? 'no change' : `${count} change${count === 1 ? '' : 's'}`
  if (summary?.status === 'extracting') return 'comparing…'
  return 'not compared'
}

/** A definition's parts as the tree shows them: what each is, and the repository file it names, if any. */
export function parts(definition: ProjectionDefinition): {part: 'extractor' | 'comparator' | 'renderer'; label: string; file?: string}[] {
  const extractor =
    typeof definition.extractor === 'string'
      ? {part: 'extractor' as const, label: definition.extractor}
      : {
          part: 'extractor' as const,
          label: definition.extractor.command.join(' '),
          ...(definition.extractor.command[1] && !definition.extractor.command[1].startsWith('-')
            ? {file: definition.extractor.command[1]}
            : {}),
        }
  // A string or an object with `file` names a comparator file; an object without `file` is the default comparator.
  const comparatorFile = typeof definition.comparator === 'string' ? definition.comparator : definition.comparator?.file
  const comparator = comparatorFile
    ? {part: 'comparator' as const, label: comparatorFile, file: comparatorFile}
    : {part: 'comparator' as const, label: 'default'}
  const renderer =
    typeof definition.renderer === 'string'
      ? {part: 'renderer' as const, label: definition.renderer}
      : {part: 'renderer' as const, label: definition.renderer.bundle}
  return [extractor, comparator, renderer]
}

/** A projection tab's failure page for an invalid definition. */
export function failureFor(invalid: InvalidDefinition): ProjectionFailure {
  return {
    title: `${invalid.id ?? invalid.path} can't load: its definition is invalid`,
    diagnostics: invalid.diagnostics.map(diagnostic => ({
      message: diagnostic.message,
      path: diagnostic.location?.path ?? invalid.path,
      ...(diagnostic.location ? {line: diagnostic.location.line, column: diagnostic.location.column} : {}),
    })),
  }
}
