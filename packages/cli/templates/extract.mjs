// Extractor for the "{{id}}" projection.
//
// Projections runs this program and reads one extraction from it: the entities
// and relationships that matter in this codebase, as data.
// `projections help authoring` explains the whole loop.
//
// The starter describes each top-level directory and how many files it holds.
// Replace it with the facts this projection is about.
//
// Rules: read the examined revision only through request.root, never the
// network or the clock, so the same revision always gives the same extraction.
// Give items IDs that stay stable when unrelated things change
// ("route:GET /orders", not a list position).
//
// request.root is this projection's project (the directory holding its
// definition) in the examined revision. The definition's paths and inputs are
// relative to it; so are evidence paths.
//
// Projections provides @githubnext/projections/extractor to an extractor it
// runs with `node`: there is nothing to install.
import {readdirSync} from 'node:fs'
import {join} from 'node:path'
import {request, result} from '@githubnext/projections/extractor'

function countFiles(directory) {
  let count = 0
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (entry.isDirectory()) count += countFiles(join(directory, entry.name))
    else if (entry.isFile()) count += 1
  }
  return count
}

const entities = {}
for (const entry of readdirSync(request.root, {withFileTypes: true})) {
  if (entry.isDirectory() && !entry.name.startsWith('.')) {
    const name = entry.name
    entities[`directory:${name}`] = {
      kind: 'directory',
      label: name,
      data: {files: countFiles(join(request.root, name))},
      evidence: [{kind: 'file', source: name}],
    }
  }
}

// In the general graph/v0 schema, result()'s default; schema: '...' picks a closer one.
result({entities})
