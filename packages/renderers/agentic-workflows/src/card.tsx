import {classifyChange, isChanged} from '@githubnext/projections-renderer-kit'
import {ChangePills, EntityCard, Icon, Prose, ValueChange} from '@githubnext/projections-renderer-kit/react'
import type {PillItem} from '@githubnext/projections-renderer-kit/react'
import {codeSpan} from '@githubnext/projections-schemas'
import type {ReactNode} from 'react'
import {dataOf} from './sections.js'
import type {Direction, Entry, Section, Side, WorkflowItem} from './model.js'
import type {Frame} from './frame.js'

/** Sections every card shows, even empty: what a reviewer always asks of an agent. */
const always = new Set(['triggers', 'network', 'outputs'])

const directionWords: Record<Direction, string> = {widened: 'Widened', narrowed: 'Narrowed', changed: 'Changed'}

/**
 * A section's direction labels: words with an icon, never color alone, while the change is emphasized. They sit over
 * the end of the section's title line, out of the flow, so they never move anything.
 */
function Directions({directions, strength}: {directions: readonly Direction[]; strength: number}) {
  if (!directions.length || strength <= 0.01) return null
  return (
    <span className="aw-directions">
      {directions.map(direction => (
        <span key={direction} className="aw-direction" data-direction={direction} style={{opacity: Math.min(1, strength)}}>
          <Icon name={direction === 'widened' ? 'warning' : direction === 'narrowed' ? 'info' : 'changed'} className="aw-icon" />
          {directionWords[direction]}
        </span>
      ))}
    </span>
  )
}

/** An entry's text as one run, so its words and code spans wrap together inside a pill. */
const Words = ({children}: {children: string}) => (
  <span className="aw-words">
    <Prose>{children}</Prose>
  </span>
)

/** The longest old and new text, together, that reads as one old → new pill; longer ones read as two pills. */
const inlineChange = 48

/**
 * An entry as pills. In the diff, arriving or leaving entries take the pill's sign and hue, and one changed in place
 * reads old → new, or, when that is too long for a line, as the old pill leaving and the new one arriving: the same
 * pills at every emphasis, whose hue follows it. A side-by-side pane draws its own revision's entries, tinted while
 * emphasized, one changed in place in the pane's hue (its pills' signs are hidden, so emphasis never moves anything).
 */
function pills(entry: Entry, side: Side, marked: boolean): PillItem[] {
  const diff = side === 'diff'
  if (diff && entry.mark === 'modified' && entry.was !== undefined) {
    if (entry.was.length + entry.text.length > inlineChange) {
      return [
        {key: `${entry.key}|was`, label: <Words>{entry.was}</Words>, change: 'removed'},
        {key: entry.key, label: <Words>{entry.text}</Words>, change: 'added'},
      ]
    }
    return [
      {key: entry.key, label: <ValueChange layout="inline" before={<Words>{entry.was}</Words>} after={<Words>{entry.text}</Words>} />},
    ]
  }
  const mark = entry.mark === 'modified' && !diff ? (side === 'before' ? 'removed' : 'added') : entry.mark
  const change = (diff || marked) && (mark === 'added' || mark === 'removed') ? mark : 'unchanged'
  return [{key: entry.key, label: <Words>{entry.text}</Words>, change}]
}

function SectionRow({section, strength, frame}: {section: Section; strength: number; frame: Frame}) {
  // What a section shows depends only on the revisions drawn, never on emphasis or the comparator.
  const shown = section.entries
  if (!shown.length && !always.has(section.spec.id)) return null
  return (
    <div className="aw-section" data-section={section.spec.id}>
      <dt className="aw-section-title">
        <Icon name={section.spec.icon} className="aw-icon aw-muted" />
        <span>{section.spec.title}</span>
        <Directions directions={section.directions} strength={strength} />
      </dt>
      <dd className="aw-section-body">
        {shown.length ? (
          <ChangePills items={shown.flatMap(entry => pills(entry, frame.side, strength > 0.01))} label={section.spec.title} />
        ) : (
          <span className="aw-muted">{section.spec.empty}</span>
        )}
      </dd>
    </div>
  )
}

