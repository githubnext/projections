// The renderer gallery: the fixtures workbench over every built-in renderer's
// scenarios and bundle, with live reload and the built-in checks.
// Usage: npm run gallery -w @githubnext/projections-renderer-harness [-- --port 4400]
import {existsSync} from 'node:fs'
import {parseArgs} from 'node:util'
import {startInspector} from '@githubnext/projections-renderer-testing/playwright'
import {cli, inspectorArguments} from './inspector.mjs'

if (!existsSync(cli)) throw new Error(`Build the native CLI first (npm run build at the workspace root): ${cli}`)
const {values} = parseArgs({options: {port: {type: 'string'}}})
const {fixtures, bundles, unbuilt} = inspectorArguments()
if (unbuilt.length) console.warn(`Renderer gallery: not built, using the Inspector's copies (run npm run build): ${unbuilt.join(', ')}`)
const gallery = await startInspector({cli, fixtures, renderers: bundles, ...(values.port ? {port: Number(values.port)} : {})})
console.log(gallery.url)
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void gallery.close().then(() => process.exit(0)))
