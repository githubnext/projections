import {useRef, useState} from 'react'
import type {Meta, StoryObj} from '@storybook/react-vite'
import {ProjectionStage, subjectRows} from '@githubnext/projections-host'
import type {ProjectionController, ViewSubject} from '@githubnext/projections-host'
import {
  AnnotationMarker,
  ChangeLabel,
  DetailCard,
  FilterButton,
  FullscreenButton,
  InfoButton,
  LoadingStatus,
  ModeSwitch,
  MoreMenu,
  Notice,
  Playback,
  ProjectionPicker,
  RangeInput,
  SelectMenu,
  SettingsMenu,
  ShowAsChip,
  Toolbar as VscodeToolbar,
  ViewSwitch,
  VscodeDetails,
  VscodeLegend,
  VscodeRendererControls,
  VscodeTableView,
  VscodeTextView,
  ZoomControls,
  handlePlaybackKey,
} from '@githubnext/projections-host-vscode'
import type {ViewKind} from '@githubnext/projections-host-vscode'
import {WithProjection} from '../../src/controller.js'
import {vscodeThemeOf, withVscodeFrame} from '../../src/vscode-frame.js'
import {preparedLoader, sampleAnnotations, scenarioArgTypes, scenarioFixture} from '../../src/stories.js'
import type {Loaded, ScenarioArgs} from '../../src/stories.js'

const noop = () => undefined

/**
 * The VS Code UI's exported building blocks, each driven by the host core's controller (`useProjection`) on a
 * scenario, for embedders composing their own view in a webview. Add a story here for each new exported control.
 */
const meta = {
  title: 'VS Code UI/Building blocks',
  decorators: [withVscodeFrame],
  loaders: [preparedLoader],
  args: {scenario: 'graph/service-platform'},
  argTypes: scenarioArgTypes(),
} satisfies Meta<ScenarioArgs>

export default meta
type Story = StoryObj<typeof meta>

const colorMode = (globals: Record<string, unknown>) =>
  vscodeThemeOf(globals).bodyClasses.includes('vscode-light') || vscodeThemeOf(globals).bodyClasses.includes('vscode-high-contrast-light')
    ? 'light'
    : 'dark'
/** The first changed row, else the first row: what a person would likely open. */
const firstChanged = (subject: ViewSubject) => {
  const rows = subjectRows(subject)
  return (rows.find(row => row.status === 'modified') ?? rows.find(row => row.status && row.status !== 'unchanged') ?? rows[0])?.id ?? null
}

export const Table: Story = {
  name: 'VscodeTableView',
  args: {annotations: true},
  render: (args, {globals, loaded}) => (
    <WithProjection
      prepared={(loaded as Required<Loaded>).prepared}
      colorMode={colorMode(globals)}
      options={args.annotations ? {annotations: sampleAnnotations(scenarioFixture(args))} : {}}
    >
      {(p, marks) => (
        <VscodeTableView
          subject={p.subject}
          rows={p.visibleRows}
          total={p.rows.length}
          progress={p.progress}
          selectedId={p.selectedId}
          onSelect={p.select}
          marks={marks}
          onAnnotationActivate={p.activateAnnotation}
        />
      )}
    </WithProjection>
  ),
}

export const Text: Story = {
  name: 'VscodeTextView',
  render: (args, {globals, loaded}) => (
    <WithProjection prepared={(loaded as Required<Loaded>).prepared} colorMode={colorMode(globals)}>
      {(p, marks) => (
        <VscodeTextView
          subject={p.subject}
          rows={p.visibleRows}
          progress={p.progress}
          selectedId={p.selectedId}
          onSelect={p.select}
          marks={marks}
          onAnnotationActivate={p.activateAnnotation}
        />
      )}
    </WithProjection>
  ),
}

export const Details: Story = {
  name: 'VscodeDetails (side bar section)',
  args: {scenario: 'graph/platform-worker', annotations: true},
  render: (args, {globals, loaded}) => {
    const {prepared} = loaded as Required<Loaded>
    const annotations = args.annotations ? sampleAnnotations(scenarioFixture(args)) : []
    return (
      <WithProjection
        prepared={prepared}
        colorMode={colorMode(globals)}
        options={{annotations, initialSelectedId: firstChanged(prepared.subject)}}
      >
        {(p, marks) =>
          p.selectedRow ? (
            <div style={{maxWidth: 320, background: 'var(--vscode-sideBar-background)'}}>
              <VscodeDetails
                subject={p.subject}
                row={p.selectedRow}
                close={() => p.select(null)}
                beforeLabel="Before"
                afterLabel="After"
                selection={p.selection}
                onSelectTarget={target => {
                  p.selectTarget(target)
                }}
                mark={marks.get(p.selectedRow.id)}
                annotations={annotations}
                onAnnotationActivate={p.activateAnnotation}
              />
            </div>
          ) : (
            <p>Nothing selected.</p>
          )
        }
      </WithProjection>
    )
  },
}

