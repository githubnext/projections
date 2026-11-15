import {defineConfig} from 'vite'
import {rendererConfig} from '@githubnext/projections-renderer-sdk/vite'
import {accepts} from './src/accepts.js'

export default defineConfig({
  ...rendererConfig({
    entry: 'src/main.tsx',
    name: 'dependency-injection',
    accepts,
    title: 'Dependency injection',
    handles: ['dependency-injection'],
    comparisonModes: ['side-by-side', 'animated', 'swipe', 'diff'],
  }),
  esbuild: {jsx: 'automatic'},
})
