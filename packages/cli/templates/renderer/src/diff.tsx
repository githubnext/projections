import {useMemo} from 'react'
import {diffModel, formatValue, isChanged} from '@githubnext/projections/kit'
import {CardGrid, ContentView, EmptyDomain, EntityCard, Field, Fields, Group, Identifier, RelationshipItem, RelationshipList, ValueChange} from '@githubnext/projections/kit/react'
import type {DiffRelationship} from '@githubnext/projections/kit'
import type {RendererProps} from '@githubnext/projections/kit/react'

/**
 * Diff mode, the view a comparison opens in: one static picture of the union
 * of both revisions, with every change marked where it is. Build this first;
 * `view.tsx` adds side by side and animated from the same cards.
 *
 * - `diffModel(model)` gives every entity of either revision once (`entity`
 *   is After's version, or Before's for a removed one; `fields` lists what
 *   changed) and every relationship (one rewired between other entities is two
 *   parts: its old one removed, its new one added).
 * - `EntityCard` and `RelationshipItem` with `mark={change}` fill and edge
 *   the item in its change's hue (the kit's `changeMark`), strike a removed
 *   one's name through, and say the change in words too (the card's footer,
 *   `changeText` for assistive technology), never by color alone, in space
 *   that is always reserved.
 * - Marks follow `props.emphasis(row)`, so the host's highlighting off draws
 *   the union plain.
 * - The host's summary bar counts each kind and its changes along the bottom
 *   (see `nouns` and `facts` in view.tsx's `options`), so the view draws no summary line.
 */
export function DiffView(props: RendererProps) {
  const {model, selectedId, onSelect} = props
  const diff = useMemo(() => diffModel(model), [model])

  const groups = useMemo(() => {
    const byKind = new Map<string, typeof diff.entities>()
    for (const item of diff.entities) byKind.set(item.entity.kind, [...(byKind.get(item.entity.kind) ?? []), item])
    return [...byKind].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  }, [diff])
  // Each card lists its outgoing relationships, from either revision.
  const outgoing = useMemo(() => {
    const links = new Map<string, DiffRelationship[]>()
    for (const part of diff.relationships) links.set(part.from, [...(links.get(part.from) ?? []), part])
    return links
  }, [diff])

  if (!diff.entities.length) return <EmptyDomain>Neither revision has entities.</EmptyDomain>
  return (
    <ContentView>
      {groups.map(([kind, items]) => (
        <Group key={kind} title={kind} titleFont="code">
          <CardGrid>
            {items.map(item => {
              const emphasis = isChanged(item.row) ? props.emphasis(item.row) : 0
              const changed = new Map(item.fields.map(field => [field.key, field]))
              const label = changed.get('label')
              // The drawn version's fields, and any field only the other version had.
              const keys = [
                ...new Set([...Object.keys(item.entity.data ?? {}), ...item.fields.map(field => field.key).filter(key => key !== 'label')]),
              ].sort()
              const links = outgoing.get(item.id) ?? []
              return (
                <EntityCard
                  key={item.id}
                  id={item.id}
                  label={
                    label ? (
                      <ValueChange layout="inline" before={formatValue(label.before)} after={formatValue(label.after)} />
                    ) : (
                      item.entity.label
                    )
                  }
                  identifier={item.entity.id}
                  selected={selectedId === item.id}
                  onSelect={onSelect}
                  change={item.row}
                  emphasis={emphasis}
                  mark={item.change}
                >
                  {links.length > 0 && (
                    <RelationshipList>
                      {links.map(part => (
                        <RelationshipItem
                          key={part.key}
                          id={part.id}
                          selected={selectedId === part.id}
                          onSelect={onSelect}
                          mark={part.change}
                          emphasis={isChanged(part.row) ? props.emphasis(part.row) : 0}
                          {...(part.change !== 'unchanged' ? {changeText: part.change} : {})}
                        >
                          <Identifier>{part.relationship.kind}</Identifier> → {diff.entity(part.to)?.entity.label ?? part.to}
                        </RelationshipItem>
                      ))}
                    </RelationshipList>
                  )}
                  {keys.length > 0 && (
                    <Fields>
                      {keys.map(key => {
                        const field = changed.get(key)
                        return (
                          <Field key={key} name={key}>
                            {field ? (
                              <ValueChange
                                layout="inline"
                                before={field.before === undefined ? undefined : formatValue(field.before)}
                                after={field.after === undefined ? undefined : formatValue(field.after)}
                              />
                            ) : (
                              formatValue(item.entity.data?.[key])
                            )}
                          </Field>
                        )
                      })}
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
