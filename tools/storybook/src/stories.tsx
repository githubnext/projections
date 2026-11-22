// Shared story arguments, loaders and consumer content for both UIs' stories.
import type {ReactNode} from 'react'
import type {Extraction} from '@githubnext/projections-schemas'
import {
  encodeTarget,
  propertyPath,
  useProjectionAnchor,
  type ComparisonMode,
  type ProjectionController,
  type ProjectionSelection,
  type TargetAnnotation,
} from '@githubnext/projections-host'
import {fixture, fixtures, fixturesOf, prepareFixture, type Fixture, type PreparedFixture} from './fixtures.js'
import {loadRuntime, type Runtime} from './runtime.js'

/** A view a story opens on: the renderer's, or the host's built-in table or text view. */
export type ViewKind = 'renderer' | 'table' | 'text'

/** Arguments every explorer and view story takes. */
export interface ScenarioArgs {
  /** A scenario key, `<renderer package>/<scenario id>`. */
  scenario: string
  /** Present the scenario with another renderer, or one that doesn't exist (`unavailable`). Default: the scenario's own. */
  renderer?: string
  initialMode?: ComparisonMode
  initialView?: ViewKind
  /** The scope: Changes (the default) or, with `false`, every item. */
  changesOnly?: boolean
  /** Mark a few presented items as an embedder would, for example with comment counts. */
  annotations?: boolean
  /** Render a consumer's content in the detail card (`renderDetails`). */
  details?: boolean
  /** Compare the scenario's After with itself: a comparison without changes. */
  unchanged?: boolean
}

/** Storybook `argTypes` for `ScenarioArgs`, offering `options` (default: every scenario) in the scenario select. */
export const scenarioArgTypes = (options: readonly Fixture[] = fixtures) =>
  ({
    scenario: {
      control: 'select',
      options: options.map(item => item.key),
      description: 'Renderer scenario (`<package>/<scenario id>` from scenarios.json)',
    },
    renderer: {control: 'select', options: [undefined, 'minimal', 'unavailable'], description: "Override the scenario's renderer"},
    initialMode: {
      control: 'inline-radio',
      options: ['animated', 'side-by-side', 'swipe', 'diff'],
      description:
        "Initial comparison mode; a renderer that doesn't support it opens in its default (diff when supported, else side by side)",
    },
    initialView: {control: 'inline-radio', options: ['renderer', 'table', 'text']},
    annotations: {control: 'boolean'},
    details: {control: 'boolean'},
  }) as const

/** The scenario, with its renderer overridden as the arguments ask. */
export function scenarioFixture(args: {scenario?: string | undefined; renderer?: string | undefined}): Fixture {
  if (!args.scenario) throw new Error('The story names no scenario')
  const item = fixture(args.scenario)
  if (!args.renderer) return item
  return {...item, renderer: args.renderer === 'unavailable' ? 'unavailable-renderer' : args.renderer}
}

/** A Storybook loader for stories that need only the shared runtime, not a scenario. */
export const runtimeLoader = async (): Promise<{runtime: Runtime}> => ({runtime: await loadRuntime()})

/** Loads the runtime and the scenario's computed view subject. */
export const preparedLoader = async ({args}: {args: Partial<ScenarioArgs>}): Promise<{runtime: Runtime; prepared: PreparedFixture}> => {
  const runtime = await loadRuntime()
  return {runtime, prepared: await prepareFixture(scenarioFixture(args), runtime, args.unchanged)}
}

/** Loaded data, as Storybook passes it to `render`. */
export interface Loaded {
  runtime: Runtime
  prepared?: PreparedFixture
}

/** One story per renderer package (name it in the story, where Storybook's indexer reads it): its first scenario, with the package's other scenarios offered. */
/** A renderer package's scenarios, optionally only those for one definition renderer name (one bundle can present several). */
export function rendererStory(name: string, renderer?: string) {
  const options = fixturesOf(name).filter(item => renderer === undefined || item.renderer === renderer)
  return {args: {scenario: options[0]!.key}, argTypes: scenarioArgTypes(options)}
}

/** Markers an embedder (such as a comment system) might put on a scenario's items: on entities, a property and a relationship. */
export function sampleAnnotations(item: Fixture): TargetAnnotation[] {
  const extraction: Extraction = item.after ?? item.extraction!
  // A single extraction presents its items as the after side.
  const side = 'after' as const
  const [first, second] = extraction.entities
  const property = extraction.entities.find(entity => entity.data && Object.keys(entity.data).length > 0)
  const relationship = extraction.relationships[0]
  return [
    ...(first ? [{target: {kind: 'entity' as const, id: first.id, side}, count: 2, tone: 'attention' as const}] : []),
    ...(second ? [{target: {kind: 'entity' as const, id: second.id, side}, count: 1}] : []),
    ...(property
      ? [{target: {kind: 'entity' as const, id: property.id, side, path: propertyPath(Object.keys(property.data!)[0]!)}, count: 1}]
      : []),
    ...(relationship
      ? [{target: {kind: 'relationship' as const, id: relationship.id, side}, label: 'Needs review', tone: 'done' as const}]
      : []),
  ]
}

/** A consumer's details content: the selection's targets and where the renderer draws the selected item. */
export function DetailsSlot({selection, projection}: {selection: ProjectionSelection; projection: ProjectionController}): ReactNode {
  const anchor = useProjectionAnchor(projection)
  return (
    <div className="sb-slot">
      <p>
        <strong>Consumer slot</strong>
      </p>
      <p>
        Targets: <output aria-label="Slot targets">{selection.targets.map(encodeTarget).join(' ') || 'None'}</output>
      </p>
      <p>
        Anchor:{' '}
        <output aria-label="Selection anchor">
          {anchor
            ? `${anchor.side} ${Math.round(anchor.x)},${Math.round(anchor.y)} ${Math.round(anchor.width)}×${Math.round(anchor.height)}`
            : 'Not shown'}
        </output>
      </p>
    </div>
  )
}

/** `renderDetails` for the detail card when a story's `details` argument is on: the `DetailsSlot`. */
export const renderDetails = (selection: ProjectionSelection, projection: ProjectionController) => (
  <DetailsSlot selection={selection} projection={projection} />
)

/** The Storybook `globals.viewport` value for the phone viewport `.storybook/preview.tsx` declares. */
export const mobile = {viewport: {value: 'mobile', isRotated: false}}
