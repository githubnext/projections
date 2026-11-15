import {existsSync} from 'node:fs'
import {startInspector} from '@githubnext/projections-renderer-testing/playwright'
import {cli, inspectorArguments} from '../scripts/inspector.mjs'

/** Each Playwright invocation owns one fixtures workbench (`serve --stdio --fixtures` behind a page on an OS-assigned loopback port). */
export default async function setup() {
  if (!existsSync(cli)) throw new Error(`Build the native CLI first (npm run build at the workspace root): ${cli}`)
  const {fixtures, bundles, unbuilt} = inspectorArguments()
  if (unbuilt.length) console.warn(`Renderer harness: not built, using the Inspector's copies (run npm run build): ${unbuilt.join(', ')}`)
  const inspector = await startInspector({cli, fixtures, renderers: bundles})
  process.env.PROJECTIONS_HARNESS_URL = inspector.url
  return inspector.close
}
