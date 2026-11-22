import {escapeProse, type Entity, type Relationship} from '@githubnext/projections-schemas'
import {compareIds, type IconName} from '@githubnext/projections-renderer-kit'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'

/**
 * Which revision a frame shows: `diff` draws both at once; a side-by-side pane
 * or a single extraction shows one.
 */
export type Side = 'diff' | 'before' | 'after'
export type Revision = 'before' | 'after'
export type ChipChange = 'added' | 'removed' | 'unchanged'

/** One entity in the frame: its row, the version this frame reads, and both versions. */
export interface Item {
  row: EntityChange<Entity>
  entity: Entity
  before?: Entity
  after?: Entity
  /** The comparator's interpretations of the change, most severe first (empty without the runtime policy comparator). */
  interpretations: string[]
}

/** A subject a rule or policy applies to, drawn as a chip inside it. */
export interface Chip {
  key: string
  subject: Item
  kind: string
  data: Relationship['data']
  /** Whether the relationship arrives, leaves or stays; a rewired relationship is one leaving chip and one arriving chip. */
  change: ChipChange
}

export interface SelectorItem extends Item {
  chips: Chip[]
}
export interface ProbeItem extends Item {
  policy: Item | undefined
  selectors: SelectorItem[]
}
export interface HookItem extends Item {
  probes: ProbeItem[]
}
export interface CategoryView {
  id: string
  title: string
  /** The subject icon beside its title: what its hooks observe. */
  icon: IconName
  hooks: HookItem[]
}
export interface PolicyItem extends Item {
  scope: Chip[]
}
/** A workload the repository deploys, with the policies that cover it as chips. */
export interface WorkloadItem extends Item {
  coveredBy: Chip[]
}
/** A count in the presented revision and, in a comparison, the before revision. */
export interface Tally {
  now: number
  was: number
}
export interface RuntimePolicyModel {
  side: Side
  policies: PolicyItem[]
  /** The agent's configuration and the nodes' kernel profiles, when the extraction has them. */
  deployment: Item[]
  workloads: WorkloadItem[]
  categories: CategoryView[]
  counts: {policies: Tally; hooks: Tally; rules: Tally; enforcing: Tally}
  /** Interpretation name to the number of changes the comparator interpreted that way. */
  findings: Map<string, number>
  /** Whether the comparison came from the runtime policy comparator. */
  interpreted: boolean
}

export const categories: readonly {id: string; title: string; icon: IconName}[] = [
  {id: 'credentials', title: 'Credentials', icon: 'credential'},
  {id: 'process', title: 'Processes', icon: 'process'},
  {id: 'file', title: 'Files', icon: 'file'},
  {id: 'network', title: 'Network', icon: 'network'},
  {id: 'kernel-modules', title: 'Kernel modules', icon: 'module'},
  {id: 'bpf', title: 'BPF', icon: 'bytecode'},
  {id: 'namespaces', title: 'Namespaces and mounts', icon: 'namespace'},
  {id: 'user-space', title: 'User space', icon: 'application'},
  {id: 'other', title: 'Other', icon: 'other'},
]

/** The noun of a finding the summary counts: the same words for one and for many when they describe the change. */
const words = (singular: string, plural = singular) => ({singular, plural})

/** Interpretations the summary bar counts, most severe first, with their icons and words (`1 newly enforced`). */
export const findingLabels: readonly {id: string; icon: IconName; noun: {singular: string; plural: string}}[] = [
  {id: 'newly-enforced', icon: 'enforced', noun: words('newly enforced')},
  {id: 'enforcement-removed', icon: 'unenforced', noun: words('no longer enforced')},
  {id: 'enforcement-elided', icon: 'hidden', noun: words('elided by monitor mode')},
  {id: 'scope-broadened', icon: 'expand', noun: words('scope broadened', 'scopes broadened')},
  {id: 'scope-narrowed', icon: 'collapse', noun: words('scope narrowed', 'scopes narrowed')},
  {id: 'scope-changed', icon: 'rescoped', noun: words('scope changed', 'scopes changed')},
  {id: 'mode-changed', icon: 'settings', noun: words('mode changed', 'modes changed')},
  {id: 'warning-added', icon: 'warning', noun: words('new warning', 'new warnings')},
  {id: 'agent-changed', icon: 'agent', noun: words('agent configuration changed', 'agent configurations changed')},
  {id: 'coverage-lost', icon: 'exclude', noun: words('hook no longer covered', 'hooks no longer covered')},
  {id: 'newly-covered', icon: 'include', noun: words('hook newly covered', 'hooks newly covered')},
]