export const PlaybackBlock: Story = {
  name: 'Playback (debug toolbar)',
  render: (args, {globals, loaded}) => (
    <WithProjection
      prepared={(loaded as Required<Loaded>).prepared}
      colorMode={colorMode(globals)}
      options={{initialMode: 'animated', initialProgress: 0.4}}
    >
      {p => (
        <div className="sb-stack" style={{maxWidth: 640}}>
          <Playback projection={p} beforeLabel="Before" afterLabel="After" />
          <Playback projection={p} beforeLabel="Before" afterLabel="After" ends={false} overflow />
        </div>
      )}
    </WithProjection>
  ),
}

export const ModeSwitchBlock: Story = {
  name: 'ModeSwitch',
  render: (args, {globals, loaded}) => (
    <WithProjection prepared={(loaded as Required<Loaded>).prepared} colorMode={colorMode(globals)}>
      {p => (
        <div className="sb-stack">
          <div className="sb-row">
            <ModeSwitch projection={p} />
            <span className="sb-caption">
              Selected: <output aria-label="Selected mode">{p.mode}</output>
            </span>
          </div>
          <div className="sb-row">
            <ModeSwitch projection={p} variant="menu" />
            <span className="sb-caption">The menu form, for crowded toolbars</span>
          </div>
        </div>
      )}
    </WithProjection>
  ),
}

const views: readonly ViewKind[] = ['renderer', 'table', 'text']

function Actions({projection: p}: {projection: ProjectionController}) {
  const [view, setView] = useState<ViewKind>('renderer')
  const [projection, setProjection] = useState('services')
  const target = useRef<HTMLDivElement>(null)
  return (
    <div ref={target} className="sb-stack">
      <div className="sb-row">
        <ShowAsChip view={view} rendererTitle="Graph" onDismiss={() => setView('renderer')} />
        <FilterButton projection={p} />
        <SettingsMenu projection={p} view={view} views={views} onViewChange={setView} rendererTitle="Graph" />
        <InfoButton projection={p} />
        <FullscreenButton target={target} />
        <MoreMenu projection={p} view={view} views={views} onViewChange={setView} rendererTitle="Graph" fullscreenTarget={target} />
        <span className="sb-caption">
          View: <output aria-label="Selected view">{view}</output>
        </span>
      </div>
      <div className="sb-row">
        <ProjectionPicker
          projections={[
            {id: 'services', title: 'Services', description: 'How services call each other', count: 4},
            {id: 'packages', title: 'Packages', description: 'Workspace dependencies', count: 0},
            {id: 'api', title: 'Public API', count: 12},
          ]}
          value={projection}
          onChange={setProjection}
        />
      </div>
      <ViewSwitch view={view} onViewChange={setView} views={views} rendererTitle="Graph" />
    </div>
  )
}

export const ToolbarBlocks: Story = {
  name: 'Actions, menus, quick pick and tabs',
  render: (args, {globals, loaded}) => (
    <WithProjection prepared={(loaded as Required<Loaded>).prepared} colorMode={colorMode(globals)}>
      {p => <Actions projection={p} />}
    </WithProjection>
  ),
}

/** The README's composition: a custom toolbar from the blocks around `ProjectionStage`, on `useProjection`. */
function Composed({projection: p}: {projection: ProjectionController}) {
  const [view, setView] = useState<ViewKind>('renderer')
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const title = p.renderer?.title
  return (
    <div ref={root} className="ph phv-root" data-fill="" style={{height: 560}}>
      <VscodeToolbar
        onKeyDown={event => {
          handlePlaybackKey(event, p)
        }}
      >
        {view === 'renderer' && <ModeSwitch projection={p} />}
        <Playback projection={p} beforeLabel="Before" afterLabel="After" />
        {view === 'renderer' && <ZoomControls projection={p} />}
        <ShowAsChip view={view} rendererTitle={title} onDismiss={() => setView('renderer')} />
        <div className="phv-toolbar-end">
          <FilterButton projection={p} />
          <SettingsMenu
            projection={p}
            view={view}
            views={p.renderer ? views : views.slice(1)}
            onViewChange={setView}
            rendererTitle={title}
          />
          <InfoButton projection={p} />
          <FullscreenButton target={root} />
        </div>
      </VscodeToolbar>
      <div
        ref={stage}
        style={{position: 'relative', display: 'flex', flexDirection: 'column', flex: '1 1 0', minHeight: 0, overflow: 'auto'}}
      >
        <ProjectionStage projection={p} labels={{before: 'Before', after: 'After'}} hidden={view !== 'renderer'} fill />
        {view === 'table' && (
          <VscodeTableView
            subject={p.subject}
            rows={p.visibleRows}
            total={p.rows.length}
            progress={p.progress}
            selectedId={p.selectedId}
            onSelect={p.select}
          />
        )}
        {view === 'text' && (
          <VscodeTextView subject={p.subject} rows={p.visibleRows} progress={p.progress} selectedId={p.selectedId} onSelect={p.select} />
        )}
        <DetailCard projection={p} container={stage} />
      </div>
    </div>
  )
}

