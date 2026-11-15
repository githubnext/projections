// Validates every comparator file (`*.comparator.yaml`) in the repository, the interpreter's own test rules, and
// every comparator example in the docs (a YAML block whose first line names a `.comparator.yaml` file), against the published schema (packages/schemas/schemas/comparator/v0.json), as an
// editor's YAML language server would, then checks each with the built rules interpreter and fails on any
// diagnostic or lint warning (such as a chain of three conditionals): npm run check:comparators, after npm run build.
// Every comparator test file (`*.comparator.test.yaml`), and every docs example naming one, is validated against
// packages/schemas/schemas/comparator-tests/v0.json; the CLI runs them (cargo test -p projections-cli --test comparator_tests).
// Directories given as arguments are validated instead, the same way (for comparator files kept outside this workspace).
import {readFileSync, readdirSync, statSync} from 'node:fs'
import {join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import Ajv from 'ajv/dist/2020.js'
import {parse} from 'yaml'
import {RulesError, createRulesRuntime} from '../../runtime/js/dist/node.js'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const schema = JSON.parse(readFileSync(new URL('../../../schemas/schemas/comparator/v0.json', import.meta.url), 'utf8'))
const ajv = new Ajv({allErrors: true, strict: true, strictRequired: false})
const validate = ajv.compile(schema)
const validateTests = ajv.compile(
  JSON.parse(readFileSync(new URL('../../../schemas/schemas/comparator-tests/v0.json', import.meta.url), 'utf8')),
)
const files = []
const tests = []
const walk = dir => {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'target', 'dist', '.git'].includes(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.comparator\.test\.ya?ml$/.test(name)) tests.push(path)
    else if (/\.comparator\.ya?ml$/.test(name) || (dir.includes(join('comparators', 'rules')) && name.endsWith('.yaml'))) files.push(path)
  }
}
const only = process.argv.slice(2).map(dir => resolve(dir))
for (const dir of only.length ? only : ['packages/comparators', 'examples', 'packages/cli/templates'].map(dir => join(root, dir))) walk(dir)
const display = path => relative(only.length ? process.cwd() : root, path)
const documents = files.sort().map(path => [display(path), readFileSync(path, 'utf8')])
const testDocuments = tests.sort().map(path => [display(path), readFileSync(path, 'utf8')])
const docs = []
const walkDocs = dir => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walkDocs(path)
    else if (name.endsWith('.md')) docs.push(path)
  }
}
if (!only.length) walkDocs(join(root, 'docs'))
for (const path of only.length ? [] : [...docs.sort(), join(root, 'packages/cli/templates/SKILL.md')]) {
  const text = readFileSync(path, 'utf8')
  for (const match of text.matchAll(/```yaml\n(# [^\n]*\.comparator\.ya?ml\n[\s\S]*?)```/g)) {
    // Excerpts (`...`) aren't whole files.
    if (!match[1].includes('\n...') && !match[1].includes(': ...')) {
      documents.push([`${path.slice(root.length)} (${match[1].split('\n')[0].slice(2)})`, match[1]])
    }
  }
  for (const match of text.matchAll(/```yaml\n(# [^\n]*\.comparator\.test\.ya?ml\n[\s\S]*?)```/g)) {
    if (!match[1].includes('\n...') && !match[1].includes(': ...')) {
      testDocuments.push([`${path.slice(root.length)} (${match[1].split('\n')[0].slice(2)})`, match[1]])
    }
  }
}
const runtime = createRulesRuntime()
let failed = false
for (const [name, text] of testDocuments) {
  if (validateTests(parse(text))) {
    console.log(`ok ${name}`)
  } else {
    failed = true
    console.error(`invalid ${name}: ${JSON.stringify(validateTests.errors, null, 2)}`)
  }
}
for (const [name, text] of documents) {
  if (!validate(parse(text))) {
    failed = true
    console.error(`invalid ${name}: ${JSON.stringify(validate.errors, null, 2)}`)
    continue
  }
  try {
    const {warnings} = await runtime.check(new TextEncoder().encode(text))
    if (warnings.length === 0) {
      console.log(`ok ${name}`)
      continue
    }
    failed = true
    for (const warning of warnings) console.error(`${name}: warning: ${warning.code} at ${warning.path || '/'}: ${warning.message}`)
  } catch (error) {
    failed = true
    if (!(error instanceof RulesError)) throw error
    for (const item of error.diagnostics) console.error(`${name}: ${item.code} at ${item.path || '/'}: ${item.message}`)
  }
}
if (failed) process.exit(1)
