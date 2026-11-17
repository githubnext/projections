import assert from 'node:assert/strict'
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import test from 'node:test'
import {build, createServer} from 'vite'
import {
  rendererConfig,
  rendererDevContentSecurityPolicy,
  rendererDevServerFile,
  rendererDevServerPlugin,
  rendererEntryId,
  rendererEntrySource,
} from '../dist/vite.js'
import {rendererMetaContentSecurityPolicy} from '../dist/protocol.js'

test('a development page keeps the renderer policy, adding only its server and a local probe', () => {
  const policy = rendererDevContentSecurityPolicy('http://localhost:5173')
  const directives = Object.fromEntries(policy.split('; ').map(directive => [directive.split(' ')[0], directive]))
  const bundle = Object.fromEntries(rendererMetaContentSecurityPolicy.split('; ').map(directive => [directive.split(' ')[0], directive]))
  assert.deepEqual(Object.keys(directives), Object.keys(bundle))
  assert.equal(directives['connect-src'], 'connect-src http://localhost:5173 ws://localhost:5173')
  assert.equal(directives['script-src'], `${bundle['script-src']} http://localhost:5173 http://127.0.0.1:* http://localhost:*`)
  assert.equal(directives['style-src'], `${bundle['style-src']} http://localhost:5173`)
  for (const name of ['default-src', 'object-src', 'frame-src', 'base-uri', 'form-action', 'worker-src'])
    assert.equal(directives[name], bundle[name])
  assert.ok(!policy.includes('sandbox'), 'the host frame applies the sandbox')
})

test('the development server accepts sandboxed frames and loopback pages only, and finds dependencies at startup', () => {
  const plugin = rendererDevServerPlugin({entry: 'src/main.tsx', name: 'flags', title: 'Flags'})
  assert.equal(plugin.apply, 'serve')
  const config = plugin.config()
  const [loopback, opaque] = config.server.cors.origin
  assert.equal(opaque, 'null')
  assert.ok(loopback.test('http://localhost:5173') && loopback.test('http://127.0.0.1:4000'))
  assert.ok(!loopback.test('https://example.com') && !loopback.test('http://localhost.example.com'))
  assert.deepEqual(config.optimizeDeps.entries, ['src/main.tsx'])
  assert.equal(rendererDevServerFile, 'node_modules/.projections/renderer-dev-server.json')
})

test('a renderer config takes a view or an entry, and capabilities only for a view', () => {
  const base = {name: 'flags', title: 'Flags'}
  assert.throws(() => rendererConfig(base), /needs a view/)
  assert.throws(() => rendererConfig({...base, view: 'src/view.tsx', entry: 'src/main.tsx'}), /not both/)
  assert.throws(
    () => rendererConfig({...base, entry: 'src/main.tsx', changeHighlighting: 'none'}),
    /declares its capabilities to mountRenderer/,
  )
  const config = rendererConfig({...base, view: 'src/view.tsx'})
  assert.equal(config.build.lib.entry, rendererEntryId)
  assert.equal(config.build.rollupOptions.input, rendererEntryId)
  assert.deepEqual(
    config.plugins.map(plugin => plugin.name),
    ['projections-renderer-style-lint', 'projections-renderer-entry', 'projections-renderer-bundle', 'projections-renderer-dev-server'],
  )
  const server = rendererDevServerPlugin({...base, view: 'src/view.tsx'}).config()
  assert.deepEqual(server.optimizeDeps.entries, ['src/view.tsx'])
  assert.deepEqual(server.optimizeDeps.include, ['@githubnext/projections/kit/react'], "the generated entry imports the kit's React entry")
})

test('the generated entry mounts the view with the capabilities the config declares', () => {
  const source = rendererEntrySource('/repo/src/view.tsx', {
    name: 'flags',
    title: 'Flags',
    comparisonModes: ['diff', 'side-by-side'],
    capabilities: {drawsRelationships: false},
    accepts: [{schema: 'graph'}],
  })
  assert.match(source, /^import "@githubnext\/projections\/kit\/react\.css"$/m)
  assert.match(source, /^import \{mountRenderer\} from "@githubnext\/projections\/kit\/react"$/m)
  assert.match(source, /^import \* as view from "\/repo\/src\/view\.tsx"$/m)
  assert.match(source, /= \{\.\.\.view\}\nconst component = View \?\? fallback$/m)
  assert.match(source, /accepts: \[\{"schema":"graph"\}\]/)
  assert.match(
    source,
    /capabilities: \{"drawsRelationships":false,"changeHighlighting":"supported","comparisonModes":\["diff","side-by-side"\]\}/,
  )
  assert.match(source, /import\.meta\.hot\.dispose\(\(\) => renderer\.unmount\(\)\)/)
})

/** A renderer package whose kit is a stub that records how it was mounted. */
function stubRenderer(files) {
  // Vite serves modules under a root reached through a symbolic link (macOS's /var) untransformed.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'projections-vite-')))
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), {recursive: true})
    writeFileSync(join(root, path), text)
  }
  write(
    'kit/react.js',
    'export function mountRenderer(component, options) { globalThis.mounted = {component, options}; return {unmount() {}} }\n',
  )
  write('kit/react.css', '.pk { display: block }\n')
  for (const [path, text] of Object.entries(files)) write(path, text)
  return root
}