export const ComposedToolbar: Story = {
  name: 'Composed toolbar around ProjectionStage',
  render: (args, {globals, loaded}) => (
    <WithProjection prepared={(loaded as Required<Loaded>).prepared} colorMode={colorMode(globals)}>
      {p => <Composed projection={p} />}
    </WithProjection>
  ),
}

export const Controls: Story = {
  name: 'VscodeRendererControls',
  args: {scenario: 'code-statistics/languages'},
  render: (args, {globals, loaded}) => (
    <WithProjection prepared={(loaded as Required<Loaded>).prepared} colorMode={colorMode(globals)}>
      {p => (
        <div className="sb-stack">
          <VscodeRendererControls projection={p} />
          {/* The renderer declares its controls once its frame connects. */}
          <ProjectionStage projection={p} labels={{before: 'Before', after: 'After'}} />
        </div>
      )}
    </WithProjection>
  ),
}

function Inputs() {
  const [speed, setSpeed] = useState('1')
  const [value, setValue] = useState(40)
  return (
    <div className="sb-stack" style={{maxWidth: 420}}>
      <SelectMenu
        label="Speed"
        value={speed}
        options={[
          {value: '0.5', label: '0.5×'},
          {value: '1', label: '1×'},
          {value: '2', label: '2×'},
        ]}
        onChange={setSpeed}
      />
      <div className="sb-row">
        <RangeInput label="Transition" min={0} max={100} step={1} value={value} onChange={setValue} valueText={`${value} percent`} />
        <output>{value}%</output>
      </div>
    </div>
  )
}

export const MenusAndRange: Story = {name: 'SelectMenu and RangeInput', render: () => <Inputs />}

export const Labels: Story = {
  name: 'ChangeLabel and AnnotationMarker',
  args: {annotations: true},
  render: (args, {globals, loaded}) => (
    <WithProjection
      prepared={(loaded as Required<Loaded>).prepared}
      colorMode={colorMode(globals)}
      options={{annotations: sampleAnnotations(scenarioFixture(args))}}
    >
      {(p, marks) => (
        <ul className="sb-stack" style={{listStyle: 'none', padding: 0, margin: 0}}>
          {p.rows.slice(0, 8).map(row => (
            <li key={row.id} className="sb-row">
              <ChangeLabel row={row} />
              <span>{row.label}</span>
              {marks.get(row.id) && <AnnotationMarker mark={marks.get(row.id)!} row={row} onActivate={p.activateAnnotation} />}
            </li>
          ))}
        </ul>
      )}
    </WithProjection>
  ),
}

export const Legend: Story = {
  name: 'VscodeLegend',
  render: (args, {globals, loaded}) => (
    <WithProjection prepared={(loaded as Required<Loaded>).prepared} colorMode={colorMode(globals)}>
      {p => (
        <VscodeLegend
          tokens={p.theme.tokens}
          legend={{
            title: 'Changes',
            items: [
              {label: 'Added', token: 'color-added-muted'},
              {label: 'Removed', token: 'color-removed-muted', shape: 'circle'},
              {label: 'Modified', token: 'color-modified'},
              {label: 'Moved', token: 'color-moved-muted'},
              {label: 'Service', token: 'chart-1', shape: 'circle'},
              {label: 'Calls', token: 'color-fg-muted', shape: 'line'},
              {label: 'Inferred', token: 'color-fg-muted', shape: 'dashed'},
              {label: 'module'},
            ],
          }}
        />
      )}
    </WithProjection>
  ),
}

export const Status: Story = {
  name: 'LoadingStatus and Notice',
  render: () => (
    <div className="sb-stack" style={{maxWidth: 560}}>
      <LoadingStatus label="Loading Graph…" fill={false} />
      <Notice title="Renderer notice" hideTitle>
        The requested renderer is unavailable, so the Graph renderer presents this projection.
      </Notice>
      <Notice severity="warning" title="The renderer reported a problem">
        One layout pass took longer than expected. The table and text views remain available.
      </Notice>
      <Notice severity="error" title="The Graph renderer stopped." actions={[{label: 'Show table', onClick: noop}]}>
        It stopped responding. The table and text views still present this comparison.
      </Notice>
    </div>
  ),
}
