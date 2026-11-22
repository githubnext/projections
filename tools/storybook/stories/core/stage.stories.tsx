import type {Meta, StoryObj} from '@storybook/react-vite'
import {comparisonModes, ProjectionStage, useProjection, type ComparisonMode} from '@githubnext/projections-host'
import type {PreparedFixture} from '../../src/fixtures.js'
import {preparedLoader, scenarioArgTypes, type Loaded, type ScenarioArgs} from '../../src/stories.js'
import {themeOf} from '../../src/theme.js'

/**
 * The headless host core alone (`@githubnext/projections-host`): `useProjection` and `ProjectionStage` with no UI
 * package, as a host with its own design system starts. The controls are plain elements, to show what the core
 * provides and what a UI adds.
 */
const meta = {
  title: 'Core/Projection stage',
  loaders: [preparedLoader],
  args: {scenario: 'graph/service-platform', initialMode: 'side-by-side'},
  argTypes: scenarioArgTypes(),
  render: (args, {globals, loaded}) => (
    <CustomHost
      prepared={(loaded as Required<Loaded>).prepared}
      colorMode={themeOf(globals)}
      {...(args.initialMode ? {mode: args.initialMode} : {})}
    />
  ),
} satisfies Meta<ScenarioArgs>

export default meta
type Story = StoryObj<typeof meta>

function CustomHost({prepared, colorMode, mode}: {prepared: PreparedFixture; colorMode: 'light' | 'dark'; mode?: ComparisonMode}) {
  const {subject, projection, resolution, presentation} = prepared
  const p = useProjection({
    subject,
    projection,
    renderers: resolution.renderer ? [resolution.renderer] : [],
    presentation,
    colorMode,
    ...(mode ? {initialMode: mode} : {}),
  })
  const dark = colorMode === 'dark'
  return (
    <main
      style={{
        minHeight: '100vh',
        boxSizing: 'border-box',
        padding: 16,
        fontFamily: 'system-ui, sans-serif',
        colorScheme: colorMode,
        background: dark ? '#0d1117' : '#fff',
        color: dark ? '#e6edf3' : '#1f2328',
      }}
    >
      <h1 style={{fontSize: 18, margin: '0 0 12px'}}>{projection.title}</h1>
      <p style={{display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', margin: '0 0 12px', fontSize: 14}}>
        <label>
          Find <input aria-label="Find" value={p.search} onChange={event => p.setSearch(event.target.value)} />
        </label>
        {p.comparing && (
          <label>
            Mode{' '}
            <select aria-label="Mode" value={p.mode} onChange={event => p.setMode(event.target.value as ComparisonMode)}>
              {comparisonModes
                .filter(option => p.availableModes.includes(option.value))
                .map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
            </select>
          </label>
        )}
        {p.comparing && p.mode === 'animated' && (
          <label>
            Transition{' '}
            <input
              type="range"
              aria-label="Transition"
              min={0}
              max={1}
              step={0.01}
              value={p.progress}
              onChange={event => p.seek(event.target.valueAsNumber)}
            />
          </label>
        )}
        <button type="button" onClick={() => p.select(null)}>
          Clear selection
        </button>
        <span>
          Selected: <output aria-label="Custom selection">{p.selectedRow?.label ?? 'nothing'}</output>
        </span>
        <span>
          Status: <output aria-label="Custom status">{p.rendererStatus}</output>
        </span>
      </p>
      <ProjectionStage projection={p} labels={{before: 'Before', after: 'After'}} />
    </main>
  )
}

export const SideBySide: Story = {name: 'Side by side'}
export const Animated: Story = {args: {initialMode: 'animated'}}
export const Swipe: Story = {args: {initialMode: 'swipe'}}
/** A renderer that declares only `diff` (text diff): one static frame, no transition. */
export const Diff: Story = {args: {scenario: 'text-diff/cli-output-release', initialMode: 'diff'}}
export const OneExtraction: Story = {name: 'One extraction', args: {scenario: 'graph/snapshot'}}
