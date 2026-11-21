import type {Meta, StoryObj} from '@storybook/react-vite'
import {ProjectionView} from '@githubnext/projections-host/ui'
import {withDefaultFrame} from '../../src/default-frame.js'
import {themeOf} from '../../src/theme.js'
import {mobile, preparedLoader, renderDetails, sampleAnnotations, scenarioArgTypes, scenarioFixture} from '../../src/stories.js'
import type {Loaded, ScenarioArgs} from '../../src/stories.js'

interface ViewArgs extends ScenarioArgs {
  /** Offer only the host's table and text views, as when no renderer bundle is available. */
  withoutRenderer?: boolean
  /** Show informational notices and extraction diagnostics. */
  notices?: boolean
  /** Animated playback loops back and forth (the default) or stops at the endpoint. */
  loop?: boolean
  /** Where playback holds at step ends: still stretches of the slider (the default) or pauses of the slider. */
  holds?: 'timeline' | 'pause'
  /** Playback floats over the stage in its utility area instead of taking a toolbar row. */
  utilityArea?: boolean
  /** A host's own caption in the stage's utility area (`utility`). */
  caption?: boolean
  /** The same caption at the stage's foot (`foot`), over the legend. */
  footCaption?: boolean
}

/** A host's caption, as a page might name what the stage shows. */
const caption = (
  <div style={{padding: '6px 12px', lineHeight: '20px'}}>
    <strong style={{display: 'block', fontSize: 14}}>The worker moves to its own queue</strong>
    <span style={{display: 'block', fontSize: 12, opacity: 0.75}}>Platform architecture · #128</span>
  </div>
)

/**
 * `ProjectionView`, the default UI's view of one subject (a comparison or one extraction): renderer, table and
 * text views, playback, comparison modes, find, highlighting and the detail card. The subject is the scenario, compared in the browser.
 */
const meta = {
  title: 'Default UI/Projection view',
  decorators: [withDefaultFrame],
  loaders: [preparedLoader],
  args: {scenario: 'graph/platform-worker'},
  argTypes: {
    ...scenarioArgTypes(),
    withoutRenderer: {control: 'boolean'},
    notices: {control: 'boolean'},
    loop: {control: 'boolean'},
    holds: {control: 'inline-radio', options: ['timeline', 'pause']},
    utilityArea: {control: 'boolean'},
    caption: {control: 'boolean'},
    footCaption: {control: 'boolean'},
  },
  render: function Render(args, {globals, loaded}) {
    const {runtime, prepared} = loaded as Required<Loaded>
    const item = scenarioFixture(args)
    const {subject, projection, resolution, presentation} = prepared
    return (
      <ProjectionView
        key={`${item.key}-${args.renderer ?? ''}`}
        subject={subject}
        projection={projection}
        renderer={args.withoutRenderer ? undefined : resolution.renderer}
        renderers={args.withoutRenderer ? [] : runtime.renderers}
        rendererNotice={
          args.withoutRenderer ? 'No renderer bundle is available here, so the host offers its table and text views.' : resolution.notice
        }
        presentation={args.changesOnly === undefined ? presentation : {...presentation, changesOnly: args.changesOnly}}
        colorMode={themeOf(globals)}
        beforeLabel="Before"
        afterLabel="After"
        {...(args.notices
          ? {
              notices: ['The compared revisions define this projection differently: the after revision adds an input.'],
              diagnostics: [
                {
                  severity: 'warning',
                  code: 'partial-input',
                  path: 'src/worker.ts',
                  message: 'One source file could not be parsed; its items are missing.',
                },
              ],
            }
          : {})}
        {...(args.loop !== undefined ? {initialLoop: args.loop} : {})}
        {...(args.holds ? {initialHolds: args.holds} : {})}
        {...(args.initialMode ? {initialMode: args.initialMode} : {})}
        {...(args.initialView ? {initialView: args.initialView} : {})}
        {...(args.annotations ? {annotations: sampleAnnotations(item)} : {})}
        {...(args.details ? {renderDetails} : {})}
        {...(args.utilityArea ? {utilityArea: true} : {})}
        {...(args.caption ? {utility: caption} : {})}
        {...(args.footCaption ? {foot: caption} : {})}
      />
    )
  },
} satisfies Meta<ViewArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Comparison: Story = {}
/**
 * The summary bar along the bottom of the view, on the dependency graph's express 5 upgrade: a figure per kind in the
 * renderer's words (workspaces, packages, dependencies) with the changes of each; every figure filters to its items.
 */
export const SummaryBar: Story = {name: 'Summary bar, comparison', args: {scenario: 'graph/npm-express-5', initialMode: 'diff'}}
/** The summary bar for one revision: the totals per kind, with no changes. */
export const SummaryBarExtraction: Story = {name: 'Summary bar, one revision', args: {scenario: 'graph/npm-workspace'}}
export const Extraction: Story = {name: 'One extraction', args: {scenario: 'graph/architecture-snapshot'}}
/**
 * Test results whose durations are volatile: two tests varied within tolerance (unchanged, counted in the toolbar's
 * "2 varied within tolerance" toggle, never highlighted), one slowed beyond it (modified, with the volatile marker).
 */
export const VolatileVariation: Story = {
  name: 'Volatile variation',
  args: {scenario: 'graph/test-timings', initialMode: 'diff', changesOnly: false},
}
/**
 * Class summaries a model wrote, declared as generated values: Cart reworded from the same inputs (unchanged, counted
 * in the "1 regenerated" toggle), Orders' summary regenerated because the class changed, and Invoices' only because the
 * model changed (gathered last by the model-upgrades comparator). Select a class for its Generated value.
 */
export const GeneratedValues: Story = {
  name: 'Generated values',
  args: {scenario: 'graph/class-summaries', initialMode: 'diff', changesOnly: false},
}
export const WithoutRenderer: Story = {name: 'Without a renderer', args: {withoutRenderer: true}}
/** A comparison without changes: the Changes scope says so and offers every item. */
export const NoChanges: Story = {name: 'No changes', args: {unchanged: true}}
export const NoticesAndDiagnostics: Story = {name: 'Notices and diagnostics', args: {notices: true}}
export const Annotated: Story = {
  name: 'Annotations and the detail card slot',
  args: {annotations: true, details: true, initialView: 'text'},
}
export const Looping: Story = {name: 'Playback loops', args: {loop: true}}
export const NotLooping: Story = {name: 'Playback stops at the end', args: {loop: false}}
export const HoldsOnTimeline: Story = {name: 'Holds on the slider', args: {holds: 'timeline'}}
export const HoldsPause: Story = {name: 'Holds pause playback', args: {holds: 'pause'}}
export const Mobile: Story = {globals: mobile, args: {initialView: 'table'}}
export const HostUtility: Story = {name: 'Host content in the utility area', args: {caption: true, initialMode: 'diff'}}
export const HostUtilityWithPlayback: Story = {
  name: 'Host content with floating playback',
  args: {caption: true, utilityArea: true, initialMode: 'animated'},
}
export const HostFoot: Story = {name: 'Host content at the stage’s foot', args: {footCaption: true, initialMode: 'diff'}}
