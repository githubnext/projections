import {escapeProse} from '@githubnext/projections-schemas'
import type {Entity} from '@githubnext/projections-schemas'
import {identifier} from '@githubnext/projections-renderer-sdk/presentation'
import {classifyChange, isChanged} from '@githubnext/projections-renderer-kit'
import {Icon} from '@githubnext/projections-renderer-kit/react'
import {effectIcon} from './model.js'
import {conditionLines, effectProse, hookSummary, stabilityText} from './prose.js'
import type {HookItem, ProbeItem, SelectorItem} from './model.js'
import {emphasisStyle, inherits, markOf, regionOf, runAttributes, runs, showsStatus} from './frame.js'
import type {Frame, Inherit, Run} from './frame.js'
import {Chips} from './chips.js'
import {Changed, data, field, Head, Row, Sign, Status, Warnings} from './row.js'
import {Prose} from './breaks.js'

/**
 * A hook lane: one group of its category's table, headed by the hook's row, then column headers and every policy's
 * rules there. It is the hook's own unit; an added or removed hook marks the whole lane.
 */
export function Lane({hook, frame}: {hook: HookItem; frame: Frame}) {
  const {type, stability} = hookSummary(hook.entity)
  const strength = frame.strength(hook)
  const selected = frame.props.selectedId === hook.row.id
  const region = frame.side === 'diff' ? regionOf(hook) : undefined
  const marked = frame.side === 'diff' && isChanged(hook.row)
  // The hook row's own status sits above the column headers; they head a status column only for the rows below them.
  const status = Math.max(
    0,
    ...hook.probes.flatMap(probe => {
      const {inherited, rules} = probeMarks(probe, frame, region)
      return [
        ...(showsStatus(probe, inherited) ? [frame.strength(probe)] : []),
        ...probe.selectors.filter(rule => showsStatus(rule, inherits(rule, rules))).map(frame.strength),
      ]
    }),
  )
  return (
    <section
      className={`rp-lane${marked ? ' pk-region pk-region-run' : ''}${selected ? ' selected' : ''}${region === 'removed' ? ' departed' : ''}`}
      aria-label={`${type} ${hook.entity.label}`}
      data-entity-id={hook.row.id}
      data-projections-unit=""
      data-change={marked ? classifyChange(hook.row) : undefined}
      {...(marked ? runAttributes() : {})}
      style={emphasisStyle(strength)}
    >
      <div className="rp-row rp-hook">
        <Sign item={hook} frame={frame} strength={strength} />
        <button
          type="button"
          className="rp-cell rp-main rp-select"
          aria-pressed={selected}
          onClick={() => frame.props.onSelect(hook.row.id)}
        >
          <span className="rp-code rp-muted" {...identifier}>
            {type}
          </span>{' '}
          {/* The separator ends the name's item, so when the stability wraps to its own line no line starts with it. */}
          <span className="rp-hook-name">
            <span className="rp-name rp-code" {...identifier}>
              {hook.entity.label}
            </span>
            {stability && <span className="rp-separator">{'\u00a0·'}</span>}
          </span>
          {stability && <span className="rp-meta">{stabilityText[stability] ?? stability}</span>}
        </button>
        <Warnings entity={hook.entity} />
        {frame.comparing && <Status item={hook} strength={strength} inherited={false} />}
      </div>
      <Head frame={frame} cells={['Rule', 'Effect', 'Applies to']} status={status} as="div" />
      {hook.probes.map(probe => (
        <Probe key={probe.row.id} probe={probe} frame={frame} region={region} />
      ))}
    </section>
  )
}

/** How a probe is marked in its lane: inheriting the lane's change, or marking its own region, which its rules inherit. */
function probeMarks(probe: ProbeItem, frame: Frame, region: Inherit) {
  const inherited = inherits(probe, region)
  // A probe added or removed on its own marks its rules' region; within a marked lane it inherits the lane's.
  const own = frame.side === 'diff' && !inherited ? regionOf(probe) : undefined
  return {inherited, own, rules: own ?? region}
}

