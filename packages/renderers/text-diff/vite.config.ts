import {defineConfig} from 'vite'
import {rendererConfig} from '@githubnext/projections-renderer-sdk/vite'
import {accepts} from './src/accepts.js'

export default defineConfig({
  ...rendererConfig({
    entry: 'src/main.tsx',
    name: 'text-diff',
    accepts,
    title: 'Text diff',
    handles: ['text-diff'],
    comparisonModes: ['diff'],
  }),
  esbuild: {jsx: 'automatic'},
})
