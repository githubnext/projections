import {defineConfig} from 'vite'
import {rendererConfig} from '@githubnext/projections/vite'

// `npm run build` writes dist/index.html, one self-contained page the host runs
// in a sandboxed frame, and dist/renderer.json. Commit dist/ with the sources.
// The build generates the page's entry: the kit's shell mounts `View` from
// `view` with the capabilities declared here, and under `npm run dev` an edit
// remounts it in place with the host's current state, without reloading the
// frame. The definition's `renderer: {bundle}` selects this bundle directly,
// so `handles` (built-in renderer names a bundle stands in for) stays empty.
export default defineConfig({
  ...rendererConfig({
    view: 'src/view.tsx',
    name: '{{name}}',
    title: '{{title}}',
    handles: [],
    // Diff first: a comparison opens in it.
    comparisonModes: ['diff', 'side-by-side', 'animated', 'swipe'],
  }),
  esbuild: {jsx: 'automatic'},
})
