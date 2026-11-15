import {defineConfig} from 'vite'
import {rendererConfig} from '@githubnext/projections-renderer-sdk/vite'
import {accepts} from './src/accepts.js'

export default defineConfig({
  ...rendererConfig({
    entry: 'src/main.tsx',
    name: 'code-statistics',
    accepts,
    title: 'Code statistics',
    handles: ['code-statistics'],
    comparisonModes: ['side-by-side', 'animated', 'swipe', 'diff'],
  }),
  esbuild: {jsx: 'automatic'},
})
