import type {Plugin, UserConfig} from 'vite'
import {readText, recordDevServer, resolveFile} from '../build/dev-server.mjs'
import {bundleNotices} from '../build/notices.mjs'
import {parseAccepts, parseComparisonModes, rendererMetaContentSecurityPolicy} from './protocol.js'
import type {ComparisonMode, RendererAccepts, RendererCapabilities, RendererManifest} from './protocol.js'
import {lintRendererStyles} from './style-lint.js'

/**
 * A renderer bundle's build. Give exactly one of `view` and `entry`:
 *
 * - `view` (usual): a module exporting the renderer's React component as `View` (or its default export). The build
 *   generates the entry that mounts it with the kit (`mountRenderer`), its styles and the capabilities declared here,
 *   and remounts it in place on every edit under `vite` (development).
 * - `entry`: a script of your own that mounts the renderer, for setups a view can't express (providers around the kit,
 *   several components, no kit). Under `vite`, an entry that calls `mountRenderer` and doesn't use `import.meta.hot`
 *   itself also remounts in place on every edit.
 */
export interface RendererBuildOptions {
  /** The view module, for example `src/view.tsx`: the build generates the entry that mounts its `View` export. */
  view?: string
  /** Script entry of your own, for example `src/main.tsx`, in place of `view`. */
  entry?: string
  /** Bundle name, a lowercase identifier; the host serves the bundle at `renderers/<name>/`. */
  name: string
  /** Human-readable title the host shows when this renderer is active. */
  title: string
  /** Definition renderer names this bundle presents, for example `["graph", "dag"]`. */
  handles?: string[]
  /**
   * Comparison modes the bundle supports, written to `renderer.json` and, with `view`, to the generated entry's
   * capabilities. With `entry`, declare the same list in its `mountRenderer` capabilities. Omit it for the default
   * (`animated`, `side-by-side`, `swipe`).
   */
  comparisonModes?: readonly ComparisonMode[]
  /**
   * With `view`: whether the view visibly emphasizes changes using `highlighting` (default `supported`), for the
   * generated entry's capabilities.
   */
  changeHighlighting?: RendererCapabilities['changeHighlighting']
  /**
   * With `view`: the generated entry's other capabilities (`drawsRelationships`, `pace`, …); `changeHighlighting` and
   * `comparisonModes` are options of their own.
   */
  capabilities?: Omit<RendererCapabilities, 'changeHighlighting' | 'comparisonModes'>
  /**
   * The extractions the bundle presents, written to `renderer.json` (and, with `view`, passed to `mountRenderer`):
   * hosts don't send it others, and `AcceptedExtraction<typeof accepts>` types what it receives. Omit it for a
   * renderer of any extraction.
   */
  accepts?: readonly RendererAccepts[]
  /**
   * With `view`: the renderer kit the generated entry mounts with (default `@githubnext/projections/kit`): it imports
   * `mountRenderer` from its `/react` entry and its styles from `/react.css`.
   */
  kit?: string
  /** Output directory (default `dist`). */
  outDir?: string
}

