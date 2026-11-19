import type {Meta, StoryObj} from '@storybook/react-vite'
import {withDefaultFrame} from '../../src/default-frame.js'
import {renderExplorer} from '../../src/default-render.js'
import {mobile, rendererStory, runtimeLoader, scenarioArgTypes} from '../../src/stories.js'
import type {ScenarioArgs} from '../../src/stories.js'

/** Every renderer bundle in the default UI, on its own scenarios (choose another with the `scenario` control). */
const meta = {
  title: 'Default UI/Renderers',
  decorators: [withDefaultFrame],
  loaders: [runtimeLoader],
  argTypes: scenarioArgTypes(),
  render: renderExplorer,
} satisfies Meta<ScenarioArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Api: Story = {name: 'API', ...rendererStory('api')}
export const Architecture: Story = {name: 'Architecture', ...rendererStory('graph', 'architecture')}
export const CodeStatistics: Story = {name: 'Code statistics', ...rendererStory('code-statistics')}
/** The table chart: sortable columns, a frozen first column and the changes as value pills. */
export const CodeStatisticsTable: Story = {
  name: 'Code statistics, table',
  ...rendererStory('code-statistics'),
  args: {scenario: 'code-statistics/gateway-table'},
}
export const CodeStatisticsTableAnimated: Story = {
  name: 'Code statistics, table, animated',
  ...rendererStory('code-statistics'),
  args: {scenario: 'code-statistics/gateway-table', initialMode: 'animated'},
}
export const CodeStatisticsTableMobile: Story = {
  name: 'Code statistics, table, mobile',
  ...rendererStory('code-statistics'),
  args: {scenario: 'code-statistics/gateway-table'},
  globals: mobile,
}
export const Dag: Story = {name: 'DAG', ...rendererStory('graph', 'dag')}
export const Database: Story = {name: 'Database', ...rendererStory('database')}
export const Dependencies: Story = {name: 'Dependencies', ...rendererStory('graph', 'dependencies')}
export const DependencyInjection: Story = {name: 'Dependency injection', ...rendererStory('dependency-injection')}
export const FilePacking: Story = {name: 'File packing', ...rendererStory('file-packing')}
export const Gallery: Story = {name: 'Gallery', ...rendererStory('gallery')}
export const Graph: Story = {name: 'Graph', ...rendererStory('graph')}
export const Infrastructure: Story = {name: 'Infrastructure', ...rendererStory('graph', 'infrastructure')}
export const Minimal: Story = {name: 'Minimal outline (example)', ...rendererStory('minimal')}
export const RuntimePolicy: Story = {name: 'Runtime security policies', ...rendererStory('runtime-policy')}
export const TextDiff: Story = {name: 'Text diff', ...rendererStory('text-diff')}

/** Text renderers open in their static diff. */
export const TextDiffOneColumn: Story = {
  name: 'Text diff, one column',
  ...rendererStory('text-diff'),
  args: {scenario: 'text-diff/release-notes-unified'},
}
export const TextDiffMobile: Story = {name: 'Text diff, mobile', ...rendererStory('text-diff'), globals: mobile}
