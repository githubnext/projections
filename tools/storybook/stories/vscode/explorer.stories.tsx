import type {Decorator, Meta, StoryObj} from '@storybook/react-vite'
import {withVscodeFrame} from '../../src/vscode-frame.js'
import {withFill} from './fill.js'
import {renderVscodeExplorer} from '../../src/vscode-render.js'
import type {VscodeArgs} from '../../src/vscode-render.js'
import {mobile, runtimeLoader, scenarioArgTypes} from '../../src/stories.js'

/**
 * `VscodeComparisonExplorer`, the VS Code UI's pair picker and view: the headless host core drawn with VSCode Elements
 * and codicons, themed from the VS Code theme chosen in the toolbar (captured from VS Code), on a renderer scenario.
 */
/** With `width`, the explorer in a container that wide, as when embedded (for example in an editor group), whatever the viewport. */
const withWidth: Decorator = (Story, {args}) =>
  typeof args.width === 'number' ? (
    <div className="sb-vscode-width" style={{width: args.width, height: '100%'}} data-width={args.width}>
      <Story />
    </div>
  ) : (
    <Story />
  )

const meta = {
  title: 'VS Code UI/Comparison explorer',
  decorators: [withWidth, withFill, withVscodeFrame],
  loaders: [runtimeLoader],
  args: {scenario: 'graph/service-platform'},
  argTypes: {...scenarioArgTypes(), features: {control: 'object'}, width: {control: 'number'}},
  render: renderVscodeExplorer,
} satisfies Meta<VscodeArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Animated: Story = {args: {initialMode: 'animated'}}
export const SideBySide: Story = {name: 'Side by side (default)', args: {initialMode: 'side-by-side'}}
export const Swipe: Story = {args: {initialMode: 'swipe'}}
export const Diff: Story = {args: {scenario: 'text-diff/cli-output-release', initialMode: 'diff'}}
export const TableView: Story = {name: 'Table view', args: {initialView: 'table'}}
export const TextView: Story = {name: 'Text view', args: {initialView: 'text'}}
export const SingleExtraction: Story = {name: 'Single extraction', args: {scenario: 'graph/snapshot'}}
export const RendererControls: Story = {name: 'Renderer controls', args: {scenario: 'code-statistics/languages'}}
export const AnnotationsAndDetails: Story = {
  name: 'Annotations and the detail card slot',
  args: {annotations: true, details: true, initialView: 'table'},
}
export const UnavailableRenderer: Story = {name: 'Unavailable renderer', args: {renderer: 'unavailable'}}
export const ReducedFeatures: Story = {
  name: 'Reduced features',
  args: {
    features: {playback: false, speed: false, highlighting: false, modes: ['side-by-side', 'swipe'], text: false},
    initialMode: 'side-by-side',
  },
}
export const Mobile: Story = {name: 'Mobile, animated', args: {initialMode: 'animated'}, globals: mobile}

export const Width1024: Story = {name: 'At 1024px', args: {initialMode: 'animated', width: 1024}}
export const Width600: Story = {name: 'At 600px', args: {initialMode: 'animated', width: 600}}
export const Width390: Story = {name: 'At 390px', args: {initialMode: 'animated', width: 390}}
