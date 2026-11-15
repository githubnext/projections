import type {Meta, StoryObj} from '@storybook/react-vite'
import {CoreHarness} from './host/core.js'
import {EmbedHarness} from './host/embed.js'
import {HostHarness} from './host/explorer.js'

/**
 * Pages the host's browser suites (packages/host/core/browser/*.spec.ts) drive, on synthetic data with known IDs. The explorer
 * reads the query parameters documented in packages/host/core/browser/README.md from the story URL, for example
 * `iframe.html?id=harness-default-ui--explorer&viewMode=story&renderer=hostile&probe=network`.
 */
const meta = {
  title: 'Harness/Default UI',
  tags: ['harness'],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Explorer: Story = {render: () => <HostHarness />}
/** A host built on the headless core alone, with its own minimal controls. */
export const CoreOnly: Story = {name: 'Core only', render: () => <CoreHarness />}
/** The scoped stylesheet in a page with deliberately hostile global styles. */
export const HostileEmbedding: Story = {name: 'Hostile embedding', render: () => <EmbedHarness />}
