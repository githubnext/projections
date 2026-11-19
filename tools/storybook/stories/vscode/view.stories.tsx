import type {Meta, StoryObj} from '@storybook/react-vite'
import {StageNotice, VscodeProjectionView} from '@githubnext/projections-host-vscode'
import {withVscodeFrame} from '../../src/vscode-frame.js'
import {withFill} from './fill.js'
import type {VscodeArgs} from '../../src/vscode-render.js'
import {mobile, preparedLoader, renderDetails, sampleAnnotations, scenarioArgTypes, scenarioFixture} from '../../src/stories.js'
import type {Loaded} from '../../src/stories.js'

interface ViewArgs extends VscodeArgs {
  /** Offer only the host's table and text views, as when no renderer bundle is available. */
  withoutRenderer?: boolean
  /** Show informational notices and extraction diagnostics. */
  notices?: boolean
  /** Animated playback loops back and forth (the default) or stops at the endpoint. */
  loop?: boolean
  /** Where playback holds at step ends: still stretches of the slider (the default) or pauses of the slider. */
  holds?: 'timeline' | 'pause'
  /** Draw the toolbar (default); `false` leaves the controls to the host, for example VS Code `editor/title` actions. */
  toolbar?: boolean
  /** A VS Code tab's out-of-date notice, a pill over the stage: "Out of date · N files changed" with Refresh. */
  outOfDate?: number
  /** A VS Code tab's start slot: its pair picker, which draws nothing for an ordinary local result (packages/integrations/vscode/src/webview/tab-pair.ts). */
  tabStart?: boolean
  /** A VS Code tab's job: `idle` keeps the summary bar's slot for it empty; extracting or comparing spins in it. */
  running?: 'idle' | 'extracting' | 'comparing'
}

/**
 * `VscodeProjectionView`, the VS Code UI's view of one subject (a comparison or one extraction). The subject is the
 * scenario, compared in the browser.
 */
const meta = {
  title: 'VS Code UI/Projection view',
  decorators: [withFill, withVscodeFrame],
  loaders: [preparedLoader],
  args: {scenario: 'graph/platform-worker'},
  argTypes: {
    ...scenarioArgTypes(),
    withoutRenderer: {control: 'boolean'},
    notices: {control: 'boolean'},
    features: {control: 'object'},
    holds: {control: 'inline-radio', options: ['timeline', 'pause']},
    toolbar: {control: 'boolean'},
    outOfDate: {control: 'number', description: 'Files changed since the result, for the out-of-date notice (0: none)'},
    tabStart: {control: 'boolean', description: "A VS Code tab's start slot, empty for an ordinary local result"},
    running: {
      control: 'inline-radio',
      options: ['idle', 'extracting', 'comparing'],
      description: "A VS Code tab's job, in the summary bar's slot at its end",
    },
  },
  render: function Render(args, {loaded}) {
    const {runtime, prepared} = loaded as Required<Loaded>
    const item = scenarioFixture(args)
    const {subject, projection, resolution, presentation} = prepared
    return (
      <VscodeProjectionView
        key={`${item.key}-${args.renderer ?? ''}`}
        subject={subject}
        projection={projection}
        renderer={args.withoutRenderer ? undefined : resolution.renderer}
        renderers={args.withoutRenderer ? [] : runtime.renderers}
        rendererNotice={
          args.withoutRenderer ? 'No renderer bundle is available here, so the host offers its table and text views.' : resolution.notice
        }
        presentation={args.changesOnly === undefined ? presentation : {...presentation, changesOnly: args.changesOnly}}
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
        {...(args.features ? {features: args.features} : {})}
        {...(args.loop !== undefined ? {initialLoop: args.loop} : {})}
        {...(args.holds ? {initialHolds: args.holds} : {})}
        {...(args.toolbar === false ? {toolbar: false} : {})}
        {...(args.initialMode ? {initialMode: args.initialMode} : {})}
        {...(args.initialView ? {initialView: args.initialView} : {})}
        {...(args.annotations ? {annotations: sampleAnnotations(item)} : {})}
        {...(args.details ? {renderDetails} : {})}
        {...(args.tabStart ? {toolbarStart: () => <div className="tp-pair" data-form="full" />, centreModes: false} : {})}
        {...(args.running ? {running: args.running === 'idle' ? null : args.running} : {})}
        {...(args.outOfDate !== undefined
          ? {
              stageNotice: (
                <StageNotice
                  label="Out of date"
                  {...(args.outOfDate ? {detail: `${args.outOfDate} file${args.outOfDate === 1 ? '' : 's'} changed`} : {})}
                  title="The working tree changed since this result. Nothing refreshes on its own: Refresh extracts it again."
                  action={{label: 'Refresh', icon: 'refresh', onClick: () => {}}}
                />
              ),
            }
          : {})}
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
/**
 * A VS Code tab refreshing its result: a spinning `sync` codicon at the summary bar's end (after 300 ms), "Extracting…"
 * as its tooltip and in a polite live region. The slot is kept while nothing runs (`idle`), so the figures don't move.
 */
export const SummaryBarRunning: Story = {
  name: 'Summary bar, extracting',
  args: {scenario: 'graph/npm-express-5', initialMode: 'diff', running: 'extracting'},
}
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
/**
 * A VS Code tab's result out of date: "Out of date · 19 files changed" with Refresh, a pill floating over the stage's
 * top centre rather than a toolbar control. It takes no layout space, so the framing is the same as without it.
 */
export const OutOfDate: Story = {name: 'Out of date', args: {scenario: 'graph/npm-express-5', initialMode: 'diff', outOfDate: 19}}
/** Over a document-style renderer (API compatibility), the pill stays put while the document scrolls under it. */
export const OutOfDateDocument: Story = {
  name: 'Out of date, document',
  args: {scenario: 'api/dotnet-payments-compatibility', outOfDate: 19},
}
export const WithoutToolbar: Story = {
  name: 'Without the toolbar (controls as editor title actions)',
  args: {toolbar: false, initialMode: 'side-by-side'},
}
