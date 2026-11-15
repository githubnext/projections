import {useId, useState} from 'react'
import {Prose} from '../prose.js'
import {VscBadge, VscButton, VscTable, VscTableBody, VscTableCell, VscTableHeader, VscTableHeaderCell, VscTableRow} from '../elements.js'
import type {VscodeBuiltInViewProps} from './props.js'
import {ChangeLabel, Marker, SelectButton, changeHue} from './row-parts.js'

const pageSize = 100
const ids = (values: string[]) =>
  values.length ? <code className="phv-code">{values.join(', ')}</code> : <span className="phv-muted">—</span>
const columnWeight: Record<string, number> = {Step: 0.5, Change: 0.9, Kind: 0.9, Summary: 2}

/**
 * The host's built-in table in VSCode Elements' `vscode-table` (zebra rows, VS Code's header and row type): every
 * entity and relationship, or every change and unchanged item.
 */
export function VscodeTableView({
  subject,
  rows,
  total = rows.length,
  selectedId,
  onSelect,
  marks,
  onAnnotationActivate,
}: VscodeBuiltInViewProps) {
  const comparing = subject.mode === 'comparison'
  const id = useId()
  const [limit, setLimit] = useState(pageSize)
  return (
    <div className="ph-table-view phv-table-view" data-view="table">
      <p role="status" className="phv-muted phv-row-count">
        {rows.length.toLocaleString()} of {total.toLocaleString()} rows
      </p>
      {(['entities', 'relationships'] as const).map(collection => {
        const items = rows.filter(row => row.collection === collection)
        const shown = items.slice(0, limit)
        const relationships = collection === 'relationships'
        const title = collection === 'entities' ? 'Entities' : 'Relationships'
        const headers = [
          ...(comparing ? ['Step', 'Change'] : []),
          collection === 'entities' ? 'Entity' : 'Relationship',
          'Kind',
          ...(relationships ? ['From', 'To'] : []),
          ...(comparing ? ['Before', 'After', 'Summary'] : ['ID']),
        ]
        const weights = headers.map(name => columnWeight[name] ?? 1.3)
        const sum = weights.reduce((a, b) => a + b, 0)
        return (
          <section key={collection} className="phv-table" aria-labelledby={`${id}-${collection}`}>
            <h3 id={`${id}-${collection}`} className="phv-section-title">
              {title}{' '}
              <VscBadge variant="counter" className="phv-count">
                {items.length.toLocaleString()}
              </VscBadge>
            </h3>
            {items.length > 0 && (
              <VscTable
                zebra
                aria-labelledby={`${id}-${collection}`}
                data-collection={collection}
                columns={weights.map(weight => `${((weight / sum) * 100).toFixed(2)}%`)}
              >
                <VscTableHeader slot="header">
                  {headers.map(header => (
                    <VscTableHeaderCell key={header}>{header}</VscTableHeaderCell>
                  ))}
                </VscTableHeader>
                <VscTableBody slot="body">
                  {shown.map(row => (
                    <VscTableRow
                      key={row.id}
                      data-row-id={row.id}
                      data-status={row.status}
                      data-change={comparing ? changeHue(row) : undefined}
                      data-selected={row.id === selectedId || undefined}
                    >
                      {comparing && (
                        <VscTableCell>{row.step === undefined ? <span className="phv-muted">—</span> : row.step + 1}</VscTableCell>
                      )}
                      {comparing && (
                        <VscTableCell>
                          <ChangeLabel row={row} />
                        </VscTableCell>
                      )}
                      <VscTableCell>
                        <SelectButton row={row} selected={row.id === selectedId} onSelect={onSelect}>
                          {row.label}
                        </SelectButton>
                        <Marker row={row} marks={marks} onActivate={onAnnotationActivate} />
                      </VscTableCell>
                      <VscTableCell>{row.kind || <span className="phv-muted">—</span>}</VscTableCell>
                      {relationships && (
                        <>
                          <VscTableCell>{ids(row.from ? [row.from] : [])}</VscTableCell>
                          <VscTableCell>{ids(row.to ? [row.to] : [])}</VscTableCell>
                        </>
                      )}
                      {comparing ? (
                        <>
                          <VscTableCell>{ids(row.before)}</VscTableCell>
                          <VscTableCell>{ids(row.after)}</VscTableCell>
                          <VscTableCell>{row.summary ? <Prose>{row.summary}</Prose> : ''}</VscTableCell>
                        </>
                      ) : (
                        <VscTableCell>{ids([row.id])}</VscTableCell>
                      )}
                    </VscTableRow>
                  ))}
                </VscTableBody>
              </VscTable>
            )}
            {!items.length && <p className="phv-muted phv-empty">No {collection} match.</p>}
            {items.length > shown.length && (
              <div className="phv-more">
                <VscButton secondary onClick={() => setLimit(value => value + pageSize)}>
                  Show {Math.min(pageSize, items.length - shown.length)} more {collection}
                </VscButton>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