const escape = (value: string) => value.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`)

/**
 * Before `init`, a renderer document is transparent and draws nothing, so the
 * host's surface shows through. The root keeps `color-scheme: light dark`, as
 * the host's frame element does, so no browser paints an opaque backdrop for
 * a scheme mismatch; the body takes the host's color mode from the URL
 * fragment until `applyEnvironment` applies the full theme.
 */
const preInitStyle =
  'html{color-scheme:light dark;background:transparent}body{background:transparent;color-scheme:light}' +
  'html[data-color-mode=dark] body{color-scheme:dark}'
const preInitScript =
  "try{var m=new URLSearchParams(location.hash.slice(1)).get('color');" +
  "if(m==='light'||m==='dark')document.documentElement.dataset.colorMode=m}catch(e){}"

/** Makes text safe inside an inline `<script>` or `<style>` element. */
function inline(text: string, element: 'script' | 'style'): string {
  return text.replace(new RegExp(`</(${element})`, 'gi'), '<\\/$1')
}

/**
 * Replaces the bundled `renderer.js` and `renderer.css` with one
 * self-contained `index.html` (inline script and style, renderer content
 * security policy) and writes `renderer.json` beside it, plus
 * `THIRD_PARTY_NOTICES.txt` for every npm package the script includes (see
 * `bundleNotices`); the build fails if one of them declares no license.
 */
export function rendererBundlePlugin(options: Omit<RendererBuildOptions, 'entry' | 'outDir'>): Plugin {
  return {
    name: 'projections-renderer-bundle',
    apply: 'build',
    // Runs after Vite's own CSS plugin has emitted `renderer.css` into the bundle.
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const script = bundle['renderer.js']
        if (!script || script.type !== 'chunk') throw new Error('The renderer build produced no renderer.js chunk')
        const style = bundle['renderer.css']
        const css =
          style && style.type === 'asset'
            ? String(typeof style.source === 'string' ? style.source : new TextDecoder().decode(style.source))
            : ''
        const others = Object.keys(bundle).filter(name => !['renderer.js', 'renderer.css'].includes(name) && !name.endsWith('.map'))
        if (others.length) throw new Error(`Renderer bundles are a single document; inline these assets instead: ${others.join(', ')}`)
        const notices = bundleNotices(
          `Third-party software in the ${options.title} renderer bundle (${options.name}/index.html).`,
          Object.entries(script.modules)
            .filter(([, module]) => module.renderedLength > 0)
            .map(([id]) => id),
        )
        for (const name of Object.keys(bundle)) delete bundle[name]
        const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escape(rendererMetaContentSecurityPolicy)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escape(options.title)}</title>
<style>${preInitStyle}</style>
<script>${preInitScript}</script>
${css ? `<style>\n${inline(css, 'style')}</style>\n` : ''}</head>
<body>
<div id="root"></div>
<script>
${inline(script.code, 'script')}</script>
</body>
</html>
`
        const manifest: RendererManifest = {
          format: 'projections.renderer',
          version: 0,
          name: options.name,
          title: options.title,
          handles: options.handles ?? [],
          ...(options.comparisonModes ? {comparisonModes: [...options.comparisonModes]} : {}),
          ...(options.accepts ? {accepts: options.accepts.map(item => ({...item}))} : {}),
        }
        this.emitFile({type: 'asset', fileName: 'index.html', source: html})
        this.emitFile({type: 'asset', fileName: 'renderer.json', source: `${JSON.stringify(manifest, null, 2)}\n`})
        this.emitFile({type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: notices})
      },
    },
  }
}

/** The entry `rendererConfig` generates for a `view`, as modules import it. */
export const rendererEntryId = 'virtual:projections-renderer-entry'
const resolvedEntryId = `\0${rendererEntryId}`
/** The generated entry's URL on a development server. */
const devEntryUrl = `/@id/__x00__${rendererEntryId}`
const defaultKit = '@githubnext/projections/kit'

/**
 * The entry module `rendererConfig` generates for the view module at `path` (absolute, `/`-separated): the kit's
 * React styles, the view's `View` (or default) export mounted with `mountRenderer`, the capabilities from the build
 * options and the view's own `options` export (`ViewOptions`), and a hot update that remounts it in place.
 */
export function rendererEntrySource(path: string, options: Omit<RendererBuildOptions, 'entry' | 'outDir'>): string {
  const kit = options.kit ?? defaultKit
  const capabilities: RendererCapabilities = {
    ...options.capabilities,
    changeHighlighting: options.changeHighlighting ?? 'supported',
    ...(options.comparisonModes ? {comparisonModes: [...options.comparisonModes]} : {}),
  }
  const json = (value: unknown) => JSON.stringify(value)
  return `import ${json(`${kit}/react.css`)}
import {mountRenderer} from ${json(`${kit}/react`)}
import * as view from ${json(path)}

// Each of these exports is optional, so the view's exports are looked up as an object.
const {View, default: fallback, options: viewOptions} = {...view}
const component = View ?? fallback
if (typeof component !== 'function')
  throw new Error(${json(`${options.view ?? path} exports no renderer component: export it as \`View\` or as the default export`)})
