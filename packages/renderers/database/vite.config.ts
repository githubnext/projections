import {defineConfig} from 'vite'
import {rendererConfig} from '@githubnext/projections-renderer-sdk/vite'
import {accepts} from './src/accepts.js'

export default defineConfig({
  ...rendererConfig({
    entry: 'src/main.tsx',
    name: 'database',
    accepts,
    title: 'Database',
    handles: ['database', 'schema'],
    comparisonModes: ['side-by-side', 'animated', 'swipe', 'diff'],
  }),
  esbuild: {jsx: 'automatic'},
})
