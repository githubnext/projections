import type {Meta, StoryObj} from '@storybook/react-vite'
import {hostTheme} from '@githubnext/projections-host'
import {SummaryBar, vscodeColorMode, vscodeThemeKindOf, vscodeThemeTokens} from '@githubnext/projections-host-vscode'
import {IconGallery} from '../../src/icon-gallery.js'
import type {IconPanel} from '../../src/icon-gallery.js'
import {badgeGroups, outlineGroups} from '../../src/icon-vocabulary.js'
import {iconUses} from '../icon-uses.js'
import {VscodeThemeFrame, vscodeThemes, withVscodeFrame} from '../../src/vscode-frame.js'

/**
 * The SDK's icon vocabulary in every captured VS Code theme, light, dark and high contrast: each icon as the renderer
 * kit draws it, at text sizes and large, in a card's status and in the summary bar, with the tokens the VS Code UI
 * resolves from the theme (codicons for the outline icons). A visual check of the icons, which follows the
 * SDK; "In the renderers" groups them by where the renderers use them, each beside its words there.
 */
const meta = {
  title: 'VS Code UI/Icons',
  decorators: [withVscodeFrame],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const panels: IconPanel[] = vscodeThemes.map(theme => {
  const kind = vscodeThemeKindOf(theme.bodyClasses) ?? 'dark'
  return {
    id: theme.id,
    title: theme.name,
    theme: hostTheme(vscodeColorMode(kind), vscodeThemeTokens(theme.variables, kind)),
    frame: content => (
      <VscodeThemeFrame theme={theme} className="sb-icon-frame">
        {content}
      </VscodeThemeFrame>
    ),
  }
})

export const Badges: Story = {
  name: 'Badges',
  render: () => <IconGallery groups={badgeGroups} panels={panels} SummaryBar={SummaryBar} />,
}

export const OtherIcons: Story = {
  name: 'Other icons',
  render: () => <IconGallery groups={outlineGroups} panels={panels} SummaryBar={SummaryBar} />,
}

export const InRenderers: Story = {
  name: 'In the renderers',
  render: () => <IconGallery groups={iconUses} panels={panels} SummaryBar={SummaryBar} />,
}
