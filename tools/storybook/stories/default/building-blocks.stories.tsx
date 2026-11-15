import {useRef, useState} from 'react'
import type {Meta, StoryObj} from '@storybook/react-vite'
import {ProjectionStage} from '@githubnext/projections-host'
import type {ComparisonMode, ProjectionController} from '@githubnext/projections-host'
import {
  ComparisonModeControl,
  DetailCard,
  FilterButton,
  FullscreenButton,
  InfoButton,
  ModeSwitch,
  PlayButton,
  Playback,
  RendererControls,
  ScopedRoot,
  SettingsMenu,
  ShowAs,
  ShowAsChip,
  TableView,
  TextView,
  Toolbar as ToolbarRow,
  ViewSwitch,
  ZoomControls,
  spaceTogglesPlayback,
} from '@githubnext/projections-host/ui'
import type {ViewKind} from '@githubnext/projections-host/ui'
import {WithProjection} from '../../src/controller.js'
import {withDefaultFrame} from '../../src/default-frame.js'
import {themeOf} from '../../src/theme.js'
import {preparedLoader, sampleAnnotations, scenarioArgTypes, scenarioFixture} from '../../src/stories.js'
import type {Loaded, ScenarioArgs} from '../../src/stories.js'

/**
 * The default UI's exported building blocks, each driven by the host core's controller (`useProjection`) on a
 * scenario, for embedders composing their own view. Add a story here for each new exported control.
 */
const meta = {
  title: 'Default UI/Building blocks',
  decorators: [withDefaultFrame],
  loaders: [preparedLoader],
  args: {scenario: 'graph/service-platform'},
  argTypes: scenarioArgTypes(),
} satisfies Meta<ScenarioArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Table: Story = {
  name: 'TableView',
  args: {annotations: true},
  render: (args, {globals, loaded}) => (
    <WithProjection
      prepared={(loaded as Required<Loaded>).prepared}
      colorMode={themeOf(globals)}
      options={args.annotations ? {annotations: sampleAnnotations(scenarioFixture(args))} : {}}
    >
      {(p, marks) => (
        <TableView
          subject={p.subject}
          rows={p.visibleRows}
          total={p.rows.length}
          progress={p.progress}
          selectedId={p.selectedId}
          onSelect={p.select}
          annotations={marks}
          onAnnotationActivate={p.activateAnnotation}
        />
      )}
    </WithProjection>
  ),
}

export const Text: Story = {
  name: 'TextView',
  render: (args, {globals, loaded}) => (
    <WithProjection prepared={(loaded as Required<Loaded>).prepared} colorMode={themeOf(globals)}>
      {(p, marks) => (
        <TextView
          subject={p.subject}
          rows={p.visibleRows}
          progress={p.progress}
          selectedId={p.selectedId}
          onSelect={p.select}
          annotations={marks}
          onAnnotationActivate={p.activateAnnotation}
        />
      )}
    </WithProjection>
  ),
}

function ModeControlExample({modes}: {modes?: readonly ComparisonMode[]}) {
  const [mode, setMode] = useState<ComparisonMode>('animated')
  return (
    <div className="sb-stack">
      <ComparisonModeControl mode={mode} onChange={setMode} {...(modes ? {modes} : {})} />
      <p className="sb-caption">
        Selected: <output aria-label="Selected mode">{mode}</output>
      </p>
    </div>
  )
}

export const ModeControl: Story = {
  name: 'ComparisonModeControl',
  render: () => (
    <div className="sb-stack">
      <ModeControlExample />
      <ModeControlExample modes={['side-by-side', 'swipe']} />
    </div>
  ),
}

export const Controls: Story = {
  name: 'RendererControls',
  args: {scenario: 'code-statistics/languages'},
  render: (args, {globals, loaded}) => (
    <WithProjection prepared={(loaded as Required<Loaded>).prepared} colorMode={themeOf(globals)}>
      {p => (
        <div className="sb-stack">
          <RendererControls projection={p} />
          {/* The renderer declares its controls once its frame connects. */}
          <ProjectionStage projection={p} labels={{before: 'Before', after: 'After'}} />
        </div>
      )}
    </WithProjection>
  ),
}

export const PlaybackBlock: Story = {
  name: 'Playback',
  render: (args, {globals, loaded}) => (
    <WithProjection
      prepared={(loaded as Required<Loaded>).prepared}
      colorMode={themeOf(globals)}
      options={{initialMode: 'animated', initialProgress: 0.4}}
    >
      {p => <Playback projection={p} beforeLabel="Before" afterLabel="After" />}
    </WithProjection>
  ),
}

export const PlayButtonBlock: Story = {
  name: 'PlayButton',
  render: (args, {globals, loaded}) => (
    <WithProjection
      prepared={(loaded as Required<Loaded>).prepared}
      colorMode={themeOf(globals)}
      options={{initialMode: 'animated', initialProgress: 0}}
    >
      {p => (
        <div className="sb-row">
          <PlayButton projection={p} beforeLabel="Before" afterLabel="After" />
          <span className="sb-caption">
            Next direction: <output aria-label="Next direction">{p.nextDirection === 1 ? 'forward' : 'backward'}</output>
          </span>
        </div>
      )}
    </WithProjection>
  ),
}

