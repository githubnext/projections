import type {Preview} from '@storybook/react-vite'

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Color mode of the UI and its renderer frames',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        dynamicTitle: true,
        items: [
          {value: 'light', title: 'Light', icon: 'sun'},
          {value: 'dark', title: 'Dark', icon: 'moon'},
        ],
      },
    },
    vscodeTheme: {
      description: 'VS Code color theme of the VS Code UI, captured from VS Code (packages/host/vscode-ui/fixtures/themes)',
      toolbar: {
        title: 'VS Code theme',
        icon: 'paintbrush',
        dynamicTitle: true,
        items: [
          {value: 'dark-modern', title: 'Dark Modern'},
          {value: 'light-modern', title: 'Light Modern'},
          {value: 'dark-high-contrast', title: 'Dark High Contrast'},
          {value: 'light-high-contrast', title: 'Light High Contrast'},
          {value: 'solarized-dark', title: 'Solarized Dark'},
          {value: 'dark-2026', title: 'Dark 2026'},
        ],
      },
    },
  },
  initialGlobals: {theme: 'light', vscodeTheme: 'dark-modern'},
  parameters: {
    layout: 'fullscreen',
    backgrounds: {disable: true},
    controls: {expanded: true},
    viewport: {
      options: {
        mobile: {name: 'Mobile (390 × 844)', styles: {width: '390px', height: '844px'}, type: 'mobile'},
        tablet: {name: 'Tablet (820 × 1180)', styles: {width: '820px', height: '1180px'}, type: 'tablet'},
        desktop: {name: 'Desktop (1440 × 1000)', styles: {width: '1440px', height: '1000px'}, type: 'desktop'},
      },
    },
    options: {
      storySort: {
        order: [
          'Default UI',
          ['Comparison explorer', 'Projection view', 'Renderers', 'Building blocks', 'Components', 'Icons'],
          'VS Code UI',
          ['Comparison explorer', 'Projection view', 'Renderers', 'Toolbar', 'Building blocks', 'Icons', 'Inspector', 'Themes'],
          'Core',
          'Harness',
        ],
      },
    },
  },
}

export default preview
