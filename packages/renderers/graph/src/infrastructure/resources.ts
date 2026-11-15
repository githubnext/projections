// How infrastructure resources read on their cards: planned actions, resource types and attribute changes.
import type {Entity} from '@githubnext/projections-schemas'
import type {FieldLine, StatusPart, TransitionNode} from '@githubnext/projections-renderer-kit'
import {fieldLines} from '@githubnext/projections-renderer-kit'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'

/**
 * The infrastructure vocabulary (docs/models/infrastructure-model.md): planned
 * actions in `data.action`, resource types in `data.type`. Nothing here is
 * specific to one deployment tool.
 */
export const boundaryKinds = ['module', 'resource-group', 'resource'] as const

function field(entity: Entity | undefined, name: string): string | undefined {
  const value = entity?.data?.[name]
  return typeof value === 'string' ? value : undefined
}

export function plannedAction(entity: Entity | undefined): string | undefined {
  return field(entity, 'action')
}

/** A planned action as a badge and a word, in the change color that matches what it does. */
export function actionPart(action: string, entity?: Entity): StatusPart | undefined {
  switch (action) {
    case 'create':
      return {status: 'added', glyph: '+', icon: 'added', label: 'Create'}
    case 'delete':
      return {status: 'removed', glyph: '−', icon: 'removed', label: 'Destroy'}
    case 'replace':
      // The order is worded, since an icon can't carry it: create-before-destroy is the safer replacement.
      return field(entity, 'replaceOrder') === 'create-before-destroy'
        ? {status: 'modified', glyph: '+/−', icon: 'replace', label: 'Replace, create first'}
        : {status: 'modified', glyph: '−/+', icon: 'replace', label: 'Replace'}
    case 'update':
      return {status: 'modified', glyph: '~', icon: 'modified', label: 'Update in place'}
    case 'deploy':
      return {status: 'modified', glyph: '↻', icon: 'redeploy', label: 'Redeploy'}
    case 'read':
      return {status: 'modified', glyph: '<=', icon: 'read', label: 'Read'}
    case 'import':
      return {status: 'added', glyph: '↓', icon: 'import', label: 'Import'}
    case 'forget':
      return {status: 'removed', glyph: '⊘', icon: 'blocked', label: 'Forget'}
    default:
      return undefined
  }
}

/**
 * A row's change in the words of a deployment: a created resource says
 * Create (or Import), a removed one Destroy, and a modified one the action its
 * after state is planned with — Replace and Update in place are different
 * things, so they never share a word or a glyph.
 */
export function infrastructureStatus(node: Pick<TransitionNode, 'status' | 'renamed' | 'before' | 'after'>): StatusPart[] {
  const parts: StatusPart[] = []
  if (node.renamed) parts.push({status: 'renamed', glyph: '→', icon: 'moved', label: 'Moved'})
  const action = plannedAction(node.after)
  if (node.status === 'added') parts.push((action === 'import' && actionPart(action)) || actionPart('create')!)
  else if (node.status === 'removed') parts.push(actionPart('delete')!)
  else if (node.status === 'modified')
    parts.push((action && actionPart(action, node.after)) || {status: 'modified', glyph: '~', icon: 'modified', label: 'Modified'})
  return parts
}

/**
 * A card's kind line: the resource type, as code, without a provider namespace
 * the card doesn't need (`virtualNetworks/subnets`); data sources in
 * Terraform's own `data.` form.
 */
export function resourceType(entity: Entity): {text: string; identifier: boolean} | undefined {
  const type = field(entity, 'type')
  if (!type || entity.kind === 'module' || entity.kind === 'resource-group') return undefined
  const namespace = field(entity, 'provider')
  const short = namespace && type.startsWith(`${namespace}/`) ? type.slice(namespace.length + 1) : type
  return {text: entity.kind === 'data-source' ? `data.${short}` : short, identifier: true}
}

/** A changed resource's attribute changes (`data.values`), verbatim, for its diff card. */
export function attributeChanges(row: EntityChange<Entity>): FieldLine[] {
  // What forces a replacement comes first, then values the plan knows, then ones known only after apply.
  const forcing = row.after?.data?.['replacePaths']
  const first = new Set(Array.isArray(forcing) ? forcing.map(String) : [])
  const rank = (line: FieldLine) => (first.has(line.key) ? 0 : line.after === unknownValue ? 2 : 1)
  return fieldLines(row, {object: 'values'}).sort((a, b) => rank(a) - rank(b))
}

/** How plans write a value that is known only after apply. */
const unknownValue = '(known after apply)'
