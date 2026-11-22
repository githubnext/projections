// The gallery: each scenarios document as a group, each scenario as a card drawn by its own renderer, nested.
import {useMemo, useState} from 'react'
import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {classifyChange, createStagedTimeline, current, type ComparisonModel} from '@githubnext/projections-renderer-kit'
import {
  CardGrid,
  ContentView,
  EmptyDomain,
  EntityCard,
  Group,
  Identifier,
  Inline,
  Stack,
  Text,
  useFrameSizing,
  type RendererProps,
  type ViewOptions,
} from '@githubnext/projections-renderer-kit/react'
import {documentOrder, scenarioOf, subjectWords, type Scenario} from './model.js'
import {eagerScenarios, NestedStage} from './stage.js'
import type {accepts} from './accepts.js'

type Row = EntityChange<Entity>
type Props = RendererProps<typeof accepts>

export const options: ViewOptions = {
  nouns: {
    scenarios: {singular: 'scenario set', plural: 'scenario sets'},
    scenario: {singular: 'scenario', plural: 'scenarios'},
    contains: false,
  },
}

/** A document's group, its scenarios in the document's order (a removed one after the one it followed), in runs by group. */
export interface Section {
  document: Row | undefined
  runs: {group: string | undefined; rows: Row[]}[]
}

/** The scenario rows of each document, in document order; scenarios no document lists come last, on their own. */
export function sections(model: ComparisonModel): Section[] {
  const kind = (row: Row) => (row.after ?? row.before)!.kind
  const scenarios = new Map(model.entities.filter(row => kind(row) === 'scenario').map(row => [row.id, row]))
  const placed = new Set<string>()
  const result: Section[] = []
  for (const document of model.entities.filter(row => kind(row) === 'scenarios')) {
    const ids = (side: 'before' | 'after') => {
      const entity = document[side]
      const rows = model.entityRow[side]
      return entity ? documentOrder(entity).flatMap(id => rows.get(id) ?? []) : []
    }
    const order = ids('after')
    let previous: string | undefined
    for (const id of ids('before')) {
      if (!order.includes(id)) order.splice(previous === undefined ? 0 : order.indexOf(previous) + 1, 0, id)
      previous = id
    }
    const rows = [...new Set(order)].flatMap(id => scenarios.get(id) ?? [])
    for (const row of rows) placed.add(row.id)
    result.push({document, runs: runs(rows, (document.after ?? document.before)!.label)})
  }
  const rest = [...scenarios.values()].filter(row => !placed.has(row.id))
  if (rest.length) result.push({document: undefined, runs: runs(rest, undefined)})
  return result
}

/** Consecutive scenarios of one group; a group named like its document needs no heading of its own. */
function runs(rows: Row[], title: string | undefined) {
  const result: Section['runs'] = []
  for (const row of rows) {
    const group = scenarioOf((row.after ?? row.before)!).group
    const shown = group === title ? undefined : group
    const last = result.at(-1)
    if (last && last.group === shown) last.rows.push(row)
    else result.push({group: shown, rows: [row]})
  }
  return result
}

/** In a content-sized frame, how many scenario sets are drawn, and how many scenarios of each. */
export const contentSets = 2
export const contentScenarios = 12

/**
 * The scenarios a content-sized frame (an image, the renderer checks) of a large gallery draws: those of its first
 * `contentSets` scenario sets as laid out, both revisions' scenarios merged, the first `contentScenarios` of each.
 * Chosen by identity and order alone, never layout, timing or progress, so a frame always draws the same ones; the rest
 * are named, not drawn.
 */
export function contentDrawn(laidOut: readonly Section[]): Set<string> {
  return new Set(
    laidOut
      .filter(section => section.document)
      .slice(0, contentSets)
      .flatMap(section => section.runs.flatMap(run => run.rows).slice(0, contentScenarios))
      .map(row => row.id),
  )
}

/** The scenario's own ID: the last part of its entity ID (`scenario:<document>:<id>`). */
const scenarioKey = (id: string) => decodeURIComponent(id.slice(id.lastIndexOf(':') + 1))

/**
 * Every renderer scenario, drawn by its own renderer. One revision shows each scenario as it is; a comparison shows
 * which scenarios a change added, removed or redrew, each drawn as the revision it is in at that moment, and in diff
 * mode a modified scenario offers both of its revisions.
 */
