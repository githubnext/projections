import type {StorybookConfig} from '@storybook/react-vite'
import {prepareStatic} from '../scripts/assets.mjs'
import {scenariosPlugin} from '../scripts/scenarios.mjs'

// Renderer bundles and other runtime assets are copied fresh for every dev server start and build.
const staticDirectory = await prepareStatic()

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../stories/**/*.stories.tsx', '../harness/**/*.stories.tsx'],
  staticDirs: [staticDirectory],
  core: {disableTelemetry: true, disableWhatsNewNotifications: true},
  typescript: {reactDocgen: false},
  viteFinal(vite) {
    return {
      ...vite,
      plugins: [...(vite.plugins ?? []), scenariosPlugin()],
      worker: {format: 'es'},
      build: {
        ...vite.build,
        target: 'es2022',
        chunkSizeWarningLimit: 4000,
        rollupOptions: {
          ...vite.build?.rollupOptions,
          // Radix and lucide mark modules "use client" for React Server Components; a client bundle ignores it.
          onwarn(warning, warn) {
            if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning)
          },
        },
      },
    }
  },
}

export default config
