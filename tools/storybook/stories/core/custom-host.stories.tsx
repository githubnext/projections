import {useRef, type CSSProperties, type KeyboardEvent, type ReactNode} from 'react'
import type {Meta, StoryObj} from '@storybook/react-vite'
import {
  ProjectionStage,
  comparisonModes,
  handlePlaybackShortcut,
  playButton,
  rovingIndex,
  scopeChoice,
  summaryCountText,
  summaryFilterable,
  summaryToggle,
  summaryToggleTitle,
  useProjection,
  useViewChoice,
  viewControls,
  viewLabel,
  type ComparisonMode,
  type ProjectionController,
  type ViewKind,
} from '@githubnext/projections-host'
import type {PreparedFixture} from '../../src/fixtures.js'
import {preparedLoader, scenarioArgTypes, type Loaded, type ScenarioArgs} from '../../src/stories.js'
import {themeOf} from '../../src/theme.js'

/**
 * A custom host UI on the headless core alone (`@githubnext/projections-host`), with plain elements for its own
 * design system and no UI package: the views and which controls show (`useViewChoice`, `viewControls`), the mode and
 * scope switches (`scopeChoice`, `rovingIndex`), playback (`playButton`, `handlePlaybackShortcut`), a table view of
 * `visibleRows`, and the summary's figures as filter toggles (`summaryToggle`). Everything here is presentation:
 * behaviour and defaults are the core's, so it matches the default and VS Code UIs.
 */
const meta = {
  title: 'Core/Custom host',
  loaders: [preparedLoader],
  args: {scenario: 'graph/service-platform', initialMode: 'animated'},
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

const row: CSSProperties = {display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', margin: '0 0 12px', fontSize: 14}

/** A radio group of plain buttons: arrows, Home and End move and choose (`rovingIndex`), the checked one takes Tab. */
function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly {value: T; label: string; title?: string}[]
  value: T
  onChange: (value: T) => void
}) {
  const group = useRef<HTMLDivElement>(null)
  const index = Math.max(
    0,
    options.findIndex(option => option.value === value),
  )
  const keys = (event: KeyboardEvent) => {
    const next = rovingIndex(event.key, index, options.length)
    if (next === undefined) return
    event.preventDefault()
    onChange(options[next]!.value)
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }
  return (
    <div ref={group} role="radiogroup" aria-label={label} style={{display: 'inline-flex', gap: 2}}>
      {options.map((option, position) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={position === index ? 0 : -1}
          title={option.title}
          onClick={() => onChange(option.value)}
          onKeyDown={keys}
          style={{fontWeight: option.value === value ? 700 : 400}}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Summary({projection: p}: {projection: ProjectionController}): ReactNode {
  if (!p.summary.length) return null
  return (
    <ul aria-label="Summary" style={{...row, listStyle: 'none', padding: 0}}>
      {p.summary.map(figure => {
        const text = summaryCountText(figure.count, figure.noun)
        // A fact that doesn't name its items has nothing to filter to: it is only a figure.
        if (!summaryFilterable(figure)) return <li key={figure.key}>{text}</li>
        const {pressed, next} = summaryToggle(p.summaryFilter, figure)
        return (
          <li key={figure.key}>
            <button
              type="button"
              aria-pressed={pressed}
              title={summaryToggleTitle(figure, pressed)}
              onClick={() => p.setSummaryFilter(next)}
            >
              {text}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

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
  const {views, view, setView} = useViewChoice(p)
  const controls = viewControls(p, {view})
  const scope = scopeChoice(p)
  const play = playButton(p, 'Before', 'After')
  const viewNames: Record<ViewKind, string> = {renderer: p.renderer?.title ?? 'Renderer', table: 'Table', text: 'Text'}
  const dark = colorMode === 'dark'
  return (
    <main
      className="custom-host"
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
      {/* The toolbar takes focus when its background is clicked, so Space there plays and pauses. */}
      <div
        role="toolbar"
        aria-label="Custom toolbar"
        tabIndex={-1}
        style={row}
        onKeyDown={event => {
          handlePlaybackShortcut(event, p)
        }}
      >
        <Choice label="View" options={views.map(kind => ({value: kind, label: viewNames[kind]}))} value={view} onChange={setView} />
        {controls.modeSwitch && (
          <Choice
            label="Comparison mode"
            options={comparisonModes.filter(option => controls.modes.includes(option.value))}
            value={p.mode}
            onChange={p.setMode}
          />
        )}
        {controls.scope &&
          (scope.nothingHidden ? (
            <span title={scope.noteTitle}>Changes · nothing hidden</span>
          ) : (
            <Choice
              label="Scope"
              options={scope.options.map(option => ({...option, value: option.scope}))}
              value={p.scope}
              onChange={p.setScope}
            />
          ))}
        {controls.playback && (
          <>
            <button type="button" aria-label={play.label} title={play.label} onClick={p.togglePlayback}>
              {play.action === 'pause' ? '❚❚' : play.direction === 1 ? '▶' : '◀'}
            </button>
            <input
              type="range"
              aria-label="Transition"
              min={0}
              max={1}
              step={0.001}
              value={p.position}
              onChange={event => p.seek(event.target.valueAsNumber)}
            />
          </>
        )}
        <label>
          Find <input aria-label="Find" value={p.search} onChange={event => p.setSearch(event.target.value)} />
        </label>
      </div>
      <p className="custom-host-active" style={{...row, margin: '0 0 8px'}}>
        Showing: <output aria-label="Active view">{viewLabel(p, view)}</output>
      </p>
      {view === 'renderer' ? (
        <ProjectionStage projection={p} labels={{before: 'Before', after: 'After'}} />
      ) : (
        <ul aria-label={viewNames[view]} style={{fontSize: 14}}>
          {p.visibleRows.map(item => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={item.id === p.selectedId}
                onClick={() => p.select(item.id === p.selectedId ? null : item.id)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Summary projection={p} />
    </main>
  )
}

export const Animated: Story = {}
export const SideBySide: Story = {name: 'Side by side', args: {initialMode: 'side-by-side'}}
export const OneExtraction: Story = {name: 'One extraction', args: {scenario: 'graph/snapshot'}}
