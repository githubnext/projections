import {defineConfig} from 'tsdown'
import type {UserConfig} from 'tsdown'

// `@githubnext/projections` is this monorepo's internal renderer workspaces bundled into one package: the SDK
// (`./renderer`, `./renderer/react`, `./vite`), the kit (`./kit`, framework-free, and `./kit/react`), renderer testing
// (`./testing`), the document types (`./schemas`) and the extractor helpers (`./extractor`).
// `./renderer` and `./kit` import no React, so a renderer without React installs and builds without it.
// Internal `@githubnext/projections-*` workspaces are bundled, JavaScript and declarations alike, so nothing published
// names them. Third-party packages stay dependencies, so a renderer's own bundle attributes them in its notices
// (`./vite`), and React, Vite and Playwright are peers.
const internal = /^@githubnext\/projections-/
const peers = ['react', 'react-dom', 'vite', '@playwright/test']
const dependencies = ['elkjs', 'lucide', 'perfect-arrows', 'typebox']
// The kit's layout engine is chosen by the `#layout-engine` import (this package's `imports`): a Web Worker in the
// browser, in-process in Node. The two engines are built as entries of their own.
const layoutEngine = '#layout-engine'
// Third-party data vendored into the SDK (`vendor/linguist`) stays a file of its own beside its license and
// `vendor.json`, so renderer builds attribute it.
const vendored = /[\\/]vendor[\\/]linguist[\\/]languages\.js$/

const shared = {
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  sourcemap: false,
  hash: false,
  fixedExtension: false,
  treeshake: true,
  tsconfig: 'tsconfig.json',
  publint: false,
  attw: false,
} satisfies UserConfig

export default defineConfig([
  {
    ...shared,
    entry: {
      renderer: 'src/renderer.ts',
      'renderer-react': 'src/renderer-react.ts',
      kit: 'src/kit.ts',
      'kit-react': 'src/kit-react.ts',
      vite: 'src/vite.ts',
      testing: 'src/testing.ts',
      workbench: 'src/workbench.ts',
      schemas: 'src/schemas.ts',
      extractor: 'src/extractor.ts',
    },
    outDir: 'dist',
    clean: true,
    dts: {resolver: 'tsc'},
    outputOptions: {
      // Chunks shared by the entries sit beside them, so the vendored data's relative import resolves from each.
      chunkFileNames: 'shared-[name].js',
      // Shared code is chunked by SDK module, so importing part of `./renderer` loads only what it needs. In
      // particular the React hooks are a chunk of their own, which only `./renderer/react` and `./kit/react` import:
      // React declares no `sideEffects`, so a bundler keeps any `react` import it sees, and a renderer that doesn't use
      // React must not see one.
      codeSplitting: {
        // Each group takes only the modules it names, so no chunk drags in another's dependencies (the SDK modules
        // import no React; the hooks import the SDK).
        includeDependenciesRecursively: false,
        groups: [
          {name: 'react', test: /[\\/]renderers[\\/]sdk[\\/]dist[\\/]react\.js$/},
          {name: 'languages', test: /[\\/]renderers[\\/]sdk[\\/]dist[\\/]languages\.js$/},
          // Generated SDK modules (`*.generated.js`) belong to the SDK chunk too.
          {name: 'sdk', test: /[\\/]renderers[\\/]sdk[\\/]dist[\\/](?!vite\.js$)[a-z-]+(\.generated)?\.js$/},
          {name: 'schemas', test: /[\\/]schemas[\\/]dist[\\/].*\.js$/},
        ],
      },
    },
    deps: {
      alwaysBundle: [internal],
      neverBundle: [...peers, ...dependencies, /^react\//, /^react-dom\//, /^elkjs\//, /^node:/, layoutEngine],
      onlyImport: [...peers, ...dependencies, /^node:/, layoutEngine, '../vendor/linguist/languages.js'],
      dts: {alwaysBundle: [internal]},
    },
    plugins: [
      {
        name: 'projections-vendored-data',
        resolveId(source, importer) {
          if (importer && source.startsWith('.') && vendored.test(new URL(source, `file://${importer}`).pathname)) {
            return {id: '../vendor/linguist/languages.js', external: 'absolute'}
          }
          return null
        },
      },
    ],
  },
  {
    ...shared,
    entry: {
      'engine/browser': '../renderers/kit/dist/engine/browser.js',
      'engine/node': '../renderers/kit/dist/engine/node.js',
    },
    outDir: 'dist',
    clean: false,
    dts: false,
    deps: {neverBundle: [/^elkjs\//], onlyImport: ['elkjs']},
  },
])
