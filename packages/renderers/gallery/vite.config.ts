import {defineConfig} from 'vite'
import {rendererConfig} from '@githubnext/projections-renderer-sdk/vite'
import {accepts} from './src/accepts.js'

export default defineConfig({
  ...rendererConfig({
    entry: 'src/main.tsx',
    name: 'gallery',
    accepts,
    title: 'Gallery',
    handles: ['gallery'],
    comparisonModes: ['diff', 'side-by-side', 'animated'],
  }),
  esbuild: {jsx: 'automatic'},
})
