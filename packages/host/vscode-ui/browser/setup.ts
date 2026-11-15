import {startStorybookServer} from '../../../../tools/storybook/scripts/serve.mjs'

/** Each browser invocation owns a static server for the built Storybook (whose harness stories this suite drives) on an OS-assigned loopback port. */
export default async function setup() {
  const server = await startStorybookServer()
  process.env.PROJECTIONS_STORYBOOK_URL = server.url
  console.log(`Owned Storybook server: ${server.url}`)
  return server.close
}