export function GalleryView(props: Props) {
  const {model, schedule, progress, diff, selectedId, onSelect, comparing} = props
  const timeline = useMemo(() => createStagedTimeline(model, schedule), [model, schedule])
  const shown = useMemo(() => sections(model), [model])
  // A content-sized frame is as tall as the gallery (an image, the checks): it draws a bounded, fixed set of scenarios.
  const content = useFrameSizing() === 'content'
  const total = shown.reduce((count, section) => count + section.runs.reduce((rows, run) => rows + run.rows.length, 0), 0)
  const drawable = useMemo(() => (content && total > eagerScenarios ? contentDrawn(shown) : undefined), [content, total, shown])
  const eager = content || total <= eagerScenarios
  const [playing, setPlaying] = useState<string | null>(null)
  const [sides, setSides] = useState<Record<string, 'before' | 'after'>>({})
  if (!shown.length) {
    return <EmptyDomain>No scenarios. Add a scenarios.json beside a renderer, or widen the extractor's include.</EmptyDomain>
  }

  const select = (id: string) => {
    if (selectedId !== id) onSelect(id)
  }
  const card = (row: Row) => {
    // In the diff, a modified scenario shows the revision chosen for it, its after revision unless the person asks.
    const side = diff ? (row.after ? (row.before && sides[row.id] === 'before' ? 'before' : 'after') : 'before') : undefined
    // An unchanged scenario keeps one entity throughout, so its frame never reloads as the comparison plays.
    const entity = side
      ? row[side]!
      : row.status === 'unchanged'
        ? (row.after ?? row.before)!
        : current(row, timeline.local(row.id, progress))
    const scenario = scenarioOf(entity)
    const changed = comparing && row.status !== 'unchanged'
    return (
      <EntityCard
        key={row.id}
        id={row.id}
        label={entity.label}
        identifier={scenarioKey(row.id)}
        selected={selectedId === row.id}
        onSelect={onSelect}
        {...(comparing ? {change: row, emphasis: props.emphasis(row)} : {})}
        {...(diff && changed ? {mark: classifyChange(row)} : {})}
        presence={diff ? 1 : timeline.presence(row.id, progress)}
        holdsChanges={nestedComparison(scenario)}
      >
        <div
          className="gl-card-body"
          onPointerEnter={() => setPlaying(row.id)}
          onPointerLeave={() => setPlaying(playing => (playing === row.id ? null : playing))}
          onFocus={() => setPlaying(row.id)}
          onBlur={() => setPlaying(playing => (playing === row.id ? null : playing))}
        >
          <NestedStage
            key={`${row.id}:${side ?? ''}`}
            entity={entity}
            environment={props.environment}
            requestDocument={props.requestDocument}
            playing={playing === row.id}
            eager={eager}
            drawable={!drawable || drawable.has(row.id)}
            onSelect={() => select(row.id)}
          />
          <Details scenario={scenario} />
          {diff && row.status === 'modified' && row.before && row.after && (
            <RevisionChoice
              chosen={side ?? 'after'}
              onChoose={choice => setSides(previous => ({...previous, [row.id]: choice}))}
              title={entity.label}
            />
          )}
        </div>
      </EntityCard>
    )
  }
  return (
    <ContentView>
      <div className="gallery-view">
        {shown.map(({document, runs}) => {
          const entity = document ? (document.after ?? document.before)! : undefined
          const renderer = typeof entity?.data?.renderer === 'string' ? entity.data.renderer : undefined
          return (
            <Group
              key={document?.id ?? 'other'}
              title={entity?.label ?? 'Other scenarios'}
              {...(renderer ? {meta: <Identifier>{renderer}</Identifier>} : {})}
              {...(document
                ? {
                    id: document.id,
                    selected: selectedId === document.id,
                    onSelect,
                    ...(comparing ? {change: document, emphasis: props.emphasis(document)} : {}),
                    ...(diff && comparing && document.status !== 'unchanged' ? {mark: classifyChange(document)} : {}),
                  }
                : {})}
              holdsChanges={runs.some(run => run.rows.some(row => nestedComparison(scenarioOf((row.after ?? row.before)!))))}
            >
              {runs.map(({group, rows}, index) => (
                <section key={`${group ?? ''}:${index}`} className="gl-run" aria-label={group ?? entity?.label ?? 'Scenarios'}>
                  {group && <h3 className="gl-run-title">{group}</h3>}
                  <CardGrid label={group ?? entity?.label ?? 'Scenarios'}>{rows.map(card)}</CardGrid>
                </section>
              ))}
            </Group>
          )
        })}
      </div>
    </ContentView>
  )
}

/** What the scenario is: its description, then its renderer, subject and comparator. */
function Details({scenario}: {scenario: Scenario}) {
  return (
    <Stack gap={1}>
      {scenario.description && (
        <p className="gl-description" title={scenario.description}>
          {scenario.description}
        </p>
      )}
      <Inline gap={2}>
        <Identifier>{scenario.renderer}</Identifier>
        <Text size="xs" tone="muted">
          {subjectWords(scenario)}
        </Text>
        {scenario.comparator && scenario.comparator !== 'default' && (
          <Identifier className="gl-comparator" truncate title={scenario.comparator}>
            {scenario.comparator.slice(scenario.comparator.lastIndexOf('/') + 1)}
          </Identifier>
        )}
      </Inline>
    </Stack>
  )
}

/** In the diff, which revision of a modified scenario its card draws. */
function RevisionChoice({
  chosen,
  onChoose,
  title,
}: {
  chosen: 'before' | 'after'
  onChoose: (side: 'before' | 'after') => void
  title: string
}) {
  return (
    <div className="gl-revisions" role="group" aria-label={`Revision of ${title}`}>
      {(['before', 'after'] as const).map(side => (
        <button key={side} type="button" className="gl-revision" aria-pressed={chosen === side} onClick={() => onChoose(side)}>
          {side === 'before' ? 'Before' : 'After'}
        </button>
      ))}
    </div>
  )
}

/** Whether a scenario's nested frame draws a comparison, in its own change colors: its card and group stay neutral. */
const nestedComparison = (scenario: Scenario) => scenario.subject?.mode === 'comparison'
