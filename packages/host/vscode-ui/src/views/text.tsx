import {describeChange, figuresSentence, rowStatusCounts, variedWithin} from '@githubnext/projections-host'
import type {Row} from '@githubnext/projections-host'
import {Prose} from '../prose.js'
import {VscBadge} from '../elements.js'
import type {VscodeBuiltInViewProps} from './props.js'
import {ChangeLabel, Marker, SelectButton, changeHue} from './row-parts.js'

/** The host's built-in text view: a plain-language outline in reading order, in VS Code's type. */
export function VscodeTextView({
  subject,
  rows,
  progress,
  selectedId,
  onSelect,
  marks,
  onAnnotationActivate,
  summary,
}: VscodeBuiltInViewProps) {
  // The summary bar's sentence, word for word, so the text says what the bar says.
  const summarized = summary?.length ? (
    <p className="phv-lead" data-summary-sentence="">
      Summary: {figuresSentence(summary, subject.mode === 'comparison')}.
    </p>
  ) : null
  if (subject.mode === 'extraction') {
    const {extraction} = subject
    const relationships = new Map<string, Row[]>()
    for (const row of rows) {
      if (row.collection === 'relationships' && row.from) relationships.set(row.from, [...(relationships.get(row.from) ?? []), row])
    }
    const labels = new Map(extraction.entities.map(entity => [entity.id, entity.label]))
    return (
      <div className="ph-text-view phv-text-view" data-view="text">
        <p className="phv-lead">
          This extraction (<code className="phv-code">{extraction.schema}</code>) has {extraction.entities.length.toLocaleString()}{' '}
          {extraction.entities.length === 1 ? 'entity' : 'entities'} and {extraction.relationships.length.toLocaleString()}{' '}
          {extraction.relationships.length === 1 ? 'relationship' : 'relationships'}.
        </p>
        {summarized}
        <ul className="phv-outline">
          {rows
            .filter(row => row.collection === 'entities')
            .map(row => (
              <li key={row.id} data-item-id={row.id}>
                <SelectButton row={row} selected={row.id === selectedId} onSelect={onSelect}>
                  {row.label}
                </SelectButton>{' '}
                <span className="phv-muted">
                  ({row.kind}
                  {row.label === row.id ? '' : `, ${row.id}`})
                </span>
                <Marker row={row} marks={marks} onActivate={onAnnotationActivate} />
                {relationships.get(row.id)?.length ? (
                  <ul>
                    {relationships.get(row.id)!.map(edge => (
                      <li key={edge.id} data-item-id={edge.id}>
                        <SelectButton row={edge} selected={edge.id === selectedId} onSelect={onSelect}>
                          {edge.kind}
                        </SelectButton>{' '}
                        → {labels.get(edge.to ?? '') ?? edge.to}
                        <Marker row={edge} marks={marks} onActivate={onAnnotationActivate} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
        </ul>
        {rows.some(row => row.collection === 'relationships' && !extraction.entities.some(entity => entity.id === row.from)) && (
          <p className="phv-muted">Some relationships start outside the listed entities; see the table view.</p>
        )}
      </div>
    )
  }
  const {comparison} = subject
  const counts = rowStatusCounts(rows.filter(row => row.step !== undefined))
  const listed = new Set(rows.map(row => row.id))
  const byId = new Map(rows.map(row => [row.id, row]))
  const unchanged = rows.filter(row => row.step === undefined).length
  const varied = rows.filter(row => variedWithin(row)).length
  // Changes that varied only within tolerance are unchanged items, counted with them.
  const changeCount = comparison.changes.filter(change => !variedWithin(change)).length
  const total = comparison.steps.length
  const current = total ? Math.min(total - 1, Math.floor(progress * total - 1e-9)) : -1
  return (
    <div className="ph-text-view phv-text-view" data-view="text">
      <p className="phv-lead">
        {changeCount
          ? `${changeCount.toLocaleString()} ${changeCount === 1 ? 'change' : 'changes'} in ${total} ${total === 1 ? 'step' : 'steps'}: ${counts.added} added, ${counts.removed} removed, ${counts.modified} modified${counts.unchanged ? `, ${counts.unchanged} identity-only` : ''}.`
          : 'The two extractions are equivalent: nothing changed.'}{' '}
        {unchanged.toLocaleString()} {unchanged === 1 ? 'item is' : 'items are'} unchanged
        {varied ? `, ${varied.toLocaleString()} of them varied within tolerance` : ''}.
      </p>
      {summarized}
      <ol className="phv-steps">
        {comparison.steps.map((step, index) =>
          !step.changes.some(change => listed.has(change)) ? null : (
            <li
              key={index}
              value={index + 1}
              data-step={index}
              aria-current={progress > 0 && progress < 1 && index === current ? 'step' : undefined}
            >
              <h4 className="phv-step-heading">
                <VscBadge variant="counter">{index + 1}</VscBadge> Step {index + 1} of {total}
                {step.kind ? ` (${step.kind})` : ''}
                {step.summary ? (
                  <>
                    : <Prose>{step.summary}</Prose>
                  </>
                ) : (
                  ''
                )}
              </h4>
              <ul>
                {step.changes.map(change => {
                  const row = byId.get(change)
                  return row ? (
                    <li key={change} data-item-id={change} data-change={changeHue(row)}>
                      <ChangeLabel row={row} />{' '}
                      <SelectButton row={row} selected={change === selectedId} onSelect={onSelect}>
                        <Prose>{describeChange(row)}</Prose>
                      </SelectButton>
                      <Marker row={row} marks={marks} onActivate={onAnnotationActivate} />
                    </li>
                  ) : null
                })}
              </ul>
            </li>
          ),
        )}
      </ol>
    </div>
  )
}
