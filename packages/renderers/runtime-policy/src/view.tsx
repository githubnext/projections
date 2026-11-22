import {useMemo} from 'react'
import {presentedEmphasis} from '@githubnext/projections-renderer-kit'
import {EmptyDomain, Group, type RendererProps} from '@githubnext/projections-renderer-kit/react'
import {buildModel} from './build.js'
import type {Item, Side} from './model.js'
import type {accepts} from './accepts.js'
import {markOf, runs, statusStrength, type Frame} from './frame.js'
import {Head} from './row.js'
import {Agent, Kernel, Policy, Workload} from './tables.js'
import {Lane} from './lanes.js'

/**
 * Runtime security policies: the agent and kernels, the policies and the
 * workloads they cover, then one lane per hook, grouped by what the hook
 * observes, holding every policy's rules there: when each acts, what it does
 * and whom it applies to.
 *
 * Each section is a kit `Group`, a titled panel whose header band names it
 * beside its subject's icon (a server for the agent and kernels, a shield for
 * policies, a box for workloads, then one per category), holding one table: quiet column headers, then divided rows on a shared
 * column grid; a category's table is grouped by hook, each lane headed by its
 * hook over its rules' column headers. In a comparison every changed row
 * states its change in a status column, a stack of icon-led lines (`Removed`,
 * then `No longer covered`), filled and edged in the change's hue while the host highlights it; a row
 * inside an added or removed region inherits the region's mark instead of
 * stacking another. Identifiers, paths, values and selectors are code; the
 * connecting words are prose.
 */
export function RuntimePolicyView(props: RendererProps<typeof accepts>) {
  const {comparing, diff, model} = props
  const side: Side = !comparing ? 'after' : diff ? 'diff' : props.progress < 0.5 ? 'before' : 'after'
  const metadata = props.init.mode === 'comparison' ? props.init.comparison.metadata : undefined
  const view = useMemo(() => buildModel(model, side, metadata), [model, side, metadata])
  if (!view.policies.length) {
    return <EmptyDomain title="No runtime security policies">This revision declares no policies.</EmptyDomain>
  }
  const frame: Frame = {
    props,
    side,
    comparing,
    strength: item => (!comparing ? 0 : diff ? props.emphasis(item.row, item.row.id) : presentedEmphasis(item.row, props.highlighting)),
  }
  // Neighbouring rows marked the same way in the diff join into one run.
  const runsOf = (items: readonly Item[]) => runs(items.map(item => markOf(item, frame)))
  const deploymentRuns = runsOf(view.deployment),
    policyRuns = runsOf(view.policies),
    workloadRuns = runsOf(view.workloads)
  // The content root starts at the top of the frame: the host's summary bar, not a line here, summarizes the policies.
  return (
    <div className="rp-view pk-stage" data-side={side} data-comparing={comparing ? '' : undefined} data-projections-content="">
      {view.deployment.length > 0 && (
        <Group title="Agent and kernels" icon="host" className="rp-panel">
          <ul className="rp-table rp-list" data-projections-unit="">
            {view.deployment.map((item, index) =>
              item.entity.kind === 'agent' ? (
                <Agent key={item.row.id} agent={item} frame={frame} run={deploymentRuns[index]} />
              ) : (
                <Kernel key={item.row.id} kernel={item} frame={frame} run={deploymentRuns[index]} />
              ),
            )}
          </ul>
        </Group>
      )}
      <Group title="Policies" icon="policy" className="rp-panel">
        <ul className="rp-table rp-list" data-projections-unit="">
          <Head frame={frame} cells={['Policy', 'Applies to']} status={statusStrength(view.policies, frame)} />
          {view.policies.map((policy, index) => (
            <Policy key={policy.row.id} policy={policy} frame={frame} run={policyRuns[index]} />
          ))}
        </ul>
      </Group>
      {view.workloads.length > 0 && (
        <Group title="Workloads" icon="workload" className="rp-panel">
          <ul className="rp-table rp-list" data-projections-unit="">
            <Head frame={frame} cells={['Workload', 'Covered by']} status={statusStrength(view.workloads, frame)} />
            {view.workloads.map((workload, index) => (
              <Workload key={workload.row.id} workload={workload} frame={frame} run={workloadRuns[index]} />
            ))}
          </ul>
        </Group>
      )}
      {/* A category is one table of hook lanes, each headed by its hook, then its column headers. */}
      {view.categories.map(category => (
        <Group key={category.id} title={category.title} icon={category.icon} className="rp-panel">
          <div className="rp-table rp-lanes">
            {category.hooks.map(hook => (
              <Lane key={hook.row.id} hook={hook} frame={frame} />
            ))}
          </div>
        </Group>
      ))}
    </div>
  )
}
