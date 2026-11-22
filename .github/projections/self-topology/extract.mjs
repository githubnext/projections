#!/usr/bin/env node
// Self topology: the open-source Projections product as one architecture/v0 graph.
//
// Units are the real components across languages: Cargo crates (cargo metadata), npm workspace packages
// (package.json), the WebAssembly modules the build scripts compile crates to, the out-of-process extractor helpers
// (Go, Python, Java, .NET) and loose scripts. Relationships are declared dependencies plus the boundaries the build
// and the source show: what a build bundles or embeds, which crate compiles to which module, who loads a module, who
// spawns whom as a process and who exchanges postMessage messages with whom. Every unit carries the capabilities its
// production source uses (JSON, serialization, filesystem, process, network, DOM, WebAssembly, unsafe, clock,
// randomness, environment, standard I/O, messaging), with the modules as data and each file's first site as evidence,
// and the facts `facts.mjs` reads: what it is for, its size in tokens and its languages, its tests, how it is assured,
// where it ships and where it runs. A README's front matter may name the unit's (or its area's) card icon,
// `icon: terminal`, which the definition draws with the architecture renderer's `icon` option. Each kind of connection
// between two units is its own relationship.
//
// It reads the project the definition belongs to (`repository.project` of the request: `opensource/` in the
// repository that develops it, the root of the published one), so every path below is relative to it.
//
// Inputs (definition `inputs`), all optional:
//   roots:   [{path, area?, capabilities?, components?}]: project-relative directories (`.` for the project)
//            holding a Cargo workspace and/or npm workspaces. `area` names the root in data (default its path);
//            `capabilities: false` skips scanning its source; `components` names directories without a manifest that
//            are units of their own, at any depth (the first root's default is ["integrations/*"]).
//            Default [{path: "."}]; a root that doesn't exist at a revision has no units.
//   exclude: unit paths to leave out, each a directory path matched at any depth (`cli/templates/` also leaves out
//            `packages/cli/templates`); default ["examples/", "cli/templates/"]
//
// Layout-agnostic: units come from the workspace manifests (Cargo members, npm workspaces), and a directory holding
// every glob-pattern workspace (`packages/` in `packages/renderers/*` and `packages/extractors/*`) is left out of
// unit names and areas, so moving the workspaces under one directory changes no name.
//   devDependencies: include dev-only dependency edges; default true
//
// Deterministic for a revision and toolchain: files are listed the way Git does, output is sorted, and nothing reads
// the clock, the network or randomness. `cargo metadata --no-deps --offline` reads only manifests.
import {request, result} from '@githubnext/projections/extractor'
import {unitFacts} from './facts.mjs'
import {releaseChannels} from './releases.mjs'
import {byText, listFiles, reader, sortedUnique} from './files.mjs'
import {discoverUnits} from './units.mjs'
import {assignSources, lineReader, stripComments, withoutRustTests} from './sources.mjs'
import {capabilityNames, scanCapabilities} from './capabilities.mjs'
import {manifestRelationships} from './relationships.mjs'
import {linkUnits} from './links.mjs'
import {topologyEntities} from './areas.mjs'

// The project's directory in the examined revision: what the definition's paths, and so this extractor's, are relative to.
const {root: repo, inputs} = request
const roots = (inputs.roots ?? [{path: '.'}]).map(root => ({
  ...root,
  path: root.path.replace(/\/$/u, '').replace(/^\.$/u, ''),
}))
const excluded = inputs.exclude ?? ['examples/', 'cli/templates/']
const devDependencies = inputs.devDependencies ?? true

const files = listFiles(repo)
const fileSet = new Set(files)
const read = reader(repo)
const linesOf = lineReader(read)

const found = discoverUnits({repo, roots, files, fileSet, read, excluded})
const {units, belowContainer} = found
const unitFiles = assignSources({...found, roots, files, read})
scanCapabilities({units, unitFiles, linesOf})
const {relationships, relate, unitAtPath, wasmModules} = manifestRelationships({...found, unitFiles, linesOf, read, devDependencies})
linkUnits({...found, unitFiles, linesOf, relate, unitAtPath, wasmModules})

// Each kind of connection between two units is its own relationship (`depends-on:a->b`, `loads:a->b`), so a
// presentation can show one kind at a time, and a pair that gains a connection gains a relationship.

// Where each unit ships, from what the release workflows attach and publish (see `releases.mjs`).
for (const [id, channels] of releaseChannels({roots, read, files, units, owner: unitAtPath})) {
  const unit = units.get(id)
  unit.meta = {...unit.meta, published: channels.map(entry => entry.channel).sort(byText)}
  for (const {source, line} of channels) unit.evidence.push({kind: 'release', source, ...(line ? {location: {line}} : {})})
}

// Facts about each unit: what it is for, its size, languages, tests, assurance, publication and where it runs.
const facts = unitFacts({units, unitFiles, read, files, fileSet, roots, relationships, stripComments, withoutRustTests})

for (const unit of units.values()) unit.label = belowContainer(unit, unit.label)

const entities = topologyEntities({...found, roots, relationships, facts, read})

result({
  schema: 'architecture/v0',
  entities,
  relationships: [...relationships.values()].map(({via, evidence, ...relationship}) => ({
    ...relationship,
    ...(via.size ? {data: {via: sortedUnique([...via])}} : {}),
    ...(evidence.length ? {evidence: evidence.map(item => (item.location ? item : {kind: item.kind, source: item.source}))} : {}),
  })),
  metadata: {capabilities: capabilityNames, roots: roots.map(root => root.path || '.')},
})
