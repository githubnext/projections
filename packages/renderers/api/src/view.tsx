import {useEffect, useMemo} from 'react'
import type {CSSProperties, ReactNode} from 'react'
import type {Entity} from '@githubnext/projections-schemas'
import {identifier} from '@githubnext/projections-renderer-sdk/presentation'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {RendererControl} from '@githubnext/projections-renderer-sdk/protocol'
import {changeMark, presentedEmphasis, statusParts} from '@githubnext/projections-renderer-kit'
import {ChangeFooter, EmptyDomain, Fold, Identifier, Notice, Prose, useFolds} from '@githubnext/projections-renderer-kit/react'
import type {RendererProps} from '@githubnext/projections-renderer-kit/react'
import {changesFirst, comparisonRows, declarationLimit, limitEntries, limitScope, qualifiedNames, revisionRows} from './model.js'
import {breakingFirst, compatibilityOf, reasonText} from './compatibility.js'
import type {Compatibility} from './compatibility.js'
import type {Side} from './signature.js'
import {CompatibilityFooter, CompatibilityNotices} from './compatibility-view.js'
import {DiffSignature, RevisionSignature} from './signature-view.js'
import type {accepts} from './accepts.js'

/** Offered when the comparison is classified: list only its breaking changes. */
export const apiControls = [
  {
    id: 'breakingOnly',
    label: 'Breaking only',
    description: 'Show only declarations whose change breaks consumers',
    type: 'toggle',
    default: false,
  },
] as const satisfies RendererControl[]

/** The declaration's qualified name, when it says more than its label: `old → new` when it changed. */
function Identity({ids, labels}: {ids: string[]; labels: string[]}) {
  if (ids.every((id, index) => id === labels[index])) return null
  return (
    <code className="semantic-id" {...identifier}>
      {ids.length > 1 && ids[0] !== ids[1] ? (
        <>
          <del>{ids[0]}</del>
          <span aria-hidden="true"> → </span>
          <span className="sr-only"> now </span>
          {ids[1]}
        </>
      ) : (
        ids.at(-1)
      )}
    </code>
  )
}

/**
 * One declaration row. In a comparison it ends in a change footer (kit
 * `ChangeFooter`) spanning the row: every row reserves it, and it states the
 * change (`+ Added`, `→ Renamed ~ Modified`) while `emphasis` is above 0.
 */
function Declaration({
  row,
  entity,
  previous,
  emphasis,
  comparing,
  selected,
  onSelect,
  compatibility,
  diff,
  names,
  children,
}: {
  row: EntityChange<Entity>
  entity: Entity
  previous?: Entity | undefined
  emphasis: number
  comparing: boolean
  selected: boolean
  onSelect: (id: string) => void
  compatibility: Compatibility | undefined
  diff: boolean
  /** Qualified names of each revision's declarations, by ID. */
  names: {before: ReadonlyMap<string, string>; after: ReadonlyMap<string, string>}
  children: ReactNode
}) {
  const classified = compatibility?.changes.get(row.id)
  const relabelled = previous && previous.label !== entity.label
  const shown = previous ? [previous, entity] : [entity]
  const nameOf = (item: Entity) => names.after.get(item.id) ?? names.before.get(item.id) ?? item.id
  return (
    <section className={`api-declaration${selected ? ' selected' : ''}`} data-entity-id={row.id} {...(diff ? changeMark(row) : {})}>
      <div className="api-declaration-name">
        <span className="api-declaration-head">
          {relabelled && (
            <span className="api-previous-label">
              <span className="sr-only">Previously </span>
              <Identifier truncate title={previous.label}>
                <del>{previous.label}</del>
              </Identifier>
              <span aria-hidden="true"> →</span>
            </span>
          )}
          <button
            type="button"
            className="entity-link pk-truncate"
            {...identifier}
            title={entity.label}
            aria-pressed={selected}
            onClick={() => onSelect(row.id)}
          >
            {entity.label}
          </button>
        </span>
        <Identity
          ids={previous ? [names.before.get(previous.id) ?? previous.id, names.after.get(entity.id) ?? entity.id] : [nameOf(entity)]}
          labels={shown.map(item => item.label)}
        />
      </div>
      <div className="api-declaration-signature">
        {children}
        {diff && classified && (
          <p
            className="api-compatibility-reason"
            data-compatibility={classified.level}
            style={{visibility: emphasis > 0.01 ? 'visible' : 'hidden', opacity: Math.min(1, emphasis)}}
            aria-hidden={emphasis < 0.05}
          >
            <Prose>{reasonText(classified)}</Prose>
          </p>
        )}
      </div>
      {comparing &&
        (compatibility ? (
          <CompatibilityFooter row={row} emphasis={emphasis} classified={classified} diff={diff} />
        ) : (
          <ChangeFooter className="api-declaration-footer" change={row} emphasis={emphasis} />
        ))}
    </section>
  )
}

