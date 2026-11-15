import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {mergeNotices} from '@githubnext/projections-renderer-sdk/notices'

/**
 * Content security policy for every file of a renderer bundle. Keep in sync
 * with `rendererContentSecurityPolicy` in the renderer SDK protocol module.
 */
export const rendererContentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  'worker-src blob:',
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'sandbox allow-scripts',
].join('; ')

/** Response headers for a file served from a renderer bundle directory. */
export function rendererResponseHeaders(path) {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const types = {
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    woff2: 'font/woff2',
    wasm: 'application/wasm',
  }
  return {
    'content-type': types[extension] ?? 'application/octet-stream',
    'content-security-policy': rendererContentSecurityPolicy,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'cross-origin',
    'cache-control': 'no-store',
  }
}

const namePattern = /^[a-z0-9][a-z0-9-]{0,63}$/

const noticesTitle = 'Third-party software in the built-in renderer bundles (packages/renderers/*/index.html).'

/** A package's built renderer bundle directory, from `"projections": {"renderer": "dist"}`. */
async function bundleDirectory(name, require) {
  const manifestPath = require.resolve(`${name}/package.json`)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const relative = manifest.projections?.renderer
  if (typeof relative !== 'string') throw new Error(`${name} does not declare projections.renderer`)
  return resolve(dirname(manifestPath), relative)
}

async function bundleNotices(name, bundle) {
  return readFile(join(bundle, 'THIRD_PARTY_NOTICES.txt'), 'utf8').catch(() => {
    throw new Error(`${name} has no THIRD_PARTY_NOTICES.txt in ${bundle}; rebuild it with the current renderer SDK`)
  })
}

/**
 * The third-party notices of the renderer bundles in `packages`, merged so
 * each package version appears once. Pass `exclude` (package names) for
 * packages the including app's notices already list, such as React.
 *
 * @param {{packages: string[], from: string | URL, exclude?: Iterable<string>}} options
 */
export async function rendererNotices({packages, from, exclude = []}) {
  const require = createRequire(from)
  const texts = []
  for (const name of packages) texts.push(await bundleNotices(name, await bundleDirectory(name, require)))
  return mergeNotices(noticesTitle, texts, new Set(exclude))
}

/**
 * Copies built renderer bundles into `<outDir>/renderers/<name>/` and writes
 * `<outDir>/renderers/index.json` and `<outDir>/renderers/THIRD_PARTY_NOTICES.txt`
 * (every bundle's notices, merged). Each package declares its bundle
 * directory with `"projections": {"renderer": "dist"}`; the directory must
 * contain `index.html`, `renderer.json` and `THIRD_PARTY_NOTICES.txt`.
 *
 * @param {{packages: string[], outDir: string | URL, from: string | URL}} options
 *   `from` is the importing module URL, used to resolve the packages.
 */
export async function collectRenderers({packages, outDir, from}) {
  const require = createRequire(from)
  const target = resolve(outDir instanceof URL ? fileURLToPath(outDir) : outDir, 'renderers')
  await rm(target, {recursive: true, force: true})
  await mkdir(target, {recursive: true})
  const renderers = []
  const notices = []
  for (const name of packages) {
    const bundle = await bundleDirectory(name, require)
    const renderer = JSON.parse(
      await readFile(join(bundle, 'renderer.json'), 'utf8').catch(() => {
        throw new Error(`${name} has no built renderer bundle at ${bundle}; build it first`)
      }),
    )
    if (renderer.format !== 'projections.renderer' || renderer.version !== 0 || !namePattern.test(renderer.name)) {
      throw new Error(`${name} has an invalid renderer.json`)
    }
    await readFile(join(bundle, 'index.html'))
    notices.push(await bundleNotices(name, bundle))
    if (renderers.some(item => item.name === renderer.name)) throw new Error(`Duplicate renderer name ${renderer.name}`)
    await cp(bundle, join(target, renderer.name), {recursive: true, dereference: false, verbatimSymlinks: true})
    renderers.push(renderer)
  }
  await writeFile(join(target, 'index.json'), `${JSON.stringify({format: 'projections.renderers', version: 0, renderers}, null, 2)}\n`)
  await writeFile(join(target, 'THIRD_PARTY_NOTICES.txt'), mergeNotices(noticesTitle, notices))
  return renderers
}
