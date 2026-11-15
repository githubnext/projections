import {useMemo} from 'react'
import {createStagedTimeline, current, isChanged} from '@githubnext/projections/kit'
import {CardGrid, ContentView, EmptyDomain, EntityCard, Field, Fields, Group, Identifier, RelationshipItem, RelationshipList} from '@githubnext/projections/kit/react'
import type {RendererProps, ViewOptions} from '@githubnext/projections/kit/react'
import {DiffView} from './diff.js'

// The kit's shell, which the build mounts `View` in, connects to the host,
// builds the comparison model, keeps selection, reports steps and height, and
// acknowledges painted frames. `vite.config.ts` declares what the renderer
// supports; `options` adds what only this code can say.
export const options: ViewOptions = {
  // The host draws a summary bar along the bottom: a count of each kind, with its changes in a comparison. Name your
  // kinds in your domain's words (`false` leaves one out), and add facts the counts can't say, computed from the
  // document: `facts: ({model}) => [{type: 'fact', id: 'breaking', icon: 'breaking', count, noun, ids}]`.
  // nouns: {service: {singular: 'service', plural: 'services'}},
}

/**
 * The {{id}} projection: one card per entity, grouped by kind. Replace it
 * with the picture this codebase's system needs; keep the rules below.
 *
 * A comparison opens in diff mode (`props.diff`), drawn by `DiffView` in
 * `diff.tsx`; this view draws extractions and the progress-driven modes,
 * side by side and animated, with the same cards.
 *
 * - `model` pairs every entity across a comparison (`row.before`,
 *   `row.after`); an extraction has identical sides.
 * - Time every change by its own comparison step: the staged timeline gives
 *   each row's presence and progress through its step, so nothing moves while
 *   the host holds between steps.
 * - `props.emphasis(row)` is 0 at both endpoints and before the row's step:
 *   draw change status only in proportion to it, in words (`ChangeFooter`), in
 *   space that is always reserved.
 * - Mark what draws a relationship with its ID in `data-entity-id`, like an
 *   entity, so selection works and the checks see it. A renderer that
 *   deliberately draws none declares `capabilities: {drawsRelationships:
 *   false}` in `vite.config.ts`.
 * - Relationships: `timeline.relationships(timeline.stages[k])` lists those
 *   present in a stage, resolved to entity rows; `timeline.at(progress)` names
 *   the two stages a frame lies between and how far (`mix`). Fade a
 *   relationship in or out by `mix` when only one of them has it.
 * - Put `data-entity-id` on every selectable element; identifiers (IDs, kinds,
 *   paths) go in `Identifier` so they use the monospace font.
 * - Draw no header: the host shows the projection's title and counts.
 * - Compose from the kit's components (`ContentView`, `Group`, `CardGrid`,
 *   `EntityCard`, `Fields`, `Stack`, `Inline`, `Text`) and their props, not
 *   CSS: they take every color, size and space from the host's theme, which
 *   the renderer checks (`npm test`) hold every renderer to. For an inline
 *   style they don't cover, use `token` (`token.space(2)`).
 */
export function View(props: RendererProps) {
  return props.diff ? <DiffView {...props} /> : <TimelineView {...props} />
}

/** Extractions, side by side and animated: the comparison played through its steps. */
function TimelineView(props: RendererProps) {
  const {model, schedule, progress, selectedId, onSelect} = props
  const timeline = useMemo(() => createStagedTimeline(model, schedule), [model, schedule])

  // Every row keeps its place for the whole comparison: removed cards fade out
  // and added cards fade in where they will stay, so nothing jumps.
  const groups = useMemo(() => {
    const byKind = new Map<string, typeof model.entities>()
    for (const row of model.entities) {
      const kind = (row.after ?? row.before)!.kind
      byKind.set(kind, [...(byKind.get(kind) ?? []), row])
    }
    return [...byKind].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  }, [model])

  // A changed entity is also emphasized from the step that changes one of its
  // relationships.
  const relationshipsOf = useMemo(() => {
    const links = new Map<string, typeof model.relationships>()
    for (const link of model.relationships) {
      if (!isChanged(link)) continue
      const ends = [link.before?.from, link.before?.to].map(id => id && model.entityRow.before.get(id))
      ends.push(...[link.after?.from, link.after?.to].map(id => id && model.entityRow.after.get(id)))
      for (const id of new Set(ends)) if (id) links.set(id, [...(links.get(id) ?? []), link])
    }
    return links
  }, [model])

  // Each card lists its outgoing relationships. A frame lies between two
  // stages; a relationship in only one of them grows in or shrinks out by
  // `mix`, so it changes during its own step and nothing jumps.
  const {from, to, mix} = timeline.at(progress)
  const outgoing = useMemo(() => {
    const before = timeline.relationships(timeline.stages[from]!)
    const after = timeline.relationships(timeline.stages[to]!)
    const ids = new Set(after.map(link => link.row.id))
    const links = new Map<string, {link: (typeof after)[number]; presence: number}[]>()
    const add = (link: (typeof after)[number], presence: number) =>
      links.set(link.from, [...(links.get(link.from) ?? []), {link, presence}])
    for (const link of before) add(link, ids.has(link.row.id) ? 1 : 1 - mix)
    const kept = new Set(before.map(link => link.row.id))
    for (const link of after) if (!kept.has(link.row.id)) add(link, mix)
    return links
  }, [timeline, from, to, mix])
  const rowOf = useMemo(() => new Map(model.entities.map(row => [row.id, row])), [model])

  if (!model.entities.length) return <EmptyDomain>This extraction has no entities.</EmptyDomain>
  return (
    // The host shows the title and counts, so the content starts at the top of the frame.
    <ContentView>
      {groups.map(([kind, rows]) => (
        <Group key={kind} title={kind} titleFont="code">
          <CardGrid>
            {rows.map(row => {
              const entity = current(row, timeline.local(row.id, progress))
              const emphasis = isChanged(row)
                ? Math.max(props.emphasis(row), ...(relationshipsOf.get(row.id) ?? []).map(link => props.emphasis(link)))
                : 0
              const data = Object.entries(entity.data ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              const links = outgoing.get(row.id) ?? []
              return (
                <EntityCard
                  key={row.id}
                  id={row.id}
                  label={entity.label}
                  identifier={entity.id}
                  selected={selectedId === row.id}
                  onSelect={onSelect}
                  change={row}
                  emphasis={emphasis}
                  presence={timeline.presence(row.id, progress)}
                >
                  {links.length > 0 && (
                    <RelationshipList>
                      {links.map(({link, presence}) => {
                        const target = rowOf.get(link.to)!
                        const relationship = current(link.row, timeline.local(link.row.id, progress))
                        return (
                          <RelationshipItem
                            key={link.row.id}
                            id={link.row.id}
                            selected={selectedId === link.row.id}
                            onSelect={onSelect}
                            presence={presence}
                          >
                            <Identifier>{relationship.kind}</Identifier> → {current(target, timeline.local(target.id, progress)).label}
                          </RelationshipItem>
                        )
                      })}
                    </RelationshipList>
                  )}
                  {data.length > 0 && (
                    <Fields>
                      {data.map(([key, value]) => (
                        <Field key={key} name={key}>
                          {typeof value === 'string' ? value : JSON.stringify(value)}
                        </Field>
                      ))}
                    </Fields>
                  )}
                </EntityCard>
              )
            })}
          </CardGrid>
        </Group>
      ))}
    </ContentView>
  )
}
