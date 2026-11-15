// Prepares Storybook's static directory: renderer bundles, the comparator Worker, scenario comparator files and test renderers.
import {copyFile, cp, mkdir, rm} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {collectRenderers} from '@githubnext/projections-host/build'
import {loadScenarios} from './scenarios.mjs'

/** Generated; served at the Storybook root (`staticDirs`), so stories resolve `renderers/` and the rest from `iframe.html`. */
export const staticDirectory = fileURLToPath(new URL('../static/', import.meta.url))

/** The built-in renderer bundles the stories present, plus the example template. */
export const rendererPackages = [
  'graph',
  'file-packing',
  'dependency-injection',
  'code-statistics',
  'api',
  'database',
  'runtime-policy',
  'text-diff',
]
  .map(name => `@githubnext/projections-renderer-${name}`)
  .concat('@githubnext/projections-example-renderer-minimal')

/** Prepares the static directory: this Storybook's, or `directory` (ending in a slash) for another Storybook built on these stories' helpers. */
export async function prepareStatic(directory = staticDirectory) {
  await rm(directory, {recursive: true, force: true})
  await mkdir(directory, {recursive: true})
  await collectRenderers({packages: rendererPackages, outDir: directory, from: import.meta.url})
  // The brand mark and favicon for Storybook's sidebar and browser tab.
  for (const name of ['projections-mark-two-tone.svg', 'favicon.svg'])
    await copyFile(fileURLToPath(new URL(`../../../brand/${name}`, import.meta.url)), `${directory}${name}`)
  // The codicon font and stylesheet the VS Code UI's stories link as `vscode-codicon-stylesheet` (VSCode Elements' icons read it).
  await cp(
    fileURLToPath(new URL('./dist/codicons/', import.meta.resolve('@githubnext/projections-host-vscode/package.json'))),
    `${directory}codicons/`,
    {recursive: true},
  )
  // Misbehaving renderers for the host's browser suites (served like custom bundles, with the renderer policy).
  await cp(fileURLToPath(new URL('../test-renderers/', import.meta.url)), `${directory}test-renderers/`, {recursive: true})
  // The comparator runtime's Worker is served as plain same-origin modules, not bundled.
  const runtime = new URL('./', import.meta.resolve('@githubnext/projections-comparator-runtime/browser'))
  await mkdir(`${directory}comparator`, {recursive: true})
  for (const name of ['worker-entry.js', 'execute.js', 'abi.js', 'rules.wasm'])
    await copyFile(new URL(name, runtime), `${directory}comparator/${name}`)
  // Scenario comparator files; the rules runtime computes each one's digest when it checks it.
  const {comparators} = await loadScenarios()
  const priority = fileURLToPath(new URL('../../../examples/comparators/priority-order/priority-order.comparator.yaml', import.meta.url))
  comparators.set('comparators/priority-order.comparator.yaml', priority)
  await mkdir(`${directory}comparators`, {recursive: true})
  for (const [served, path] of comparators) await copyFile(path, `${directory}${served}`)
  return directory
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`Storybook static assets: ${await prepareStatic()}`)
