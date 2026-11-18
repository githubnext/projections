import {defineConfig} from 'vite'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {collectRenderers, rendererNotices} from '@githubnext/projections-host/build'
import {hostUiNotices} from '@githubnext/projections-host/build/ui-notices'
import {browserNoticePackages, browserNotices} from '@githubnext/projections-host/build/browser-notices'

/** The built-in renderer bundles the Inspector serves. */
const rendererPackages = [
  '@githubnext/projections-renderer-graph',
  '@githubnext/projections-renderer-file-packing',
  '@githubnext/projections-renderer-dependency-injection',
  '@githubnext/projections-renderer-code-statistics',
  '@githubnext/projections-renderer-api',
  '@githubnext/projections-renderer-database',
  '@githubnext/projections-renderer-runtime-policy',
  '@githubnext/projections-renderer-agentic-workflows',
  '@githubnext/projections-renderer-text-diff',
]

const workerDirectory = new URL('./', import.meta.resolve('@githubnext/projections-engine/worker'))
const comparatorDirectory = new URL('./', import.meta.resolve('@githubnext/projections-comparator-runtime/browser'))
const assets = new Map([
  ...['worker-entry.js', 'wasm-transport.js', 'comparator-transport.js', 'transport.js'].map(
    name => [`/engine/${name}`, {type: 'text/javascript', path: new URL(name, workerDirectory)}] as const,
  ),
  ['/engine/engine.wasm', {type: 'application/wasm', path: new URL(import.meta.resolve('@githubnext/projections-engine/engine.wasm'))}],
  [
    '/engine/default-comparator.wasm',
    {type: 'application/wasm', path: new URL(import.meta.resolve('@githubnext/projections-engine/default-comparator.wasm'))},
  ],
  // The comparator runtime's dedicated Worker; these three modules import only each other.
  ...['worker-entry.js', 'execute.js', 'abi.js'].map(
    name => [`/comparator/${name}`, {type: 'text/javascript', path: new URL(name, comparatorDirectory)}] as const,
  ),
  // The rules interpreter, run in the same Worker for every rules comparator.
  ['/comparator/rules.wasm', {type: 'application/wasm', path: new URL('rules.wasm', comparatorDirectory)}],
  // The check probe the runner injects into renderer documents in fixtures mode.
  ['/fixtures/probe.js', {type: 'text/javascript', path: new URL(import.meta.resolve('@githubnext/projections-renderer-testing/probe'))}],
])
const outDir = 'dist/client'

export default defineConfig({
  base: './',
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      // The mountable bundle hosts embed: `mount.js` keeps its exports, with its styles in `mount.css`. There is no page.
      input: {mount: fileURLToPath(new URL('./src/bundle.ts', import.meta.url))},
      preserveEntrySignatures: 'exports-only',
      output: {
        entryFileNames: chunk => (chunk.name === 'mount' ? 'mount.js' : 'assets/[name]-[hash].js'),
      },
      // Radix, lucide and the vendored shadcn/ui components mark modules "use client" for React Server Components; a client
      // bundle ignores the directive (and Rollup can't map that warning to a source location).
      onwarn(warning, warn) {
        if (warning.code !== 'MODULE_LEVEL_DIRECTIVE' && warning.code !== 'SOURCEMAP_ERROR') warn(warning)
      },
    },
  },
  plugins: [
    {
      name: 'projections-public-engine-assets',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const asset = assets.get(request.url ?? '')
          if (!asset) {
            next()
            return
          }
          readFile(asset.path)
            .then(bytes => {
              response.setHeader('content-type', asset.type)
              response.setHeader('x-content-type-options', 'nosniff')
              response.end(bytes)
            })
            .catch(next)
        })
      },
      async generateBundle() {
        // The host's default UI bundles shadcn/ui, Radix, lucide and friends (MIT/ISC/0BSD; cva is Apache-2.0).
        this.emitFile({
          type: 'asset',
          fileName: 'THIRD_PARTY_NOTICES.txt',
          source:
            (await browserNotices(import.meta.url, [
              new URL('./THIRD_PARTY_NOTICES.txt', import.meta.resolve('@githubnext/projections-engine/engine.wasm')),
              new URL('./LICENSE.schemasafe.txt', import.meta.resolve('@githubnext/projections-engine/artifacts')),
              new URL('LICENSE.rules-interpreter.txt', comparatorDirectory),
            ])) +
            (await hostUiNotices()) +
            '\n' +
            (await rendererNotices({packages: rendererPackages, from: import.meta.url, exclude: browserNoticePackages})),
        })
        for (const [url, asset] of assets) {
          this.emitFile({type: 'asset', fileName: url.slice(1), source: await readFile(fileURLToPath(asset.path))})
        }
      },
    },
    {
      // `mount.css`: every stylesheet the mountable bundle imports, at a fixed name hosts link to.
      name: 'projections-mount-styles',
      apply: 'build',
      generateBundle(_, bundle) {
        const chunks = Object.values(bundle).filter(item => item.type === 'chunk')
        const mount = chunks.find(chunk => chunk.isEntry && chunk.name === 'mount')
        if (!mount) return
        const css = new Set<string>()
        const seen = new Set<string>()
        const visit = (fileName: string) => {
          const chunk = chunks.find(item => item.fileName === fileName)
          if (!chunk || seen.has(fileName)) return
          seen.add(fileName)
          for (const file of chunk.viteMetadata?.importedCss ?? []) css.add(file)
          for (const file of chunk.imports) visit(file)
        }
        visit(mount.fileName)
        const source = [...css].map(file => {
          const asset = bundle[file]
          return asset?.type === 'asset' ? String(asset.source) : ''
        })
        this.emitFile({type: 'asset', fileName: 'mount.css', source: source.join('\n')})
      },
    },
    {
      name: 'projections-renderer-bundles',
      apply: 'build',
      async closeBundle() {
        await collectRenderers({packages: rendererPackages, outDir, from: import.meta.url})
      },
    },
  ],
})
