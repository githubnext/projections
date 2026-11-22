import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {scenarioKeys} from '@githubnext/projections-renderer-testing/playwright'

const renderers = new URL('../../', import.meta.url)

/** Every built-in renderer scenario: its key, package directory and whether it names a custom comparator. */
export const scenarios = readdirSync(renderers)
  .toSorted()
  .filter(name => existsSync(new URL(`${name}/scenarios.json`, renderers)))
  .flatMap(name => {
    const path = new URL(`${name}/scenarios.json`, renderers)
    const document = JSON.parse(readFileSync(path, 'utf8')) as {scenarios: {id: string; comparator?: {rules?: string}}[]}
    return scenarioKeys(path.pathname).map((key, index) => ({
      key,
      directory: name,
      customComparator: !!document.scenarios[index]?.comparator?.rules,
    }))
  })
