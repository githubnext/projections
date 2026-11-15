// Extractor for the "{{id}}" projection.
//
// Projections runs this program with a request on stdin and reads one
// extraction from stdout: the entities and relationships that matter in this
// codebase, as data. `projections help authoring` explains the whole loop.
//
// The starter describes each top-level directory and how many files it holds.
// Replace it with the facts this projection is about.
//
// Rules: read the examined revision only through request.repository.root, never
// the network or the clock, and sort what you emit, so the same revision always
// gives the same extraction. Give items IDs that stay stable when unrelated
// things change ("route:GET /orders", not a list position).
//
// This projection's project (the directory holding its definition) is
// request.repository.project in that root, empty for the repository's root.
// The definition's paths and inputs are relative to it; so are evidence paths.
import {readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'

const request = JSON.parse(readFileSync(0, 'utf8'))
const root = join(request.repository.root, request.repository.project ?? '')

function countFiles(directory) {
  let count = 0
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (entry.isDirectory()) count += countFiles(join(directory, entry.name))
    else if (entry.isFile()) count += 1
  }
  return count
}

const directories = readdirSync(root, {withFileTypes: true})
  .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
  .map(entry => entry.name)
  .sort()

const entities = directories.map(name => ({
  id: `directory:${name}`,
  kind: 'directory',
  label: name,
  data: {files: countFiles(join(root, name))},
  evidence: [{kind: 'file', source: name}],
}))

const extraction = {
  protocolVersion: 0,
  // The closest domain schema; renderers that handle it can present this too.
  schema: 'graph/v0',
  entities,
  relationships: [],
}

process.stdout.write(JSON.stringify(extraction))
