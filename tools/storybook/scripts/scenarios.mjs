// Reads every renderer's scenarios.json (projections.scenarios v0) into stories' fixtures, with each extraction inlined.
import {existsSync} from 'node:fs'
import {readFile, readdir} from 'node:fs/promises'
import {basename, dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
/** Directories whose children may hold a renderer package with scenarios. */
const parents = ['packages/renderers', 'examples/renderers']

/** Every scenarios.json, sorted by package directory name. */
export async function scenarioFiles() {
  const files = []
  for (const parent of parents) {
    for (const entry of await readdir(join(root, parent), {withFileTypes: true})) {
      const path = join(root, parent, entry.name, 'scenarios.json')
      if (entry.isDirectory() && existsSync(path)) files.push(path)
    }
  }
  return files.sort((a, b) => basename(dirname(a)).localeCompare(basename(dirname(b))))
}

/** The served path of a comparator module named by a scenario. */
export const comparatorAsset = path => `comparators/${basename(path)}`

/**
 * Every scenario as a story fixture: `key` is `<package directory>/<scenario id>`, extractions are inlined (an
 * extraction document contributes its `extraction`), comparator modules are renamed to their served path and
 * `comparators` maps each served path to its file.
 */
export async function loadScenarios() {
  const scenarios = []
  const files = []
  const comparators = new Map()
  for (const file of await scenarioFiles()) {
    files.push(file)
    const directory = dirname(file)
    const document = JSON.parse(await readFile(file, 'utf8'))
    if (document.format !== 'projections.scenarios' || document.version !== 0) {
      throw new Error(`${file} is not a projections.scenarios v0 document`)
    }
    const extraction = async value => {
      if (typeof value !== 'string') return value
      const path = resolve(directory, value)
      files.push(path)
      const parsed = JSON.parse(await readFile(path, 'utf8'))
      return parsed.format === 'projections.extraction' ? parsed.extraction : parsed
    }
    const name = basename(directory)
    for (const scenario of document.scenarios) {
      const fixture = {
        key: `${name}/${scenario.id}`,
        package: name,
        id: scenario.id,
        title: scenario.title,
        group: scenario.group ?? document.title ?? name,
        ...(scenario.description ? {description: scenario.description} : {}),
        renderer: scenario.renderer ?? document.renderer,
        ...(scenario.presentation ? {presentation: scenario.presentation} : {}),
      }
      if (scenario.extraction !== undefined) fixture.extraction = await extraction(scenario.extraction)
      else {
        fixture.before = await extraction(scenario.before)
        fixture.after = await extraction(scenario.after)
      }
      // A string or an object with `file` names a comparator file; an object without `file` is the default comparator.
      const comparatorFile = typeof scenario.comparator === 'string' ? scenario.comparator : scenario.comparator?.file
      if (comparatorFile) {
        const served = comparatorAsset(comparatorFile)
        const path = resolve(directory, comparatorFile)
        if (comparators.has(served) && comparators.get(served) !== path) throw new Error(`Two comparator files are named ${served}`)
        comparators.set(served, path)
        fixture.comparator = {file: served, ...(scenario.comparator.options ? {options: scenario.comparator.options} : {})}
      } else if (scenario.comparator) fixture.comparator = scenario.comparator
      scenarios.push(fixture)
    }
  }
  return {scenarios, files, comparators}
}

const virtualId = 'virtual:projections-scenarios'

/** Serves `virtual:projections-scenarios` (the fixtures) to the stories and reloads them when a scenario file changes. */
export function scenariosPlugin() {
  return {
    name: 'projections-scenarios',
    resolveId(source) {
      return source === virtualId ? `\0${virtualId}` : undefined
    },
    async load(id) {
      if (id !== `\0${virtualId}`) return undefined
      const {scenarios, files} = await loadScenarios()
      for (const file of files) this.addWatchFile(file)
      return `export default ${JSON.stringify(scenarios)}`
    },
  }
}
