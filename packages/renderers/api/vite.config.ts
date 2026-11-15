import {defineConfig} from 'vite'
import {rendererConfig} from '@githubnext/projections-renderer-sdk/vite'
import {accepts} from './src/accepts.js'

export default defineConfig({
  ...rendererConfig({
    entry: 'src/main.tsx',
    name: 'api',
    accepts,
    title: 'API',
    handles: ['api'],
    comparisonModes: ['side-by-side', 'diff'],
  }),
  esbuild: {jsx: 'automatic'},
})