/** Words for an interpretation, a line of its own in a status stack under the change status (`Removed`, `No longer covered`). */
export const interpretationText: Record<string, string> = {
  'newly-enforced': 'Newly enforced',
  'enforcement-removed': 'No longer enforced',
  'enforcement-elided': 'Enforcement elided',
  'scope-broadened': 'Scope broadened',
  'scope-narrowed': 'Scope narrowed',
  'scope-changed': 'Scope changed',
  'mode-changed': 'Mode changed',
  'warning-added': 'New warning',
  'agent-changed': 'Configuration changed',
  'nodes-changed': 'Nodes changed',
  'coverage-lost': 'No longer covered',
  'newly-covered': 'Newly covered',
  'newly-observed': 'Newly observed',
  'observation-removed': 'No longer observed',
}

/**
 * The icon beside each interpretation's words. Interpretations are notes after a change's status, not change kinds,
 * so every one is an outline icon, never a badge (the SDK's `badgeIconNames`).
 */
export const interpretationIcons: Record<string, IconName> = {
  'newly-enforced': 'enforced',
  'enforcement-removed': 'unenforced',
  'enforcement-elided': 'hidden',
  'scope-broadened': 'expand',
  'scope-narrowed': 'collapse',
  'scope-changed': 'rescoped',
  'mode-changed': 'settings',
  'warning-added': 'warning',
  'agent-changed': 'agent',
  'nodes-changed': 'rescoped',
  'coverage-lost': 'exclude',
  'newly-covered': 'include',
  'newly-observed': 'visible',
  'observation-removed': 'hidden',
}

/** The icon beside a rule's effect: enforcing rules are marked, monitor-elided ones too. */
export function effectIcon(entity: Entity | undefined): IconName | undefined {
  if (entity?.data?.effect !== 'enforce') return undefined
  return entity.data.enforcement === 'elided' ? 'unenforced' : 'enforced'
}

/**
 * Text the extractor writes for people is prose: the contracts' text with
 * inline code, code in backtick spans (kit `Prose` draws it). Plain values
 * become prose by escaping.
 */
export function proseOf(value: unknown, fallback: string | undefined): string {
  if (typeof value === 'string' && value) return value
  return fallback ? escapeProse(fallback) : ''
}

/** Whether a rule enforces (`effect: enforce`) and its enforcement is active, not elided by monitor mode. */
export const isEnforcing = (entity: Entity | undefined) => entity?.data?.effect === 'enforce' && entity.data.enforcement === 'active'

/** The runtime policy comparator's interpretations (`metadata.runtimePolicy.interpretations`), by change or item ID. */
export function interpretationsOf(metadata: unknown): Map<string, string[]> | undefined {
  const runtime = (metadata as {runtimePolicy?: {interpretations?: unknown}} | undefined)?.runtimePolicy
  const found = runtime?.interpretations
  if (typeof found !== 'object' || found === null) return undefined
  return new Map(
    Object.entries(found as Record<string, unknown>).map(([id, names]) => [
      id,
      Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [],
    ]),
  )
}

/** A non-empty string value, or `undefined`. */
export const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

export const collator = new Intl.Collator('en', {numeric: true})
/** Items by their entity's label, then by ID. */
export const byLabel = (a: Item, b: Item) => collator.compare(a.entity.label, b.entity.label) || compareIds(a.row.id, b.row.id)