const renderer = mountRenderer(component, {
  ...viewOptions,
  name: ${json(options.name)},
  ${options.accepts ? `accepts: ${json(options.accepts)},\n  ` : ''}capabilities: ${json(capabilities)},
})
if (import.meta.hot) {
  import.meta.hot.dispose(() => renderer.unmount())
  import.meta.hot.accept()
}
`
}

/** Remounts an entry's renderer in place on a hot update: `mountRenderer` replaces an earlier mount in the document. */
const hotAccept = '\nif (import.meta.hot) import.meta.hot.accept()\n'

/**
 * The renderer's entry. With `view`, generates it (`rendererEntrySource`) as `rendererEntryId`, for the build and the
 * development server. With `entry`, the development server makes an entry module that calls `mountRenderer` accept
 * its own hot updates, unless it handles `import.meta.hot` itself, so an edit remounts the renderer in place instead
 * of reloading the frame.
 */
export function rendererEntryPlugin(options: Omit<RendererBuildOptions, 'outDir'>): Plugin {
  let root = ''
  let serve = false
  const file = (path: string) => resolveFile(root, path)
  return {
    name: 'projections-renderer-entry',
    configResolved(config) {
      root = config.root
      serve = config.command === 'serve'
    },
    buildStart() {
      const path = options.view ?? options.entry
      if (path && !file(path).exists) {
        this.error(`The renderer's ${options.view ? 'view' : 'entry'} ${path} doesn't exist (rendererConfig in vite.config.ts)`)
      }
    },
    resolveId(id) {
      return id === rendererEntryId || id === resolvedEntryId ? resolvedEntryId : null
    },
    load(id) {
      if (id !== resolvedEntryId) return null
      if (!options.view) return this.error(`${rendererEntryId} is generated for rendererConfig({view}) only`)
      return rendererEntrySource(file(options.view).path, options)
    },
    transform(code, id) {
      if (!serve || !options.entry || id.split('?')[0] !== file(options.entry).path) return null
      if (!/\bmountRenderer\s*\(/.test(code) || code.includes('import.meta.hot')) return null
      return {code: code + hotAccept, map: null}
    },
  }
}

/**
 * Where a running development server records itself, relative to the renderer
 * package: the runner reads it so a host page that can frame loopback loads the
 * renderer from the server instead of its built bundle.
 */
export const rendererDevServerFile = 'node_modules/.projections/renderer-dev-server.json'

/** Loopback origins only; a renderer frame's opaque origin is `null`. */
const loopback = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/

/**
 * Loads the renderer check probe from a local Inspector (a loopback host
 * origin), as the Inspector injects it into the bundles it serves, so its
 * renderer checks also run against a development server.
 */
const devProbeScript =
  "try{var o=new URLSearchParams(location.hash.slice(1)).get('origin');" +
  "if(o&&/^http:\\/\\/(localhost|127\\.0\\.0\\.1):\\d+$/.test(o)){var s=document.createElement('script');s.src=o+'/fixtures/probe.js';document.head.appendChild(s)}}catch(e){}"

/**
 * The renderer policy for a development page served from `origin`: the same
 * as a bundle's, except that scripts, styles and assets may come from the
 * development server, the page may connect to it for hot updates, and a local
 * Inspector's check probe may load.
 */
export function rendererDevContentSecurityPolicy(origin: string): string {
  const socket = origin.replace(/^http/, 'ws')
  return rendererMetaContentSecurityPolicy
    .split('; ')
    .map(directive => {
      const [name] = directive.split(' ')
      // A local Inspector's renderer check probe, served from its own loopback origin.
      if (name === 'script-src') return `${directive} ${origin} http://127.0.0.1:* http://localhost:*`
      if (name === 'style-src' || name === 'img-src' || name === 'font-src' || name === 'media-src') return `${directive} ${origin}`
      if (name === 'connect-src') return `connect-src ${origin} ${socket}`
      return directive
    })
    .join('; ')
}

/**
 * Serves the renderer during `vite` (development): `/` is a renderer document
 * that loads its entry (`entry`, or the one generated for `view`) as a module
 * with Vite's hot update client, under
 * `rendererDevContentSecurityPolicy`. Requests from a sandboxed frame (origin
 * `null`) and loopback pages may load modules; other sites may not. While the
 * server runs, `rendererDevServerFile` records its URL.
 */
