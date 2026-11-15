import type {ReactNode} from 'react'
import type {DetailConnection, DetailEvidence, EvidenceLink, FieldChange, RowDetails} from '@githubnext/projections-host'
import {Prose} from '../prose.js'
import {GeneratedList, VariedList} from '../varied.js'

/** A card section with its heading. */
function Section({id, heading, children}: {id: string; heading: string; children: ReactNode}) {
  return (
    <section className="phv-detail-section" aria-labelledby={id}>
      <h4 id={id} className="phv-detail-heading">
        {heading}
      </h4>
      {children}
    </section>
  )
}

/** What changed (or, in one extraction, the properties): the change and its tags, the summary, and field by field. */
export function ChangesSection({
  id,
  details,
  comparing,
  field,
}: {
  id: string
  details: RowDetails
  comparing: boolean
  field: (change: FieldChange) => ReactNode
}) {
  const changed = details.parts.length > 0 || details.fields.length > 0
  return (
    <Section id={id} heading={comparing ? 'What changed' : 'Properties'}>
      {(details.parts.length > 0 || details.tags.length > 0) && (
        <p className="phv-detail-status">
          {details.parts.map(part => (
            <span key={part.label} className="phv-change-label" data-change={part.hue}>
              {part.label}
            </span>
          ))}
          {details.tags.map(tag => (
            <span key={tag} className="phv-change-tag" data-tag={tag}>
              {tag}
            </span>
          ))}
        </p>
      )}
      {details.summary && (
        <p className="phv-muted">
          <Prose>{details.summary}</Prose>
        </p>
      )}
      <GeneratedList generated={details.generated} />
      {details.fields.length > 0 ? (
        <ul className="phv-properties phv-fields" aria-label="Fields">
          {details.fields.map(field)}
        </ul>
      ) : (
        comparing &&
        !(changed && (details.varied.length || details.generated.length)) && (
          <p className="phv-muted">{changed ? 'No field changed.' : 'Unchanged.'}</p>
        )
      )}
      {details.moreFields > 0 && (
        <p className="phv-muted">
          and {details.moreFields} more {details.moreFields === 1 ? 'field' : 'fields'}
        </p>
      )}
      <VariedList varied={details.varied} />
    </Section>
  )
}

/** An evidence location: a link (`evidenceLink`), else a button that asks to open it (`onOpen`), else plain text. */
function EvidenceLocation({
  location,
  evidenceLink,
  onOpen,
}: {
  location: DetailEvidence
  evidenceLink: EvidenceLink | undefined
  onOpen: ((path: string, line?: number) => void) | undefined
}) {
  const text = `${location.path}${location.line ? `:${location.line}` : ''}`
  const href = evidenceLink?.({path: location.path, ...(location.line ? {line: location.line} : {})}, location.side)
  if (href)
    return (
      <a className="phv-link phv-evidence-link" href={href} target="_blank" rel="noreferrer noopener">
        {text}
      </a>
    )
  return onOpen ? (
    <button type="button" className="phv-link phv-evidence-link" onClick={() => onOpen(location.path, location.line)}>
      {text}
    </button>
  ) : (
    <code className="phv-code">{text}</code>
  )
}

/** Where in the code: each evidence location, the before side's marked with its revision's label. */
export function EvidenceSection({
  id,
  details,
  comparing,
  beforeLabel,
  evidenceLink,
  onOpen,
}: {
  id: string
  details: RowDetails
  comparing: boolean
  beforeLabel: string
  evidenceLink: EvidenceLink | undefined
  onOpen: ((path: string, line?: number) => void) | undefined
}) {
  return (
    <Section id={id} heading="Where in the code">
      <ul className="phv-evidence">
        {details.evidence.map(location => (
          <li key={`${location.side}:${location.path}${location.line ? `:${location.line}` : ''}`} data-side={location.side}>
            <EvidenceLocation location={location} evidenceLink={evidenceLink} onOpen={onOpen} />
            {comparing && location.side === 'before' && <span className="phv-muted"> {beforeLabel}</span>}
          </li>
        ))}
      </ul>
      {details.moreEvidence > 0 && <p className="phv-muted">and {details.moreEvidence} more</p>}
    </Section>
  )
}

const directionWords: Record<DetailConnection['direction'], string> = {outgoing: '→', incoming: '←', from: 'From', to: 'To'}
const directionNames: Partial<Record<DetailConnection['direction'], string>> = {from: 'From: ', to: 'To: '}

/** A connection's accessible name: its direction (for an endpoint), the row it selects and how that row changed. */
const connectionName = (connection: DetailConnection) =>
  `${directionNames[connection.direction] ?? ''}${connection.rowLabel}${connection.parts.length ? `, ${connection.parts.map(part => part.label).join(', ')}` : ''}`

/** The item's connections, each a button selecting its row. */
export function ConnectionsSection({id, details, select}: {id: string; details: RowDetails; select: (rowId: string) => void}) {
  return (
    <Section id={id} heading="Connections">
      <ul className="phv-connections">
        {details.connections.map(connection => (
          <li key={`${connection.direction}:${connection.rowId}`}>
            <button
              type="button"
              className="phv-connection"
              data-connection-id={connection.rowId}
              data-direction={connection.direction}
              aria-label={connectionName(connection)}
              onClick={() => select(connection.rowId)}
            >
              <span aria-hidden="true" className="phv-muted">
                {directionWords[connection.direction]}
              </span>
              <span className="phv-connection-label">{connection.label}</span>
              {(connection.direction === 'outgoing' || connection.direction === 'incoming') && connection.kind && (
                <span className="phv-muted">{connection.kind}</span>
              )}
              {connection.parts.map(part => (
                <span key={part.label} className="phv-change-label" data-change={part.hue}>
                  {part.label}
                </span>
              ))}
            </button>
          </li>
        ))}
      </ul>
      {details.moreConnections > 0 && <p className="phv-muted">and {details.moreConnections} more</p>}
    </Section>
  )
}
