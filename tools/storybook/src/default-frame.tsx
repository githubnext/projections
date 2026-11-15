// The default UI's story frame: a scoped root in the toolbar's theme, with the host's built stylesheet.
import type {Decorator} from '@storybook/react-vite'
import {ScopedRoot} from '@githubnext/projections-host/ui/components'
import '@githubnext/projections-host/ui.css'
import {themeOf} from './theme.js'
import './frame.css'

export const withDefaultFrame: Decorator = (Story, {globals}) => (
  <ScopedRoot colorMode={themeOf(globals)} className="sb-frame sb-default-frame">
    <Story />
  </ScopedRoot>
)
