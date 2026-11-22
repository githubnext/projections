// Writes package.json's `languageModelTools` from the CLI's agent tools (`serve --stdio`'s `tools/list`), so VS Code's
// agent gets the same tools, descriptions and schemas as `projections mcp`. `--check` fails when they differ instead;
// test/tools.test.mjs checks the same. Uses ../../cli/dist/projections, or PROJECTIONS_CLI.
import {readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {isDeepStrictEqual} from 'node:util'
import {contribution} from '../src/agent-tools.ts'
import {startRunner} from '../src/runner.ts'

const noop = () => undefined

const root = fileURLToPath(new URL('../', import.meta.url))
export const cli = process.env.PROJECTIONS_CLI ?? fileURLToPath(new URL('../../../cli/dist/projections', import.meta.url))
const manifest = `${root}package.json`

/** The contributions for the CLI's tools, asked of a backend started in this checkout. */
export async function contributions(executable = cli) {
  const runner = await startRunner({executable, repository: root, trust: false, log: noop})
  try {
    return (await runner.tools()).map(contribution)
  } finally {
    runner.stop()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tools = await contributions()
  const pkg = JSON.parse(await readFile(manifest, 'utf8'))
  if (process.argv.includes('--check')) {
    if (!isDeepStrictEqual(pkg.contributes.languageModelTools, tools)) {
      console.error('package.json languageModelTools differ from the CLI tools: run node scripts/tools.mjs')
      process.exit(1)
    }
  } else {
    pkg.contributes.languageModelTools = tools
    await writeFile(manifest, `${JSON.stringify(pkg, null, 2)}\n`)
    console.log(`Wrote ${tools.length} languageModelTools to package.json`)
  }
}
