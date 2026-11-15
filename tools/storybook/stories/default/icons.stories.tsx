import type {Meta, StoryObj} from '@storybook/react-vite'
import {hostTheme} from '@githubnext/projections-host'
import {shadcnRendererTokens, SummaryBar} from '@githubnext/projections-host/ui'
import {ScopedRoot} from '@githubnext/projections-host/ui/components'
import {withDefaultFrame} from '../../src/default-frame.js'
import {IconGallery} from '../../src/icon-gallery.js'
import type {IconPanel} from '../../src/icon-gallery.js'
import {badgeGroups, outlineGroups} from '../../src/icon-vocabulary.js'
import {iconUses} from '../icon-uses.js'

/**
 * The SDK's icon vocabulary in the default UI's theme, light and dark: each icon as the renderer kit draws it, at text
 * sizes and large, in a card's status and in the summary bar. A visual check of the icons, which follows the SDK;
 * "In the renderers" groups them by where the renderers use them, each beside its words there.
 */
const meta = {
  title: 'Default UI/Icons',
  decorators: [withDefaultFrame],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const panels: IconPanel[] = (['light', 'dark'] as const).map(mode => ({
  id: mode,
  title: mode === 'light' ? 'Light' : 'Dark',
  theme: hostTheme(mode, shadcnRendererTokens(mode)),
  frame: content => (
    <ScopedRoot colorMode={mode} className="sb-icon-frame">
      {content}
    </ScopedRoot>
  ),
}))

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
