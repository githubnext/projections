import {useId, useState} from 'react'
import type {ReactNode} from 'react'
import type {Varied} from '@githubnext/projections-schemas'
import {
  generatedLabel,
  generatedText,
  generatedTitle,
  generatedWords,
  identifier,
  keyed,
  wordDiff,
} from '@githubnext/projections-renderer-sdk/presentation'
import type {BasisValue} from '@githubnext/projections-renderer-sdk/presentation'
import {Prose} from './components.js'
import {Icon} from './icons.js'

/**
 * The quiet mark beside every generated field's name: the `generated` icon and the word "Generated", muted, so a
 * summary is never mistaken for an extracted fact. A field label, never a change badge.
 */
export function GeneratedMark() {
  return (
    <span className="pk-generated-mark" data-generated-mark="" title={generatedTitle}>
      <Icon name="generated" />
      {generatedLabel}
    </span>
  )
}

/** Two layouts in one grid cell, the inactive one hidden, so switching between them never moves what follows. */
function Stack({active, first, second}: {active: 0 | 1; first: ReactNode; second: ReactNode}) {
  return (
    <div className="pk-generated-stack">
      <div className="pk-generated-layer" aria-hidden={active !== 0 || undefined} data-active={active === 0 || undefined}>
        {first}
      </div>
      <div className="pk-generated-layer" aria-hidden={active !== 1 || undefined} data-active={active === 1 || undefined}>
        {second}
      </div>
    </div>
  )
}

function Passage({value, side}: {value: unknown; side?: 'before' | 'after'}) {
  const text = generatedText(value)
  const json = typeof value !== 'string'
  return (
    <div className={`pk-generated-passage${json ? ' pk-generated-json' : ''}`} data-side={side} {...(json ? identifier : {})}>
      {text}
    </div>
  )
}

function Toggle({pressed, onToggle, children}: {pressed: boolean; onToggle: () => void; children: ReactNode}) {
  return (
    <button type="button" className="pk-generated-toggle" aria-pressed={pressed} onClick={onToggle}>
      {children}
    </button>
  )
}

/**
 * A generated field: its name, the Generated mark and its value, in the form its change calls for.
 *
 * - No change (`entry` absent): the value.
 * - Regenerated from the same inputs (`entry.within`): After's text, the neutral `varied` icon and "Regenerated from
 *   the same inputs", with a toggle that shows Before's wording in place. Never a word diff: rewording from the same
 *   inputs carries no information.
 * - Regenerated because its basis changed: why, then Before and After as whole passages side by side (stacked when
 *   narrow), with a "Word diff" toggle for strings.
 *
 * Toggling never shifts layout: both forms share one grid cell. `bases` lets a moved model read with its old and
 * new IDs.
 */
export function GeneratedText({
  name,
  before,
  after,
  entry,
  bases,
}: {
  /** The field's name, shown verbatim in mono (`summary`). */
  name: string
  before?: unknown
  after?: unknown
  /** The comparison's `varied` entry for this value, if it differs. */
  entry?: Pick<Varied, 'within' | 'because' | 'reason' | 'generated'> | undefined
  bases?: {before?: BasisValue; after?: BasisValue}
}) {
  const [shown, setShown] = useState(false)
  const id = useId()
  const label = (
    <div className="pk-generated-label" id={id}>
      <span className="pk-generated-name" {...identifier}>
        {name}
      </span>
      <GeneratedMark />
    </div>
  )
  if (!entry) {
    return (
      <div className="pk-generated" data-generated="" role="group" aria-labelledby={id}>
        {label}
        <Passage value={after ?? before} />
      </div>
    )
  }
  const words = generatedWords(entry, bases)
  if (entry.within) {
    return (
      <div className="pk-generated" data-generated="regenerated" role="group" aria-labelledby={id}>
        {label}
        <Stack active={shown ? 1 : 0} first={<Passage value={after} side="after" />} second={<Passage value={before} side="before" />} />
        <div className="pk-generated-note">
          <span className="pk-generated-why">
            <Icon name="varied" />
            <Prose>{words}</Prose>
          </span>
          <Toggle pressed={shown} onToggle={() => setShown(!shown)}>
            {shown ? "After's wording" : "Before's wording"}
          </Toggle>
        </div>
      </div>
    )
  }
  const strings = typeof before === 'string' && typeof after === 'string'
  const runs = strings && before !== after ? wordDiff(before, after) : undefined
  const same = before !== undefined && after !== undefined && generatedText(before) === generatedText(after)
  const pair = same ? (
    <Passage value={after} />
  ) : (
    <div className="pk-generated-pair">
      <div className="pk-generated-side">
        <div className="pk-generated-side-label">Before</div>
        {before === undefined ? (
          <div className="pk-generated-passage pk-generated-absent">None</div>
        ) : (
          <Passage value={before} side="before" />
        )}
      </div>
      <div className="pk-generated-side">
        <div className="pk-generated-side-label">After</div>
        {after === undefined ? (
          <div className="pk-generated-passage pk-generated-absent">None</div>
        ) : (
          <Passage value={after} side="after" />
        )}
      </div>
    </div>
  )
  return (
    <div className="pk-generated" data-generated="changed" role="group" aria-labelledby={id}>
      {label}
      <div className="pk-generated-why">
        <Prose>{same ? `${words}; the wording is the same` : words}</Prose>
      </div>
      {runs ? (
        <Stack
          active={shown ? 1 : 0}
          first={pair}
          second={
            <div className="pk-generated-passage pk-generated-diff" data-word-diff="">
              {keyed(runs, run => `${run.op}:${run.text}`).map(([key, run]) =>
                run.op === 'same' ? (
                  <span key={key}>{run.text}</span>
                ) : run.op === 'removed' ? (
                  <del key={key} className="pk-generated-removed">
                    {run.text}
                  </del>
                ) : (
                  <ins key={key} className="pk-generated-added">
                    {run.text}
                  </ins>
                ),
              )}
            </div>
          }
        />
      ) : (
        pair
      )}
      {runs && (
        <div className="pk-generated-note">
          <Toggle pressed={shown} onToggle={() => setShown(!shown)}>
            Word diff
          </Toggle>
        </div>
      )}
    </div>
  )
}
