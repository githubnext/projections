import {defineConfig} from 'vite'
import {rendererConfig} from '@githubnext/projections-renderer-sdk/vite'
import {accepts} from './src/accepts.js'

export default defineConfig({
  ...rendererConfig({
    entry: 'src/main.tsx',
    name: 'file-packing',
    accepts,
    title: 'File packing',
    handles: ['file-packing', 'treemap'],
    comparisonModes: ['side-by-side', 'animated', 'swipe', 'diff'],
  }),
  esbuild: {jsx: 'automatic'},
})