const lockWords: Record<string, string> = {
  current: 'Lock current',
  stale: 'Lock stale',
  missing: 'Lock missing',
  unverified: 'Lock unverified',
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/** A workflow's engine and model (text with inline code), whether strict mode is off, and its lock file's state. */
function facts(entity: WorkflowItem['entity'] | undefined) {
  const data = dataOf(entity)
  const engine = record(data.engine)
  const lock = record(data.lock).status
  return {
    engine: codeSpan(String(engine.id ?? 'copilot')) + (engine.model !== undefined ? ` ${codeSpan(String(engine.model))}` : ''),
    strict: data.strict !== false,
    lock: typeof lock === 'string' ? lock : undefined,
  }
}

const lockText = (lock: string) => lockWords[lock] ?? `Lock ${lock}`

/** One fact of the meta line: in the diff, a fact that changed reads old → new. */
function Fact({was, now}: {was: ReactNode; now: ReactNode}) {
  return was === undefined ? <>{now}</> : <ValueChange layout="inline" before={was} after={now} />
}

/**
 * The engine and model, the lock file's state and strict mode, as one muted line. The diff reads both revisions of a
 * workflow on both sides, so an engine, strict mode or lock state that changes reads old → new.
 */
function Meta({item, diff}: {item: WorkflowItem; diff: boolean}) {
  const now = facts(item.entity)
  const was = diff && item.before && item.after ? facts(item.before) : undefined
  const strictWords = (strict: boolean) => (strict ? 'strict mode on' : 'strict mode off')
  const lock = (status: string | undefined) =>
    status === undefined ? undefined : (
      <span className="aw-lock" data-lock={status}>
        {status !== 'current' && <Icon name="warning" className="aw-icon" />}
        {lockText(status)}
      </span>
    )
  return (
    <p className="aw-meta">
      <span>
        <Fact was={was && was.engine !== now.engine ? <Prose>{was.engine}</Prose> : undefined} now={<Prose>{now.engine}</Prose>} />
      </span>
      {was && was.strict !== now.strict ? (
        <Fact was={strictWords(was.strict)} now={strictWords(now.strict)} />
      ) : (
        !now.strict && <span>{strictWords(false)}</span>
      )}
      {was && was.lock !== now.lock && was.lock !== undefined && now.lock !== undefined ? (
        <Fact was={lock(was.lock)} now={lock(now.lock)} />
      ) : (
        lock(now.lock)
      )}
    </p>
  )
}

/** The extractor's warnings about the presented revision: a stale lock file, unknown or renamed fields. */
function Notes({item}: {item: WorkflowItem}) {
  const findings = dataOf(item.entity).findings
  const messages = (Array.isArray(findings) ? findings : [])
    .map(finding => (finding && typeof finding === 'object' ? (finding as Record<string, unknown>).message : undefined))
    .filter((message): message is string => typeof message === 'string')
  if (!messages.length) return null
  return (
    <ul className="aw-notes" aria-label="Warnings">
      {messages.map(message => (
        <li key={message} className="aw-note">
          <Icon name="warning" className="aw-icon" />
          <span>
            <Prose>{message}</Prose>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** One workflow: its name, engine and lock, then a row per section, and its warnings. */
export function WorkflowCard({item, frame}: {item: WorkflowItem; frame: Frame}) {
  const strength = frame.strength(item.row)
  const data = dataOf(item.entity)
  const name = typeof data.name === 'string' ? data.name : undefined
  const changed = frame.comparing && isChanged(item.row)
  const mark = frame.side === 'diff' && changed ? classifyChange(item.row) : undefined
  return (
    <EntityCard
      id={item.row.id}
      label={name ?? <code className="pk-code">{item.entity.label}</code>}
      identifier={String(data.path ?? item.entity.label)}
      selected={frame.props.selectedId === item.row.id}
      onSelect={frame.props.onSelect}
      {...(frame.comparing ? {change: item.row, emphasis: strength} : {})}
      {...(mark ? {mark} : {})}
    >
      <Meta item={item} diff={frame.side === 'diff'} />
      <dl className="aw-sections">
        {item.sections.map(section => (
          <SectionRow key={section.spec.id} section={section} strength={changed ? strength : 0} frame={frame} />
        ))}
      </dl>
      <Notes item={item} />
    </EntityCard>
  )
}