test('the development server serves an edit written straight after another, as an undo is', async () => {
  const root = stubRenderer({'src/view.js': 'export const label = "Payments"\n'})
  const view = join(root, 'src/view.js')
  const server = await createServer({
    ...rendererConfig({name: 'flags', title: 'Flags', view: 'src/view.js', kit: join(root, 'kit').replace(/\\/g, '/')}),
    root,
    configFile: false,
    logLevel: 'silent',
  })
  try {
    await server.listen(0)
    const served = async () => (await fetch(`${server.resolvedUrls.local[0]}src/view.js`)).text()
    assert.match(await served(), /"Payments"/)
    while (!server.watcher.getWatched()[dirname(view)]?.includes('view.js')) await new Promise(resolve => setTimeout(resolve, 10))
    const changed = () =>
      new Promise((resolve, reject) => {
        const missed = setTimeout(() => reject(new Error('The development server missed a write to the view')), 5_000)
        server.watcher.once('change', () => resolve(clearTimeout(missed)))
      })
    let change = changed()
    writeFileSync(view, 'export const label = "PAYMENTS"\n')
    await change
    assert.match(await served(), /"PAYMENTS"/)
    // Within the 50 ms after a change in which Vite's watcher reports no other change to the file by default.
    change = changed()
    writeFileSync(view, 'export const label = "Payments"\n')
    await change
    assert.match(await served(), /"Payments"/)
  } finally {
    await server.close()
    rmSync(root, {recursive: true, force: true})
  }
})

test('a view builds into the bundle with renderer.json from the same config', async () => {
  const root = stubRenderer({
    'src/view.js': 'export const options = {nouns: {a: false}}\nexport default function View() { return "view" }\n',
  })
  try {
    const config = rendererConfig({
      view: 'src/view.js',
      name: 'flags',
      title: 'Flags',
      comparisonModes: ['diff', 'side-by-side'],
      kit: join(root, 'kit').replace(/\\/g, '/'),
    })
    await build({...config, root, configFile: false, logLevel: 'silent'})
    const html = readFileSync(join(root, 'dist/index.html'), 'utf8')
    assert.match(html, /\.pk\s*\{\s*display:\s*block/, "the kit's styles are inlined")
    const script = html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'))
    new Function(script)()
    const {component, options} = globalThis.mounted
    assert.equal(component(), 'view', 'the default export')
    assert.deepEqual(options, {
      nouns: {a: false},
      name: 'flags',
      capabilities: {changeHighlighting: 'supported', comparisonModes: ['diff', 'side-by-side']},
    })
    const manifest = JSON.parse(readFileSync(join(root, 'dist/renderer.json'), 'utf8'))
    assert.deepEqual(manifest.comparisonModes, ['diff', 'side-by-side'])
  } finally {
    delete globalThis.mounted
    rmSync(root, {recursive: true, force: true})
  }
})

test('a missing view fails the build, naming it', async () => {
  const root = stubRenderer({})
  try {
    const config = rendererConfig({view: 'src/view.tsx', name: 'flags', title: 'Flags', kit: join(root, 'kit')})
    await assert.rejects(build({...config, root, configFile: false, logLevel: 'silent'}), /view src\/view\.tsx doesn't exist/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('the development server serves the generated entry, and makes a mounting entry accept hot updates', async () => {
  const root = stubRenderer({
    'src/view.js': 'export function View() { return null }\n',
    'src/main.js': "import {mountRenderer} from '../kit/react.js'\nmountRenderer(() => null, {name: 'flags', capabilities: {}})\n",
    'src/hot.js':
      "import {mountRenderer} from '../kit/react.js'\nmountRenderer(() => null, {name: 'flags', capabilities: {}})\nimport.meta.hot?.accept()\n",
  })
  const serve = async options => {
    const server = await createServer({
      ...rendererConfig({name: 'flags', title: 'Flags', ...options}),
      root,
      configFile: false,
      logLevel: 'silent',
    })
    await server.listen(0)
    const origin = server.resolvedUrls.local[0].replace(/\/$/, '')
    const text = async path => (await fetch(`${origin}${path}`)).text()
    return {server, text}
  }
  try {
    const generated = await serve({view: 'src/view.js', kit: join(root, 'kit').replace(/\\/g, '/')})
    try {
      const page = await generated.text('/')
      assert.match(page, /<script type="module" src="\/@id\/__x00__virtual:projections-renderer-entry"><\/script>/)
      const entry = await generated.text('/@id/__x00__virtual:projections-renderer-entry')
      assert.match(entry, /src\/view\.js/)
      assert.match(entry, /mountRenderer\(component/)
      assert.match(entry, /import\.meta\.hot\.accept\(\)/)
    } finally {
      await generated.server.close()
    }
    const own = await serve({entry: 'src/main.js'})
    try {
      assert.match(await own.text('/src/main.js'), /if \(import\.meta\.hot\) import\.meta\.hot\.accept\(\)/)
      const hot = await own.text('/src/hot.js')
      assert.equal(hot.match(/import\.meta\.hot/g).length, 2, "Vite's hot context and the accept, nothing added")
    } finally {
      await own.server.close()
    }
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