export function rendererDevServerPlugin(options: Omit<RendererBuildOptions, 'outDir'>): Plugin {
  const manifest = (): RendererManifest => ({
    format: 'projections.renderer',
    version: 0,
    name: options.name,
    title: options.title,
    handles: options.handles ?? [],
    ...(options.comparisonModes ? {comparisonModes: [...options.comparisonModes]} : {}),
    ...(options.accepts ? {accepts: options.accepts.map(item => ({...item}))} : {}),
  })
  return {
    name: 'projections-renderer-dev-server',
    apply: 'serve',
    config: user => ({
      server: {
        cors: {origin: [loopback, 'null']},
        // Vite's watcher (chokidar 3) drops a change to a file within 50 ms of the last change it reported, so a
        // quick second write (an edit and its undo, a formatter after a save, an agent's consecutive edits) never
        // reached the page, which kept the earlier source. Waiting for writes to settle reports every change, with
        // the file's latest content, about 10 ms later. An author's own setting, or no watching, is kept.
        ...(user?.server?.watch === null || user?.server?.watch?.awaitWriteFinish !== undefined
          ? {}
          : {watch: {awaitWriteFinish: {stabilityThreshold: 10, pollInterval: 10}}}),
      },
      optimizeDeps: {
        // Find dependencies from the entry at startup: optimizing one found later
        // makes Vite reload the page, which a host treats as a renderer navigating its frame.
        entries: [(options.view ?? options.entry)!],
        // The generated entry imports the kit's React entry, which a view may use for its types only.
        ...(options.view && !options.kit ? {include: [`${defaultKit}/react`]} : {}),
        // Dependencies may inline files as text (`?raw`), as the renderer kit
        // inlines ELK's worker; Vite's dependency optimizer doesn't by itself.
        esbuildOptions: {
          plugins: [
            {
              name: 'projections-raw',
              setup(build) {
                build.onResolve({filter: /\?raw$/}, async args => {
                  const resolved = await build.resolve(args.path.slice(0, -'?raw'.length), {kind: args.kind, resolveDir: args.resolveDir})
                  return resolved.errors.length ? {errors: resolved.errors} : {path: resolved.path, namespace: 'projections-raw'}
                })
                build.onLoad({filter: /.*/, namespace: 'projections-raw'}, args => ({
                  contents: readText(args.path),
                  loader: 'text',
                }))
              },
            },
          ],
        },
      },
    }),
    configureServer(server) {
      let remove = () => {}
      server.httpServer?.once('listening', () => {
        const url = server.resolvedUrls?.local[0]
        if (!url) return
        remove = recordDevServer(server.config.root, rendererDevServerFile, {
          format: 'projections.renderer-dev-server',
          version: 0,
          url,
          name: options.name,
        })
        process.once('exit', () => remove())
      })
      server.httpServer?.once('close', () => remove())
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '/').split('?')[0]
        if (path === '/__projections/renderer.json') {
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify(manifest()))
          return
        }
        if (request.method !== 'GET' || (path !== '/' && path !== '/index.html')) return next()
        const host = request.headers.host ?? ''
        const origin = `http://${host}`
        if (!loopback.test(origin)) {
          response.statusCode = 403
          response.end('Renderer development servers serve loopback hosts only')
          return
        }
        const entry = options.view ? devEntryUrl : `/${options.entry!.replace(/^\.?\//, '')}`
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.setHeader('content-security-policy', rendererDevContentSecurityPolicy(origin))
        response.setHeader('cache-control', 'no-store')
        response.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escape(options.title)}</title>
