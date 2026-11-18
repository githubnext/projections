import {defineConfig} from 'vite'
import {rendererConfig} from '@githubnext/projections-renderer-sdk/vite'
import {accepts} from './src/accepts.js'

export default defineConfig({
  ...rendererConfig({
    entry: 'src/main.tsx',
    name: 'agentic-workflows',
    accepts,
    title: 'Agentic workflows',
    handles: ['agentic-workflows'],
    comparisonModes: ['side-by-side', 'diff'],
  }),
  esbuild: {jsx: 'automatic'},
})
