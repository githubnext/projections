import {compareIds} from '@githubnext/projections-renderer-kit'
import type {ComparisonModel} from '@githubnext/projections-renderer-kit'
import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {dataOf, sectionSpecs} from './sections.js'
import type {SectionId, SectionSpec, Value} from './sections.js'

/** Which revision a frame shows: `diff` draws both at once; a side-by-side pane or a single extraction shows one. */
export type Side = 'diff' | 'before' | 'after'
type Revision = 'before' | 'after'

/** How an entry differs from the other revision: arrived, left, changed in place, or not at all. */
export type Mark = 'added' | 'removed' | 'modified' | 'unchanged'

export interface Entry {
  key: string
  text: string
  mark: Mark
  /** The other revision's text of an entry that changed in place, in the diff. */
  was?: string
}

/** What the agentic-workflows comparator found (`metadata.agenticWorkflows.interpretations`). */
export interface Finding {
  name: string
  level: 'warning' | 'note'
  items: string[]
}

/** The direction a comparator finding moves a section: wider scope, narrower, or neither. */
export type Direction = 'widened' | 'narrowed' | 'changed'

export interface Section {
  spec: SectionSpec
  entries: Entry[]
  directions: Direction[]
}

export interface WorkflowItem {
  row: EntityChange<Entity>
  /** The entity this frame reads: the side's, or in the diff the after one when it exists. */
  entity: Entity
  before?: Entity
  after?: Entity
  sections: Section[]
  /** The comparator's findings about this change, most severe first; empty without the comparator. */
  findings: Finding[]
}

export interface GroupView {
  /** The group entity's row, or none for the workflows no group holds. */
  row?: EntityChange<Entity>
  title: string
  workflows: WorkflowItem[]
}

export interface Column {
  key: string
  /** Text with inline code. */
  label: string
  /** A loaded import or skill that has a class, such as a guardrail. */
  gate: boolean
}

export interface MatrixCategory {
  section: SectionId
  title: string
  columns: Column[]
}

