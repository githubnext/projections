import type {Decorator, Meta, StoryObj} from '@storybook/react-vite'
import {withDefaultFrame} from '../../src/default-frame.js'
import {renderExplorer} from '../../src/default-render.js'
import {mobile, runtimeLoader, scenarioArgTypes, type ScenarioArgs} from '../../src/stories.js'

/**
 * `ComparisonExplorer`, the default UI's pair picker and view: choose two saved extractions of a renderer
 * scenario, compare them in the browser with the scenario's comparator and present them with its renderer bundle.
 */
const meta = {
  title: 'Default UI/Comparison explorer',
  decorators: [withDefaultFrame],
  loaders: [runtimeLoader],
  args: {scenario: 'graph/service-platform'},
  argTypes: scenarioArgTypes(),
  render: renderExplorer,
} satisfies Meta<ScenarioArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Animated: Story = {args: {initialMode: 'animated'}}
export const SideBySide: Story = {name: 'Side by side (default)', args: {initialMode: 'side-by-side'}}
export const Swipe: Story = {args: {initialMode: 'swipe'}}
export const TableView: Story = {name: 'Table view', args: {initialView: 'table'}}
export const TextView: Story = {name: 'Text view', args: {initialView: 'text'}}
export const SingleExtraction: Story = {name: 'Single extraction', args: {scenario: 'graph/snapshot'}}
export const CustomComparator: Story = {name: 'Custom comparator (Wasm)', args: {scenario: 'graph/service-platform-priority'}}
export const RendererControls: Story = {name: 'Renderer controls', args: {scenario: 'code-statistics/languages'}}
export const AnnotationsAndDetails: Story = {
  name: 'Annotations and the detail card slot',
  args: {annotations: true, details: true, initialView: 'table'},
}
export const UnavailableRenderer: Story = {name: 'Unavailable renderer', args: {renderer: 'unavailable'}}
export const Mobile: Story = {name: 'Mobile, animated', args: {initialMode: 'animated'}, globals: mobile}
export const MobileSideBySide: Story = {name: 'Mobile, side by side', args: {initialMode: 'side-by-side'}, globals: mobile}

/**
 * The explorer at a fixed width, embedded as a page would: the toolbar plans its layout from its own width, not the
 * viewport's. Wide, one row holds everything; narrower, the pickers, mode and playback extras collapse in turn,
 * then playback takes a planned second row with a full-width slider.
 */
const atWidth =
  (width: number): Decorator =>
  Story => (
    <div className="sb-width" style={{width, height: 640}}>
      <Story />
    </div>
  )
export const Width1440: Story = {name: 'At 1440px', args: {initialMode: 'animated'}, decorators: [atWidth(1440)]}
export const Width1024: Story = {name: 'At 1024px', args: {initialMode: 'animated'}, decorators: [atWidth(1024)]}
export const Width768: Story = {name: 'At 768px', args: {initialMode: 'animated'}, decorators: [atWidth(768)]}
export const Width600: Story = {name: 'At 600px', args: {initialMode: 'animated'}, decorators: [atWidth(600)]}
export const Width480: Story = {name: 'At 480px', args: {initialMode: 'animated'}, decorators: [atWidth(480)]}
export const Width390: Story = {name: 'At 390px', args: {initialMode: 'animated'}, decorators: [atWidth(390)]}
export const Width768SideBySide: Story = {name: 'At 768px, side by side', args: {initialMode: 'side-by-side'}, decorators: [atWidth(768)]}
export const Width390SideBySide: Story = {name: 'At 390px, side by side', args: {initialMode: 'side-by-side'}, decorators: [atWidth(390)]}
