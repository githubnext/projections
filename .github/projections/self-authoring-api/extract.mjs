#!/usr/bin/env node
// Authoring API: what someone writing a projection writes, calls and reads, as one api/v0 extraction.
//
// - The files and messages authors write or read, from their JSON Schemas (`schemas.mjs`): the projection
//   definition, the comparator file and its tests, the extractor's request (stdin) and extraction (stdout), a renderer's
//   scenarios and the environment file.
// - The comparator rules language (`rules.mjs`): the standard library, macros and types CEL expressions use.
// - The CLI's commands and arguments (`cli.mjs`), from the generated CLI reference.
//
// The TypeScript SDK (`@githubnext/projections`) is its own projection, self-authoring-sdk, drawn from the built-in
// typescript-public-api extractor.
//
// Inputs (definition `inputs`), paths relative to the project:
//   documents: [{id, label, file, schema}]: `schema` is the JSON Schema file; `id` prefixes its declarations' IDs,
//              `label` names its row and `file` says where authors write it
//   rules:     the rules language description (language.json)
//   cli:       {reference, exclude}: the CLI reference page, and the commands (with their subcommands) to leave out
//
// A file missing at a revision contributes nothing and is listed in `missingInputs`. Deterministic: it reads only those
// files, and output is sorted.
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {request, result} from '@githubnext/projections/extractor'
import {cliDeclarations} from './cli.mjs'
import {rulesDeclarations} from './rules.mjs'
import {schemaDeclarations} from './schemas.mjs'

const {root, inputs} = request

const missingInputs = []
const read = file => {
  try {
    return readFileSync(path.join(root, file), 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    missingInputs.push(file)
    return undefined
  }
}

const parts = []
for (const document of inputs.documents ?? []) {
  const text = read(document.schema)
  if (text !== undefined) parts.push(schemaDeclarations({document, schema: JSON.parse(text), text, source: document.schema}))
}
if (inputs.rules) {
  const text = read(inputs.rules)
  if (text !== undefined) parts.push(rulesDeclarations({language: JSON.parse(text), text, source: inputs.rules}))
}
if (inputs.cli?.reference) {
  const text = read(inputs.cli.reference)
  if (text !== undefined) parts.push(cliDeclarations({text, source: inputs.cli.reference, exclude: inputs.cli.exclude}))
}

result({
  schema: 'api/v0',
  entities: parts.flatMap(part => part.entities),
  relationships: parts.flatMap(part => part.relationships),
  ...(missingInputs.length ? {missingInputs: missingInputs.toSorted()} : {}),
})
