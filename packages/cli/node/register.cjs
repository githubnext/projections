// Preloaded (`node --require`) into a custom extractor that the runner runs with `node`, so that
// `import {request, result} from '@githubnext/projections/extractor'` loads the module beside this file, the one this
// Projections ships, with nothing installed. That one specifier resolves here, ahead of an installed package, as the
// Python module comes first on PYTHONPATH; every other import resolves as usual. See packages/cli/src/node.rs.
'use strict'
/* eslint-disable @typescript-eslint/no-require-imports -- Node preloads this with --require, before any ES module loads */
const module_ = require('node:module')
const {join} = require('node:path')
const {pathToFileURL} = require('node:url')

const specifier = '@githubnext/projections/extractor'
const url = pathToFileURL(join(__dirname, 'extractor.mjs')).href

if (typeof module_.registerHooks === 'function') {
  module_.registerHooks({
    resolve: (request, context, nextResolve) => (request === specifier ? {url, shortCircuit: true} : nextResolve(request, context)),
  })
} else if (typeof module_.register === 'function') {
  // Before Node 22.15, hooks run off the main thread (hooks.mjs).
  module_.register(pathToFileURL(join(__dirname, 'hooks.mjs')), {data: {specifier, url}})
}