function Probe({probe, frame, region}: {probe: ProbeItem; frame: Frame; region: Inherit}) {
  const {inherited, own, rules} = probeMarks(probe, frame, region)
  const ruleRuns = runs(probe.selectors.map(selector => markOf(selector, frame, inherits(selector, rules))))
  const message = data(probe.entity, 'message')
  return (
    <div
      className={`rp-region${own ? ' pk-region pk-region-run' : ''}${own === 'removed' ? ' departed' : ''}`}
      data-change={own}
      {...(own ? runAttributes() : {})}
      style={emphasisStyle(own ? frame.strength(probe) : 0)}
    >
      <Row
        as="div"
        item={probe}
        frame={frame}
        className="rp-probe"
        part
        inherited={inherited}
        regionFill={own !== undefined}
        main={
          <>
            <span className="rp-name rp-code" {...identifier}>
              {probe.policy?.entity.label ?? 'policy'}
            </span>
            {message && <span className="rp-message">{field(probe, frame, value => escapeProse(data(value, 'message')))}</span>}
          </>
        }
      />
      <ul className="rp-rules" aria-label={`Rules of ${probe.policy?.entity.label ?? 'policy'} at ${probe.entity.label}`}>
        {probe.selectors.map((selector, index) => (
          <Rule key={selector.row.id} rule={selector} frame={frame} region={rules} run={ruleRuns[index]} />
        ))}
      </ul>
    </div>
  )
}

/** A rule's effect in words, with an icon when it enforces (or would, but for monitor mode). */
function Effect({entity}: {entity: Entity | undefined}) {
  const icon = effectIcon(entity)
  return (
    <>
      {icon && <Icon name={icon} className="rp-icon" />}
      <Prose>{effectProse(entity)}</Prose>
    </>
  )
}

function Conditions({lines}: {lines: string[]}) {
  return (
    <span className="rp-conditions">
      {lines.map((terms, index) => (
        <span key={index} className="rp-condition">
          {index > 0 && 'and '}
          <Prose>{terms}</Prose>
        </span>
      ))}
    </span>
  )
}

function Rule({rule, frame, region, run}: {rule: SelectorItem; frame: Frame; region: Inherit; run?: Run | undefined}) {
  const before = frame.side === 'diff' ? rule.before : undefined
  const after = frame.side === 'diff' ? rule.after : undefined
  const changed = (read: (entity: Entity) => string) => before && after && read(before) !== read(after)
  const conditionsOf = (entity: Entity) => conditionLines(entity).join('\n')
  const effectOf = (entity: Entity) => effectProse(entity)
  const labelled = rule.entity.data?.['implicit'] !== true
  return (
    <Row
      item={rule}
      frame={frame}
      run={run}
      className="rp-rule"
      part
      inherited={inherits(rule, region)}
      main={
        <>
          {labelled && (
            <span
              className={`rp-name${rule.entity.data?.['label'] ? ' rp-code' : ''}`}
              {...(rule.entity.data?.['label'] ? identifier : {})}
            >
              {rule.entity.label}
            </span>
          )}
          {changed(conditionsOf) ? (
            <Changed before={<Conditions lines={conditionLines(before)} />} after={<Conditions lines={conditionLines(after)} />} />
          ) : (
            <Conditions lines={conditionLines(rule.entity)} />
          )}
        </>
      }
      cells={
        <>
          <span
            className="rp-cell rp-effect"
            data-effect={typeof rule.entity.data?.['effect'] === 'string' ? rule.entity.data['effect'] : undefined}
          >
            {changed(effectOf) ? (
              <Changed before={<Effect entity={before} />} after={<Effect entity={after} />} />
            ) : (
              <Effect entity={rule.entity} />
            )}
          </span>
          <span className="rp-cell rp-side">
            <Chips chips={rule.chips} frame={frame} owner={rule} strength={frame.strength(rule)} empty="any binary" label="applies to" />
          </span>
        </>
      }
    />
  )
}