<style>${preInitStyle}</style>
<script>${preInitScript}</script>
<script>${devProbeScript}</script>
<script type="module" src="/@vite/client"></script>
<script type="module" src="${escape(entry)}"></script>
</head>
<body>
<div id="root"></div>
</body>
</html>
`)
      })
    },
  }
}

/**
 * Lints the renderer's own stylesheets as they are built (`lintRendererStyles`): a `var(--projections-…)` that isn't a
 * theme token fails the build; hard-coded colors, font sizes and families and `!important` are reported as warnings.
 * The kit's and SDK's stylesheets, and installed packages', are left out: the renderer can't change them.
 */
export function rendererStyleLintPlugin(): Plugin {
  let root = ''
  const warnings: string[] = []
  return {
    name: 'projections-renderer-style-lint',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      root = config.root.replace(/\\/g, '/').replace(/\/?$/, '/')
    },
    buildStart() {
      warnings.length = 0
    },
    transform(code, id) {
      const file = id.split('?')[0]!.replace(/\\/g, '/')
      if (!/\.css$/.test(file) || /\/node_modules\/|\/renderers\/(?:kit|sdk)\//.test(file)) return null
      const name = file.startsWith(root) ? file.slice(root.length) : file
      const lint = lintRendererStyles(code, name)
      if (lint.errors.length) this.error(`Renderer styles use properties that aren't theme tokens:\n${lint.errors.join('\n')}`)
      warnings.push(...lint.warnings)
      return null
    },
    buildEnd() {
      if (!warnings.length) return
      const shown = warnings.slice(0, 20)
      this.warn(
        `${warnings.length} style${warnings.length === 1 ? '' : 's'} bypass the theme; the renderer checks (npm test) measure them as painted. ` +
          `Prefer the kit's components and token(…):\n${shown.join('\n')}${warnings.length > shown.length ? `\n… and ${warnings.length - shown.length} more` : ''}`,
      )
    },
  }
}

/**
 * Vite configuration for a renderer bundle: `dist/index.html`, one
 * self-contained document with the renderer's script (an IIFE) and styles
 * inline and every other asset inlined as a data URL, plus `dist/renderer.json`.
 * The renderer policy grants no source but inline code, so a renderer can't
 * request anything, not even files from its own bundle. `vite` (development)
 * serves the renderer with hot updates instead; see `rendererDevServerPlugin`.
 * The capabilities are declared here once: `renderer.json` and, with `view`,
 * the generated entry both take them from these options.
 *
 * ```ts
 * // vite.config.ts
 * import {defineConfig} from 'vite'
 * import {rendererConfig} from '@githubnext/projections/vite'
 * export default defineConfig(
 *   rendererConfig({view: 'src/view.tsx', name: 'flags', title: 'Feature flags', comparisonModes: ['diff', 'side-by-side']}),
 * )
 * ```
 */
export function rendererConfig(options: RendererBuildOptions): UserConfig {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.name)) throw new Error('Renderer name must be a lowercase identifier')
  if (!options.view === !options.entry) {
    throw new Error(
      options.view
        ? 'rendererConfig takes a view or an entry, not both: `view` generates the entry that mounts it'
        : 'rendererConfig needs a view (`view: "src/view.tsx"`, the usual) or an entry of your own (`entry: "src/main.tsx"`)',
    )
  }
  if (options.entry && (options.changeHighlighting || options.capabilities || options.kit)) {
    throw new Error(
      'changeHighlighting, capabilities and kit configure the entry rendererConfig generates for a view; an entry of your own declares its capabilities to mountRenderer',
    )
  }
  if (options.comparisonModes && !parseComparisonModes(options.comparisonModes)) {
    throw new Error('Renderer comparisonModes must be distinct comparison modes')
  }
  if (options.accepts && !parseAccepts(options.accepts)) {
    throw new Error('Renderer accepts must be distinct domain schemas, each with an optional vocabulary')
  }
  return {
    publicDir: false,
    define: {'process.env.NODE_ENV': JSON.stringify('production')},
    build: {
      outDir: options.outDir ?? 'dist',
      emptyOutDir: true,
      target: 'es2022',
      assetsInlineLimit: () => true,
      sourcemap: false,
      lib: {
        entry: options.view ? rendererEntryId : options.entry!,
        formats: ['iife'],
        name: 'ProjectionsRenderer',
        fileName: () => 'renderer.js',
        cssFileName: 'renderer',
      },
      // Vite resolves a library entry as a file under the root; the generated entry is a module id.
      rollupOptions: {...(options.view ? {input: rendererEntryId} : {}), output: {inlineDynamicImports: true}},
    },
    plugins: [rendererStyleLintPlugin(), rendererEntryPlugin(options), rendererBundlePlugin(options), rendererDevServerPlugin(options)],
  }
}
export {lintRendererStyles} from './style-lint.js'
export type {StyleLintResult} from './style-lint.js'
