import {defineConfig} from 'vite'
import {rendererConfig} from '@githubnext/projections-renderer-sdk/vite'
import {accepts} from './src/accepts.js'

export default defineConfig({
  ...rendererConfig({
    entry: 'src/main.tsx',
    name: 'graph',
    accepts,
    title: 'Graph',
    handles: ['graph', 'graph-horizontal', 'dag', 'architecture', 'infrastructure', 'dependencies'],
    comparisonModes: ['side-by-side', 'animated', 'swipe', 'diff'],
  }),
  esbuild: {jsx: 'automatic'},
})
