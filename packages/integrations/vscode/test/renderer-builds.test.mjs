// Unit tests of custom renderer builds on save (`renderer-build-model.ts`): which package builds a renderer, which saved
// files are its sources, and how the Renderer row says the build's state (the backend reads the output); loaded from source with Node's type stripping.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {buildRow, isRendererSource, rendererPackage, rendererSources} from '../src/renderer-build-model.ts'

const scaffolded = {
  id: 'flags',
  extractor: 'x',
  renderer: {
    bundle: '.github/projections/flags/renderer/dist',
    sources: ['.github/projections/flags/renderer/src', '.github/projections/flags/renderer/package.json'],
  },
}

test("a custom renderer's package and sources, as init --renderer custom scaffolds them", () => {
  assert.equal(rendererPackage(scaffolded), '.github/projections/flags/renderer')
  assert.equal(rendererPackage({id: 'a', extractor: 'x', renderer: 'graph'}), undefined)
  // A bundle that isn't a package's dist has no package to build.
  assert.equal(rendererPackage({id: 'a', extractor: 'x', renderer: {bundle: 'vendor/cards.html'}}), undefined)
  assert.equal(rendererPackage({id: 'a', extractor: 'x', renderer: {bundle: '../outside/dist'}}), undefined)
  assert.deepEqual(rendererSources({id: 'a', extractor: 'x', renderer: {bundle: 'cards/dist'}}), ['cards/src'])

  assert.ok(isRendererSource(scaffolded, '.github/projections/flags/renderer/src/view.tsx'))
  assert.ok(isRendererSource(scaffolded, '.github/projections/flags/renderer/package.json'))
  assert.ok(!isRendererSource(scaffolded, '.github/projections/flags/renderer/dist/index.html'))
  assert.ok(!isRendererSource(scaffolded, '.github/projections/flags/extract.mjs'))
  // A source directory that holds the package: never its dependencies or build output.
  const whole = {id: 'b', extractor: 'x', renderer: {bundle: 'cards/dist', sources: ['cards']}}
  assert.ok(isRendererSource(whole, 'cards/vite.config.ts'))
  assert.ok(!isRendererSource(whole, 'cards/node_modules/react/index.js'))
  assert.ok(!isRendererSource(whole, 'cards/dist/renderer.json'))
})

test("the Renderer row's words", () => {
  assert.deepEqual(buildRow({phase: 'building', script: 'watch', package: 'cards'}).description, 'building')
  assert.equal(buildRow({phase: 'building'}).icon, 'loading~spin')
  assert.equal(buildRow({phase: 'built'}).description, 'built')
  const failed = buildRow({phase: 'failed', script: 'watch', package: 'cards', error: 'Expected ";"'})
  assert.equal(failed.description, 'build failed')
  assert.match(failed.detail, /npm run watch.*cards/)
  assert.match(failed.detail, /Expected ";"/)
  assert.match(buildRow({phase: 'untrusted', script: 'watch'}).detail, /trust the workspace/)
})
