// A sized container for the VS Code UI's prebuilt views, which fill their container's height: the story canvas less the frame's padding.
import type {Decorator} from '@storybook/react-vite'
import './fill.css'

export const withFill: Decorator = Story => (
  <div className="sb-fill">
    <Story />
  </div>
)