/**
 * Exported declarations, one row each. In `diff` mode every declaration of
 * both revisions is listed once, in ID order (changes first when they don't
 * all fit), with its signature diff and its change status in the row's
 * footer; otherwise (an extraction, or a
 * side-by-side pane at progress 0 or 1) one revision's declarations are
 * listed, and with highlighting each pane marks its side of the changes. In a
 * comparison every row reserves its footer, so status never moves a row.
 */
export function ApiView(props: RendererProps<typeof accepts>) {
  const {
    model,
    init,
    diff,
    comparing,
    progress,
    highlighting,
    selectedId,
    onSelect,
    emphasis: emphasisOf,
    controls,
    declareControls,
    scope,
  } = props
  const side: Side = comparing && progress < 0.5 ? 'before' : 'after'
  const compatibility = useMemo(() => (init.mode === 'comparison' ? compatibilityOf(init.comparison.metadata) : undefined), [init])
  useEffect(() => declareControls(compatibility ? apiControls : []), [compatibility, declareControls])
  const breakingOnly = Boolean(compatibility && controls.breakingOnly === true)
  const all = useMemo(() => {
    const ordered = diff ? breakingFirst(comparisonRows(model), compatibility) : revisionRows(model, side)
    // Every row stays in order under the Changes scope, which folds what it doesn't show; otherwise a diff too long to
    // list puts its changes first, so the limit cuts unchanged declarations.
    const listed = diff && !scope ? changesFirst(ordered, declarationLimit) : ordered
    return breakingOnly ? listed.filter(row => compatibility?.changes.get(row.id)?.level === 'breaking') : listed
  }, [model, diff, side, compatibility, breakingOnly, scope])
  // The Changes scope folds each run of declarations it doesn't show (both panes alike, from the union's IDs), and the
  // limit counts only the declarations it draws: changes first, then their context.
  const shownScope = useMemo(() => scope && limitScope(scope, all, declarationLimit), [scope, all])
  const rows = shownScope ? all.filter(row => shownScope.shown.has(row.id)) : all.slice(0, declarationLimit)
  const scopeTotal = scope ? all.filter(row => scope.shown.has(row.id)).length : all.length
  const folded = useFolds(shownScope ? all : rows, row => row.id, shownScope)
  const {expand, collapse} = folded
  // The limit counts what is drawn: declarations outside a fold, and an opened fold's run.
  const {entries, drawn} = useMemo(() => limitEntries(folded.entries, declarationLimit), [folded.entries])
  // In scope but past the limit, or opened beyond it: what the notice counts as not drawn.
  const total = shownScope ? folded.entries.filter(entry => entry.type === 'item').length + (scopeTotal - rows.length) : all.length
  const names = useMemo(() => ({before: qualifiedNames(model.before), after: qualifiedNames(model.after)}), [model])
  // One status cell width for every row, from the longest change status this comparison can show.
  const parts = Math.max(1, ...rows.map(row => statusParts(row).length))
  const style = compatibility ? ({'--pk-status-width': parts > 1 ? '21ch' : '11ch'} as CSSProperties) : undefined
  return (
    <div className="api-view pk-stage" data-highlighting={highlighting > 0 ? 'on' : 'off'} style={style}>
      <div className="api-panel" data-projections-content="">
        {compatibility && <CompatibilityNotices compatibility={compatibility} />}
        <Notice shown={drawn} total={total} noun="declarations" />
        {/* Folded wholly (a pane whose declarations are all context elsewhere), a pane still lists its folds. */}
        {!(shownScope ? all.length : rows.length) ? (
          breakingOnly ? (
            <EmptyDomain title="No breaking changes">No declaration in this comparison breaks its consumers.</EmptyDomain>
          ) : (
            <EmptyDomain title="No declarations">
              {comparing ? 'Neither revision exports declarations.' : 'This revision exports no declarations.'}
            </EmptyDomain>
          )
        ) : (
          <div className="api-declarations">
            {entries.map(entry => {
              if (entry.type === 'fold')
                return (
                  <Fold
                    key={`fold:${entry.key}`}
                    count={entry.items.length}
                    noun="declarations"
                    open={entry.open}
                    onToggle={() => (entry.open ? collapse : expand)(entry.key)}
                  />
                )
              const row = entry.item
              const common = {row, comparing, selected: selectedId === row.id, onSelect, compatibility, diff, names}
              if (diff) {
                return (
                  <Declaration
                    key={row.id}
                    {...common}
                    entity={(row.after ?? row.before)!}
                    previous={row.after && row.before}
                    emphasis={emphasisOf(row)}
                  >
                    <DiffSignature row={row} />
                  </Declaration>
                )
              }
              // A side-by-side pane is an endpoint: its changes are emphasized only by the host's highlighting, not by a step.
              const emphasis = presentedEmphasis(row, highlighting)
              return (
                <Declaration key={row.id} {...common} entity={row[side]!} emphasis={emphasis}>
                  <RevisionSignature row={row} side={side} emphasized={emphasis > 0} />
                </Declaration>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
