import {useRef, type CSSProperties} from 'react'
import {ChangeStatus, Group, Prose, SlantedHeading, useSlantedHeadings} from '@githubnext/projections-renderer-kit/react'
import {changeMark, isChanged} from '@githubnext/projections-renderer-kit'
import {dataOf, sectionSpecs} from './sections.js'
import type {AgenticModel, Column, GroupView, MatrixCategory, WorkflowItem} from './model.js'
import type {Frame} from './frame.js'

type Cell = 'present' | 'added' | 'removed' | 'absent'

/**
 * Whether a workflow has a column's capability in the frame's revision. The diff marks a capability that arrives or
 * leaves with its sign, whatever the emphasis, and its hue follows the emphasis; a pane tints one that differs from
 * the other revision while emphasized, without a sign, so emphasis never moves anything.
 */
function cell(item: WorkflowItem, category: MatrixCategory, column: Column, frame: Frame): Cell {
  const spec = sectionSpecs.find(section => section.id === category.section)!
  const has = (revision: 'before' | 'after') => {
    const entity = item[revision]
    return entity !== undefined && spec.read(dataOf(entity)).some(value => value.key === column.key)
  }
  const [before, after] = [has('before'), has('after')]
  const both = item.before !== undefined && item.after !== undefined
  if (frame.side === 'diff') return both && before !== after ? (after ? 'added' : 'removed') : after || before ? 'present' : 'absent'
  const own = frame.side === 'before' ? before : after
  if (!own) return 'absent'
  return both && before !== after && frame.strength(item.row) > 0.01 ? (frame.side === 'after' ? 'added' : 'removed') : 'present'
}

const glyphs: Record<Cell, string> = {present: '●', added: '+', removed: '−', absent: ''}
const words: Record<Cell, string> = {present: 'yes', added: 'added', removed: 'removed', absent: 'no'}

function Row({item, view, frame}: {item: WorkflowItem; view: AgenticModel; frame: Frame}) {
  const strength = frame.strength(item.row)
  const selected = frame.props.selectedId === item.row.id
  return (
    <tr
      className={`aw-matrix-workflow${selected ? ' selected' : ''}`}
      data-entity-id={item.row.id}
      {...(frame.side === 'diff' && isChanged(item.row) ? changeMark(item.row) : {})}
      style={{'--emphasis': strength} as CSSProperties}
    >
      <th scope="row" className="aw-matrix-row">
        <button type="button" className="aw-matrix-select" aria-pressed={selected} onClick={() => frame.props.onSelect(item.row.id)}>
          <code className="pk-code">{item.entity.label}</code>
        </button>
      </th>
      {view.categories.flatMap(category =>
        category.columns.map(column => {
          const value = cell(item, category, column, frame)
          return (
            <td key={`${category.section}:${column.key}`} className="aw-matrix-cell" data-cell={value}>
              <span className="aw-matrix-glyph" aria-hidden="true">
                <span className="pk-label">{glyphs[value]}</span>
              </span>
              <span className="sr-only">{words[value]}</span>
            </td>
          )
        }),
      )}
      {frame.comparing && (
        <td className="aw-matrix-status">
          <ChangeStatus change={item.row} emphasis={strength} />
        </td>
      )}
    </tr>
  )
}

/** A group's heading row, across the capabilities, selectable, with its change in words in the change column. */
function GroupRow({group, span, frame}: {group: GroupView; span: number; frame: Frame}) {
  const row = group.row
  const selected = frame.props.selectedId === row?.id
  return (
    <tr className="aw-matrix-group" {...(row ? {'data-entity-id': row.id} : {})}>
      <th scope="rowgroup" colSpan={span} className="aw-matrix-group-title">
        {row ? (
          <button type="button" className="aw-matrix-select" aria-pressed={selected} onClick={() => frame.props.onSelect(row.id)}>
            <code className="pk-code">{group.title}</code>
          </button>
        ) : (
          group.title
        )}
      </th>
      {frame.comparing && <td className="aw-matrix-status">{row && <ChangeStatus change={row} emphasis={frame.strength(row)} />}</td>}
    </tr>
  )
}

/**
 * Workflows against what they load, the tools they use, what they write and the network they reach: a row per
 * workflow under its group, a column per capability any workflow has in the revisions drawn, gates (classified
 * imports and skills) first, and in a comparison each workflow's change in words.
 */
export function Matrix({view, frame}: {view: AgenticModel; frame: Frame}) {
  const span = 1 + view.categories.reduce((sum, category) => sum + category.columns.length, 0)
  const table = useRef<HTMLTableElement>(null)
  useSlantedHeadings(table)
  return (
    <Group title="Capabilities" icon="agent" className="aw-matrix-panel">
      <div className="aw-matrix-scroll">
        <table className="aw-matrix" ref={table}>
          <thead>
            <tr>
              <th rowSpan={2} scope="col" className="aw-matrix-corner">
                Workflow
              </th>
              {view.categories.map(category => (
                <th key={category.section} colSpan={category.columns.length} scope="colgroup" className="aw-matrix-category">
                  <span className="aw-matrix-category-title">{category.title}</span>
                </th>
              ))}
              {frame.comparing && (
                <th rowSpan={2} scope="col" className="aw-matrix-status">
                  Change
                </th>
              )}
            </tr>
            <tr>
              {view.categories.flatMap(category =>
                category.columns.map(column => (
                  <th
                    key={`${category.section}:${column.key}`}
                    scope="col"
                    className="aw-matrix-column pk-slanted-column"
                    data-gate={column.gate ? '' : undefined}
                  >
                    <SlantedHeading>
                      <Prose>{column.label}</Prose>
                    </SlantedHeading>
                  </th>
                )),
              )}
            </tr>
          </thead>
          {view.groups
            .filter(group => group.workflows.length > 0 || !!group.row)
            .map(group => (
              <tbody key={group.row?.id ?? group.title}>
                {(view.groups.length > 1 || group.row) && <GroupRow group={group} span={span} frame={frame} />}
                {group.workflows.map(item => (
                  <Row key={item.row.id} item={item} view={view} frame={frame} />
                ))}
              </tbody>
            ))}
        </table>
      </div>
    </Group>
  )
}
