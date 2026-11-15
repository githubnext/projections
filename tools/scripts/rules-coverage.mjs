// The rule coverage gate of the built-in rules comparators (api-compatibility, runtime-policy): runs the rules
// interpreter's suites (packages/comparators/rules/tests) with PROJECTIONS_RULES_COVERAGE naming a scratch directory,
// where they write what each comparison covered, then packages/cli/tests/rules_coverage.rs, which runs each
// comparator's *.comparator.test.yaml with coverage, adds the suites' counts, prints what is uncovered by line and holds
// each comparator to its gate. Needs the built comparator modules (npm run build). npm run test:rust runs it.
import {spawnSync} from 'node:child_process'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const directory = mkdtempSync(join(tmpdir(), 'projections-rules-coverage-'))
const env = {...process.env, PROJECTIONS_RULES_COVERAGE: directory}

const run = args => {
  const result = spawnSync('cargo', args, {cwd: root, env, stdio: 'inherit'})
  if (result.status !== 0) {
    rmSync(directory, {recursive: true, force: true})
    process.exit(result.status ?? 1)
  }
}

try {
  run(['test', '--locked', '-p', 'projections-comparator-rules'])
  run(['test', '--locked', '-p', 'projections-cli', '--test', 'rules_coverage', '--', '--nocapture'])
} finally {
  rmSync(directory, {recursive: true, force: true})
}