export interface AgenticModel {
  side: Side
  groups: GroupView[]
  categories: MatrixCategory[]
  /** Whether the comparison came from the agentic-workflows comparator. */
  interpreted: boolean
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/** The comparator's findings by change ID, or `undefined` without its metadata. Comparator metadata is untrusted. */
export function findingsOf(metadata: unknown): Map<string, Finding[]> | undefined {
  const found = record(record(record(metadata).agenticWorkflows).interpretations)
  if (!Object.keys(found).length && !('agenticWorkflows' in record(metadata))) return undefined
  return new Map(
    Object.entries(found).map(([id, findings]) => [
      id,
      (Array.isArray(findings) ? findings : [])
        .map(record)
        .filter(finding => typeof finding.name === 'string')
        .map(finding => ({
          name: finding.name as string,
          level: finding.level === 'warning' ? 'warning' : 'note',
          items: (Array.isArray(finding.items) ? finding.items : []).filter((item): item is string => typeof item === 'string'),
        })),
    ]),
  )
}

/** The card section each finding is about. */
const findingSections: Record<string, SectionId> = {
  'gate-removed': 'loads',
  'gate-added': 'loads',
  'loads-changed': 'loads',
  'repos-widened': 'repos',
  'repos-narrowed': 'repos',
  'permissions-widened': 'permissions',
  'permissions-narrowed': 'permissions',
  'bash-widened': 'bash',
  'bash-narrowed': 'bash',
  'network-widened': 'network',
  'network-narrowed': 'network',
  'outputs-widened': 'outputs',
  'outputs-narrowed': 'outputs',
  'tools-widened': 'tools',
  'tools-narrowed': 'tools',
  'secrets-added': 'secrets',
  'secrets-removed': 'secrets',
  'triggers-widened': 'triggers',
  'triggers-narrowed': 'triggers',
  'triggers-changed': 'triggers',
  'budget-raised': 'budgets',
  'budget-lowered': 'budgets',
}

/** Findings that are neither wider nor narrower. */
const neutral = new Set(['loads-changed', 'engine-changed', 'triggers-changed', 'group-changed'])
export const directionOf = (finding: Finding): Direction =>
  neutral.has(finding.name) ? 'changed' : finding.level === 'warning' ? 'widened' : 'narrowed'

const byKey = (values: readonly Value[]) => new Map(values.map(value => [value.key, value.text]))

/**
 * A section's entries for the frame. The diff lists the after revision's, then those that left; a pane lists its
 * own, marked against the other revision. A workflow on one side only marks nothing: the card states its change.
 */
export function entries(before: readonly Value[] | undefined, after: readonly Value[] | undefined, side: Side): Entry[] {
  if (side !== 'diff') {
    const own = (side === 'before' ? before : after) ?? []
    const other = side === 'before' ? after : before
    const theirs = other && byKey(other)
    return own.map(({key, text}) => {
      const counterpart = theirs?.get(key)
      const mark: Mark = !theirs
        ? 'unchanged'
        : counterpart === undefined
          ? side === 'after'
            ? 'added'
            : 'removed'
          : counterpart === text
            ? 'unchanged'
            : 'modified'
      return {key, text, mark}
    })
  }
  if (!before || !after) return (after ?? before ?? []).map(({key, text}) => ({key, text, mark: 'unchanged'}))
  const old = byKey(before)
  const now = byKey(after)
  return [
    ...after.map(({key, text}): Entry => {
      const was = old.get(key)
      return was === undefined
        ? {key, text, mark: 'added'}
        : was === text
          ? {key, text, mark: 'unchanged'}
          : {key, text, mark: 'modified', was}
    }),
    ...before.filter(({key}) => !now.has(key)).map(({key, text}): Entry => ({key, text, mark: 'removed'})),
  ]
}

function workflowItem(row: EntityChange<Entity>, side: Side, findings: Finding[]): WorkflowItem | undefined {
  const entity = side === 'diff' ? (row.after ?? row.before) : row[side]
  if (!entity) return undefined
  const sections = sectionSpecs.map(spec => ({
    spec,
    entries: entries(
      row.before && spec.read(dataOf(row.before), row.after && dataOf(row.after)),
      row.after && spec.read(dataOf(row.after), row.before && dataOf(row.before)),
      side,
    ),
    directions: [...new Set(findings.filter(finding => findingSections[finding.name] === spec.id).map(directionOf))].sort(),
  }))
  return {row, entity, ...(row.before ? {before: row.before} : {}), ...(row.after ? {after: row.after} : {}), sections, findings}
}

const collator = new Intl.Collator('en', {numeric: true})
const byLabel = (a: WorkflowItem, b: WorkflowItem) => collator.compare(a.entity.label, b.entity.label) || compareIds(a.row.id, b.row.id)

/** The matrix's columns: what any workflow loads, its tools, outputs and network, in the revisions the frame draws. */
function categories(workflows: readonly WorkflowItem[], side: Side): MatrixCategory[] {
  const specs: [SectionId, string, (key: string) => boolean][] = [
    ['loads', 'Loads', () => true],
    ['tools', 'Tools', key => !key.startsWith('guard:')],
    ['outputs', 'Writes', key => key.startsWith('output:')],
    ['network', 'Network', key => key.startsWith('allow:')],
  ]
  return specs
    .map(([section, title, include]) => {
      const columns = new Map<string, Column>()
      for (const workflow of workflows) {
        for (const entity of side === 'diff' ? [workflow.before, workflow.after] : [workflow[side]]) {
          if (entity) {
            for (const value of sectionSpecs.find(spec => spec.id === section)!.read(dataOf(entity))) {
              if (include(value.key) && !columns.has(value.key)) {
                columns.set(value.key, {key: value.key, label: columnLabel(value), gate: value.text.includes(' · ')})
              }
            }
          }
        }
      }
      return {
        section,
        title,
        columns: [...columns.values()].sort((a, b) => Number(b.gate) - Number(a.gate) || collator.compare(a.key, b.key)),
      }
    })
    .filter(category => category.columns.length > 0)
}

/** A column's heading: the entry's name alone, without what an entry says about it. */
const columnLabel = (value: Value) => {
  const name = value.key.slice(value.key.indexOf(':') + 1)
  return value.key.startsWith('toolset:') ? `toolset \`${name}\`` : `\`${name}\``
}

/** The comparison (or extraction) as groups of workflow cards, and the matrix's columns. */
export function buildModel(model: ComparisonModel, side: Side, metadata?: unknown): AgenticModel {
  const found = findingsOf(metadata)
  const findings = (row: EntityChange<Entity>) => found?.get(row.id) ?? []
  const workflows = model.entities
    .filter(row => (row.after ?? row.before)!.kind === 'workflow')
    .map(row => workflowItem(row, side, findings(row)))
    .filter((item): item is WorkflowItem => item !== undefined)
    .sort(byLabel)
  const groupRows = model.entities.filter(row => (row.after ?? row.before)!.kind === 'group')
  const groupOf = (item: WorkflowItem) => {
    const group = dataOf(item.entity).group
    return typeof group === 'string' ? group : undefined
  }
  const groups: GroupView[] = groupRows
    .filter(row => (side === 'diff' ? true : row[side] !== undefined))
    .map(row => {
      const title = (row.after ?? row.before)!.label
      return {row, title, workflows: workflows.filter(item => groupOf(item) === title)}
    })
    .sort((a, b) => collator.compare(a.title, b.title))
  const loose = workflows.filter(item => !groups.some(group => group.workflows.includes(item)))
  if (loose.length || !groups.length) groups.push({title: groups.length ? 'Other workflows' : 'Workflows', workflows: loose})
  return {side, groups, categories: categories(workflows, side), interpreted: found !== undefined}
}
