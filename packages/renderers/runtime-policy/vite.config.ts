import {defineConfig} from 'vite'
import {rendererConfig} from '@githubnext/projections-renderer-sdk/vite'
import {accepts} from './src/accepts.js'

export default defineConfig({
  ...rendererConfig({
    entry: 'src/main.tsx',
    name: 'runtime-policy',
    accepts,
    title: 'Runtime security policies',
    handles: ['runtime-policy'],
    comparisonModes: ['side-by-side', 'diff'],
  }),
  esbuild: {jsx: 'automatic'},
})
