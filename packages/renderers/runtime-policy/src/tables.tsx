import {codeSpan, type Entity} from '@githubnext/projections-schemas'
import {identifier} from '@githubnext/projections-renderer-sdk/presentation'
import {proseOf, type Item, type PolicyItem, type WorkloadItem} from './model.js'
import type {Frame, Run} from './frame.js'
import {Chips} from './chips.js'
import {data, field, Row} from './row.js'

const onOff = (value: unknown, on: string, off: string) => (value === true ? on : value === false ? off : 'unknown')

export function Agent({agent, frame, run}: {agent: Item; frame: Frame; run?: Run | undefined}) {
  const read = (key: string, on: string, off: string) => (entity: Entity) => onOff(entity.data?.[key], on, off)
  return (
    <Row
      item={agent}
      frame={frame}
      run={run}
      className="rp-agent"
      main={
        <>
          <span className="rp-name">{agent.entity.label}</span>
          <span className="rp-meta">
            {field(agent, frame, read('policyFilter', 'policy filter on', 'policy filter off'))}
            {'\u00a0· '}
            {field(agent, frame, read('persistentEnforcement', 'persistent enforcement on', 'persistent enforcement off'))}
            {'\u00a0· '}
            {field(agent, frame, read('policyCrds', 'policy CRDs installed', 'policy CRDs not installed'))}
            {'\u00a0· from '}
            <span className="rp-code" {...identifier}>
              {data(agent.entity, 'path')}
            </span>
          </span>
        </>
      }
    />
  )
}

export function Kernel({kernel, frame, run}: {kernel: Item; frame: Frame; run?: Run | undefined}) {
  const options = (entity: Entity): string => {
    const config = (entity.data?.config ?? {}) as Record<string, unknown>
    return Object.entries(config)
      .map(([option, enabled]) => codeSpan(`${option}=${enabled ? 'y' : 'n'}`))
      .join(' ')
  }
  const version = (entity: Entity): string =>
    typeof entity.data?.kernel === 'string' ? `kernel ${codeSpan(entity.data.kernel)}` : 'any kernel'
  return (
    <Row
      item={kernel}
      frame={frame}
      run={run}
      className="rp-kernel"
      main={
        <>
          <span className="rp-name rp-code" {...identifier}>
            {kernel.entity.label}
          </span>
          <span className="rp-meta">
            {field(kernel, frame, version)}
            {'\u00a0· '}
            {field(kernel, frame, options)}
          </span>
        </>
      }
    />
  )
}

export function Policy({policy, frame, run}: {policy: PolicyItem; frame: Frame; run?: Run | undefined}) {
  const {entity} = policy
  const namespace = data(entity, 'namespace')
  return (
    <Row
      item={policy}
      frame={frame}
      run={run}
      className="rp-policy"
      main={
        <>
          <span className="rp-name rp-code" {...identifier}>
            {entity.label}
          </span>
          <span className="rp-meta">
            <span className="rp-code" {...identifier}>
              {data(entity, 'resource')}
            </span>
            {namespace && (
              <>
                {' in '}
                <span className="rp-code" {...identifier}>
                  {namespace}
                </span>
              </>
            )}
            {'\u00a0· mode '}
            {field(policy, frame, value => codeSpan(data(value, 'mode')))}
            {'\u00a0· loads on '}
            {field(policy, frame, value => proseOf(value.data?.nodes, 'all nodes'))}
          </span>
        </>
      }
      cells={
        <span className="rp-cell rp-side">
          <Chips
            chips={policy.scope}
            frame={frame}
            owner={policy}
            strength={frame.strength(policy)}
            empty="no workloads"
            label="applies to"
          />
        </span>
      }
    />
  )
}

export function Workload({workload, frame, run}: {workload: WorkloadItem; frame: Frame; run?: Run | undefined}) {
  const {entity} = workload
  return (
    <Row
      item={workload}
      frame={frame}
      run={run}
      className="rp-workload"
      main={
        <>
          <span className="rp-name rp-code" {...identifier}>
            {entity.label}
          </span>
          <span className="rp-meta">
            <span className="rp-code" {...identifier}>
              {data(entity, 'resource')}
            </span>
            {' in '}
            <span className="rp-code" {...identifier}>
              {data(entity, 'namespace')}
            </span>
          </span>
        </>
      }
      cells={
        <span className="rp-cell rp-side">
          <Chips
            chips={workload.coveredBy}
            frame={frame}
            owner={workload}
            strength={frame.strength(workload)}
            empty="no policy"
            label="covered by"
          />
        </span>
      }
    />
  )
}
