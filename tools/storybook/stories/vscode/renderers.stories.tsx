import type {Meta, StoryObj} from '@storybook/react-vite'
import {withVscodeFrame} from '../../src/vscode-frame.js'
import {renderVscodeExplorer, type VscodeArgs} from '../../src/vscode-render.js'
import {rendererStory, runtimeLoader, scenarioArgTypes} from '../../src/stories.js'

/** Every renderer bundle in the VS Code UI, on its own scenarios (choose another with the `scenario` control). */
const meta = {
  title: 'VS Code UI/Renderers',
  decorators: [withVscodeFrame],
  loaders: [runtimeLoader],
  argTypes: scenarioArgTypes(),
  render: renderVscodeExplorer,
} satisfies Meta<VscodeArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Api: Story = {name: 'API', ...rendererStory('api')}
export const Architecture: Story = {name: 'Architecture', ...rendererStory('graph', 'architecture')}
export const CodeStatistics: Story = {name: 'Code statistics', ...rendererStory('code-statistics')}
export const Dag: Story = {name: 'DAG', ...rendererStory('graph', 'dag')}
export const Database: Story = {name: 'Database', ...rendererStory('database')}
export const Dependencies: Story = {name: 'Dependencies', ...rendererStory('graph', 'dependencies')}
export const DependencyInjection: Story = {name: 'Dependency injection', ...rendererStory('dependency-injection')}
export const FilePacking: Story = {name: 'File packing', ...rendererStory('file-packing')}
export const Graph: Story = {name: 'Graph', ...rendererStory('graph')}
export const Infrastructure: Story = {name: 'Infrastructure', ...rendererStory('graph', 'infrastructure')}
export const Minimal: Story = {name: 'Minimal outline (example)', ...rendererStory('minimal')}
export const RuntimePolicy: Story = {name: 'Runtime security policies', ...rendererStory('runtime-policy')}
export const TextDiff: Story = {name: 'Text diff', ...rendererStory('text-diff')}