function ShowAsExample({projection: p}: {projection: ProjectionController}) {
  const [view, setView] = useState<ViewKind>('table')
  const showAs = {view, views: ['renderer', 'table', 'text'] as const, onViewChange: setView, rendererTitle: 'Graph'}
  return (
    <div className="sb-stack">
      <div className="sb-row">
        <ShowAs {...showAs} />
        <ShowAsChip view={view} rendererTitle="Graph" onDismiss={() => setView('renderer')} />
        <ShowAsChip view="text" />
        <SettingsMenu projection={p} showAs={showAs} />
      </div>
      <span className="sb-caption">
        View: <output aria-label="Shown view">{view}</output>
      </span>
    </div>
  )
}

export const ShowAsBlocks: Story = {
  name: 'ShowAs, ShowAsChip and SettingsMenu with Show as',
  render: (args, {globals, loaded}) => (
    <WithProjection prepared={(loaded as Required<Loaded>).prepared} colorMode={themeOf(globals)}>
      {p => <ShowAsExample projection={p} />}
    </WithProjection>
  ),
}

/** The composition docs/guides/host-ui.md documents: a custom toolbar from the layer-2 blocks around `ProjectionStage`. */
function CustomToolbar({projection: p}: {projection: ProjectionController}) {
  const [view, setView] = useState<ViewKind>('renderer')
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const showAs = {view, views: ['renderer', 'table', 'text'] as const, onViewChange: setView, rendererTitle: p.renderer?.title}
  return (
    <ScopedRoot ref={root} colorMode={p.colorMode} className="sb-stack">
      <ToolbarRow onKeyDown={spaceTogglesPlayback(p)}>
        <ShowAsChip view={view} rendererTitle={p.renderer?.title} onDismiss={() => setView('renderer')} />
        <ModeSwitch projection={p} compact />
        <Playback projection={p} beforeLabel="Before" afterLabel="After" always={view !== 'renderer'} className="pj:flex-1" />
        <ZoomControls projection={p} />
        <SettingsMenu projection={p} showAs={showAs} />
        <FullscreenButton target={root} />
      </ToolbarRow>
      {/* The detail card overlays this positioned box beside the selected item. */}
      <div ref={stage} style={{position: 'relative'}}>
        <ProjectionStage projection={p} hidden={view !== 'renderer'} labels={{before: 'Before', after: 'After'}} />
        {view === 'table' && (
          <TableView
            subject={p.subject}
            rows={p.visibleRows}
            total={p.rows.length}
            progress={p.progress}
            selectedId={p.selectedId}
            onSelect={p.select}
          />
        )}
        {view === 'text' && (
          <TextView subject={p.subject} rows={p.visibleRows} progress={p.progress} selectedId={p.selectedId} onSelect={p.select} />
        )}
        <DetailCard projection={p} container={stage} />
      </div>
    </ScopedRoot>
  )
}

export const CustomToolbarComposition: Story = {
  name: 'A custom toolbar around ProjectionStage',
  render: (args, {globals, loaded}) => (
    <WithProjection prepared={(loaded as Required<Loaded>).prepared} colorMode={themeOf(globals)}>
      {p => <CustomToolbar projection={p} />}
    </WithProjection>
  ),
}

export const ModeSwitchBlock: Story = {
  name: 'ModeSwitch',
  render: (args, {globals, loaded}) => (
    <WithProjection prepared={(loaded as Required<Loaded>).prepared} colorMode={themeOf(globals)}>
      {p => (
        <div className="sb-stack">
          <div className="sb-row">
            <ModeSwitch projection={p} />
            <span className="sb-caption">
              Selected: <output aria-label="Selected mode">{p.mode}</output>
            </span>
          </div>
          <ModeSwitch projection={p} modes={['side-by-side', 'swipe']} compact />
        </div>
      )}
    </WithProjection>
  ),
}

function Toolbar({projection: p}: {projection: ProjectionController}) {
  const [view, setView] = useState<ViewKind>('renderer')
  const target = useRef<HTMLDivElement>(null)
  return (
    <div ref={target} className="sb-row">
      <ZoomControls projection={p} />
      <ViewSwitch view={view} onViewChange={setView} views={['renderer', 'table', 'text']} rendererTitle="Graph" />
      <FilterButton projection={p} />
      <SettingsMenu projection={p} />
      <InfoButton projection={p} />
      <FullscreenButton target={target} />
      <span className="sb-caption">
        View: <output aria-label="Selected view">{view}</output>
      </span>
    </div>
  )
}

export const ToolbarBlocks: Story = {
  // The prebuilt views offer table and text in Settings; `ViewSwitch` remains for custom hosts that want tabs.
  name: 'ZoomControls, ViewSwitch, FilterButton, SettingsMenu, InfoButton and FullscreenButton',
  render: (args, {globals, loaded}) => (
    <WithProjection prepared={(loaded as Required<Loaded>).prepared} colorMode={themeOf(globals)}>
      {p => (
        <div className="sb-stack">
          <Toolbar projection={p} />
          {/* The renderer declares its zoom controls once its frame connects. */}
          <ProjectionStage projection={p} labels={{before: 'Before', after: 'After'}} />
        </div>
      )}
    </WithProjection>
  ),
}
