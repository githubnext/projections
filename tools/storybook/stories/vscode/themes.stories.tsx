import type {Meta, StoryObj} from '@storybook/react-vite'
import {VscodeThemeFrame, vscodeThemeOf} from '../../src/vscode-frame.js'
import {renderVscodeExplorer} from '../../src/vscode-render.js'
import type {VscodeArgs} from '../../src/vscode-render.js'
import {runtimeLoader, scenarioArgTypes} from '../../src/stories.js'
import './themes.css'

const screenshots = import.meta.glob<string>('../../../../packages/host/vscode-ui/fixtures/themes/*.vscode.png', {
  eager: true,
  import: 'default',
  query: '?url',
})
const screenshotOf = (id: string) => Object.entries(screenshots).find(([path]) => path.endsWith(`/${id}.vscode.png`))?.[1]

/**
 * The VS Code UI beside real VS Code in the same color theme: the screenshot captured with the theme's variables
 * (packages/host/vscode-ui/fixtures/themes/<id>.vscode.png, VS Code's own chrome around the Inspector) and the VS Code UI drawn from
 * those variables. Choose the theme in the toolbar.
 */
const meta = {
  title: 'VS Code UI/Themes',
  loaders: [runtimeLoader],
  args: {scenario: 'graph/service-platform', initialMode: 'side-by-side'},
  argTypes: scenarioArgTypes(),
  render: (args, context) => {
    const theme = vscodeThemeOf(context.globals)
    const screenshot = screenshotOf(theme.id)
    return (
      <VscodeThemeFrame theme={theme} className="sb-themes">
        <figure className="sb-themes-figure">
          <figcaption>VS Code 1.145.2, {theme.name}</figcaption>
          {screenshot && <img src={screenshot} alt={`VS Code in the ${theme.name} theme`} />}
        </figure>
        <figure className="sb-themes-figure">
          <figcaption>The VS Code UI from the same variables</figcaption>
          <div className="sb-themes-view">{renderVscodeExplorer(args, context)}</div>
        </figure>
      </VscodeThemeFrame>
    )
  },
} satisfies Meta<VscodeArgs>

export default meta
type Story = StoryObj<typeof meta>

export const SideBySide: Story = {name: 'Beside real VS Code'}
