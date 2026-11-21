#!/usr/bin/env node
// Writes .github/ci-rules.schema.json, the JSON Schema of .github/ci-rules.json, from its TypeBox source
// (tools/cli/src/lib/ci-rules.schema.ts), so editors complete and check the rules file.
//
//   node tools/scripts/ci-rules-schema.mjs           write it
//   node tools/scripts/ci-rules-schema.mjs --check   fail if it differs from what the source generates
//
// TypeBox writes each use of a recursive type with its own `$defs` and bare `$ref`s; this hoists the definitions to the
// root and makes the references JSON pointers, which every JSON Schema tool resolves.
import {readFileSync, writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {CiRules} from '../cli/src/lib/ci-rules.schema.ts'

const output = fileURLToPath(new URL('../../.github/ci-rules.schema.json', import.meta.url))
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
const root = hoist(JSON.parse(JSON.stringify(CiRules)))
const schema = {$schema: 'https://json-schema.org/draft/2020-12/schema', title: 'CI rules', ...root, $defs: defs}
const text = `${JSON.stringify(schema, null, 2)}\n`
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== text) {
    console.error('.github/ci-rules.schema.json is stale: run node tools/scripts/ci-rules-schema.mjs')
    process.exit(1)
  }
} else {
  writeFileSync(output, text)
}
