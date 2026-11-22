import {useMemo} from 'react'
import {classifyChange, isChanged, presentedEmphasis} from '@githubnext/projections-renderer-kit'
import {CardGrid, EmptyDomain, Group, type RendererProps} from '@githubnext/projections-renderer-kit/react'
import {buildModel, type GroupView, type Side} from './model.js'
import type {accepts} from './accepts.js'
import type {Frame} from './frame.js'
import {WorkflowCard} from './card.js'
import {Matrix} from './matrix.js'

function WorkflowGroup({group, frame}: {group: GroupView; frame: Frame}) {
  const row = group.row
  const changed = row !== undefined && frame.comparing && isChanged(row)
  return (
    <Group
      title={group.title}
      titleFont={row ? 'code' : 'text'}
      icon="agent"
      meta={`${group.workflows.length} ${group.workflows.length === 1 ? 'workflow' : 'workflows'}`}
      className="aw-group"
      {...(row ? {id: row.id, selected: frame.props.selectedId === row.id, onSelect: frame.props.onSelect} : {})}
      {...(row && frame.comparing ? {change: row, emphasis: frame.strength(row)} : {})}
      {...(changed && frame.side === 'diff' ? {mark: classifyChange(row)} : {})}
    >
      <CardGrid label={group.title}>
        {group.workflows.map(item => (
          <WorkflowCard key={item.row.id} item={item} frame={frame} />
        ))}
      </CardGrid>
    </Group>
  )
}

/**
 * Agentic workflows: one card per workflow, in its group, with a row per section a reviewer asks about (what starts
 * it, its tools and their scope, repositories, bash, network, permissions, what it writes, its budgets, what it loads
 * and the secrets it references), its engine and lock file, and the extractor's warnings. In a comparison each entry
 * that arrives or leaves is a pill with its sign, one that changes in place reads old → new, and a section the
 * agentic-workflows comparator interprets says in words whether it widened or narrowed. The `view` control shows the
 * matrix instead: workflows against what they load, use, write and reach.
 */
export function AgenticWorkflowsView(props: RendererProps<typeof accepts>) {
  const {comparing, diff, model} = props
  const side: Side = !comparing ? 'after' : diff ? 'diff' : props.progress < 0.5 ? 'before' : 'after'
  const metadata = props.init.mode === 'comparison' ? props.init.comparison.metadata : undefined
  const view = useMemo(() => buildModel(model, side, metadata), [model, side, metadata])
  if (!view.groups.some(group => group.workflows.length)) {
    return <EmptyDomain title="No agentic workflows">This revision declares no agentic workflows.</EmptyDomain>
  }
  const frame: Frame = {
    props,
    side,
    comparing,
    strength: row => (!comparing || !isChanged(row) ? 0 : diff ? props.emphasis(row, row.id) : presentedEmphasis(row, props.highlighting)),
  }
  return (
    <div className="aw-view pk-stage" data-side={side} data-comparing={comparing ? '' : undefined} data-projections-content="">
      {props.controls.view === 'matrix' ? (
        <Matrix view={view} frame={frame} />
      ) : (
        view.groups
          .filter(group => group.workflows.length || group.row)
          .map(group => <WorkflowGroup key={group.row?.id ?? group.title} group={group} frame={frame} />)
      )}
    </div>
  )
}
