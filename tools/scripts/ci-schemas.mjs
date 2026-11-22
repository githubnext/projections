#!/usr/bin/env node
// Writes the JSON Schemas of CI's rules file and of the planner's table of cases, from their TypeBox sources, so editors
// complete and check them:
//
//   .github/ci-rules.schema.json            from tools/cli/src/lib/ci-rules.schema.ts
//   tools/cli/test/ci-plan.cases.schema.json  from tools/cli/src/lib/ci-plan-cases.schema.ts
//
//   node tools/scripts/ci-schemas.mjs           write them
//   node tools/scripts/ci-schemas.mjs --check   fail if one differs from what its source generates
//
// TypeBox writes each use of a recursive type with its own `$defs` and bare `$ref`s; this hoists the definitions to the
// root and makes the references JSON pointers, which every JSON Schema tool resolves.
import {readFileSync, writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {CiPlanCases} from '../cli/src/lib/ci-plan-cases.schema.ts'
import {CiRules} from '../cli/src/lib/ci-rules.schema.ts'

const schemas = [
  {title: 'CI rules', source: CiRules, output: '../../.github/ci-rules.schema.json'},
  {title: 'CI plan cases', source: CiPlanCases, output: '../cli/test/ci-plan.cases.schema.json'},
]

function generate(title, source) {
  const defs = {}
  const hoist = value => {
    if (Array.isArray(value)) return value.map(hoist)
    if (!value || typeof value !== 'object') return value
    if (value.$defs && typeof value.$ref === 'string') {
      // Each definition's `$id` (its name) would make the references inside it relative to it.
      for (const [name, {$id, ...definition}] of Object.entries(value.$defs)) defs[name] = hoist(definition)
      const {$defs, $ref, ...rest} = value
      return {...hoist(rest), $ref: `#/$defs/${$ref}`}
    }
    if (typeof value.$ref === 'string' && !value.$ref.startsWith('#')) return {...value, $ref: `#/$defs/${value.$ref}`}
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hoist(item)]))
  }
  // eslint-disable-next-line unicorn/prefer-structured-clone -- the schema's JSON form, not a clone: drops TypeBox's non-JSON keys and undefined values
  const root = hoist(JSON.parse(JSON.stringify(source)))
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title,
    ...root,
    ...(Object.keys(defs).length ? {$defs: defs} : {}),
  }
  return `${JSON.stringify(schema, null, 2)}\n`
}

let stale = false
for (const {title, source, output} of schemas) {
  const path = fileURLToPath(new URL(output, import.meta.url))
  const text = generate(title, source)
  if (!process.argv.includes('--check')) writeFileSync(path, text)
  else if (readFileSync(path, 'utf8') !== text) {
    console.error(`${path} is stale: run node tools/scripts/ci-schemas.mjs`)
    stale = true
  }
}
if (stale) process.exit(1)
