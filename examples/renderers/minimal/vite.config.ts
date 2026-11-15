import {defineConfig} from 'vite'
import {rendererConfig} from '@githubnext/projections/vite'

// Produces dist/index.html, one self-contained page with the script and styles inline, and dist/renderer.json.
export default defineConfig(rendererConfig({entry: 'src/main.ts', name: 'minimal', title: 'Minimal outline', handles: []}))
