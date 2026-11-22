#!/usr/bin/env node
/*
 * projections-renderer-workbench: the fixtures workbench in a browser, for developing a renderer or comparator on
 * scenario fixtures with live reload (and hot updates from a renderer's running development server) and the
 * built-in checks.
 *
 *   projections-renderer-workbench --fixtures scenarios.json --renderer . [--port 4400] [--cli path/to/projections]
 */
import {parseArgs} from 'node:util'
import {startInspector} from './server.js'

const {values} = parseArgs({
  options: {
    fixtures: {type: 'string', multiple: true},
    renderer: {type: 'string', multiple: true},
    port: {type: 'string'},
    cli: {type: 'string'},
    help: {type: 'boolean', short: 'h'},
  },
})
if (values.help || !values.fixtures || values.fixtures.length === 0) {
  console.log(
    'Usage: projections-renderer-workbench --fixtures <scenarios.json or directory>... [--renderer <bundle or package>...] [--port N] [--cli path]',
  )
  process.exit(values.help ? 0 : 2)
}
const port = values.port === undefined ? undefined : Number(values.port)
if (port !== undefined && !(Number.isInteger(port) && port >= 0 && port < 65536)) throw new Error(`Invalid --port: ${values.port}`)
const workbench = await startInspector({
  fixtures: values.fixtures,
  ...(values.renderer ? {renderers: values.renderer} : {}),
  ...(port === undefined ? {} : {port}),
  ...(values.cli ? {cli: values.cli} : {}),
})
console.log(workbench.url)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void workbench.close().then(() => process.exit(0))
  })
}
