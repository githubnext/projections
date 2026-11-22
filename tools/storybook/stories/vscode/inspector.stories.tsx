import {useMemo} from 'react'
import type {Meta, StoryObj} from '@storybook/react-vite'
import {InspectorApp, InspectorHostProvider} from '@githubnext/projections-inspector'
import type {InspectorHost} from '@githubnext/projections-inspector/mount'
import {loadArtifact} from '@githubnext/projections-engine/artifacts'
import {VscodeProjectionView, vscodeColorMode, vscodeThemeKindOf, type VscodeThemeFixture} from '@githubnext/projections-host-vscode'
import '@githubnext/projections-host/ui.css'
import '@githubnext/projections-inspector/styles.css'
import '@githubnext/projections-host-vscode/inspector.css'
import {VscodeThemeFrame, vscodeThemeOf} from '../../src/vscode-frame.js'
import {extractionChoices} from '../../src/fixtures.js'
import {rules} from '../../src/runtime.js'
import {runtimeLoader, scenarioArgTypes, scenarioFixture, type Loaded, type ScenarioArgs} from '../../src/stories.js'

const noop = () => undefined

/** The VS Code theme as the Inspector's host theme (`InspectorHost.theme`), as the extension's webview supplies it. */
function hostOf(theme: VscodeThemeFixture): InspectorHost {
  const kind = vscodeThemeKindOf(theme.bodyClasses) ?? 'dark'
  const accent = theme.variables['--vscode-focusBorder']
  const current = {colorMode: vscodeColorMode(kind), ...(accent ? {accent} : {})}
  return {theme: {get: () => current, subscribe: () => noop}}
}

function Inspector({args, loaded, theme}: {args: ScenarioArgs; loaded: Loaded; theme: VscodeThemeFixture}) {
  const item = scenarioFixture(args)
  const document = extractionChoices(item).at(-1)!.document
  const host = useMemo(() => hostOf(theme), [theme])
  const engine = loaded.runtime.engine
  return (
    <VscodeThemeFrame theme={theme} className="sb-vscode-inspector">
      <div data-host-ui="vscode">
        <InspectorHostProvider host={host}>
          <InspectorApp
            key={item.key}
            engine={engine}
            loadArtifact={json => loadArtifact(json, {engine})}
            initialDocument={document}
            renderers={loaded.runtime.renderers}
            rules={rules}
            projectionView={VscodeProjectionView}
          />
        </InspectorHostProvider>
      </div>
    </VscodeThemeFrame>
  )
}

/**
 * The Inspector's shell in VS Code style (`@githubnext/projections-host-vscode/inspector.css` on a mount root marked
 * `data-host-ui="vscode"`) with the VS Code UI's projection view, as the VS Code extension's webview shows it, in the
 * VS Code theme chosen in the toolbar. It presents the scenario's extraction as a document the runner supplied.
 */
const meta = {
  title: 'VS Code UI/Inspector',
  loaders: [runtimeLoader],
  args: {scenario: 'graph/service-platform'},
  argTypes: scenarioArgTypes(),
  render: (args, {globals, loaded}) => <Inspector args={args} loaded={loaded as Loaded} theme={vscodeThemeOf(globals)} />,
} satisfies Meta<ScenarioArgs>

export default meta
type Story = StoryObj<typeof meta>

export const Document: Story = {name: 'A supplied document'}
export const Database: Story = {name: 'Database renderer', args: {scenario: 'database/prisma-shop'}}
