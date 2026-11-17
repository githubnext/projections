#!/usr/bin/env node
// Agent tools: every tool Projections offers coding agents, the parameters each takes, and the surfaces that expose
// it, as one api/v0 extraction the `api` renderer lists.
//
// The surfaces (see surfaces.mjs) are read from source, never by running anything: the CLI's catalog is evaluated
// from its Rust literals, the VS Code manifest and canvas actions from their files. So any revision extracts, built
// or not, and the comparison shows what each surface's source says. Rows, in ID order:
//
//   surface:<id>          one per surface: where its tools come from and how it renames or adds to them
//   tool:<name>           one per tool: the surfaces that expose it, whether it writes, and the trust it needs
//   tool:<name>/<param>   one per parameter: its type, enum values and limits, whether it is required, and the
//                         surfaces that take it when not all of the tool's do
//
// Each row's data holds the facts the comparator classifies (agent-tools.comparator.yaml); descriptions are left out,
// so a reworded description is no change here. Deterministic for a revision: it reads only files.
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {appTools, canvasActions, catalogTools, paths, vscodeTools} from './surfaces.mjs'
import {keyLines} from './rust-literals.mjs'
import {parameterDifferences, parameterRow, surfaceRow, toolRow} from './rows.mjs'

const request = JSON.parse(readFileSync(0, 'utf8'))
const repo = request.repository?.root ? path.join(request.repository.root, request.repository.project ?? '') : process.cwd()
const read = file => {
  try {
    return readFileSync(path.join(repo, file), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

const catalog = catalogTools(read)
const app = appTools(read)
const vscode = vscodeTools(read)
const canvas = canvasActions(read)

/** Each tool by name: its catalog facts, and its schema and evidence on each surface that exposes it. */
const tools = new Map()
const toolNamed = name => {
  if (!tools.has(name)) tools.set(name, {name, on: new Map()})
  return tools.get(name)
}
const expose = (tool, surface, schema, evidence) => tool.on.set(surface, {schema, evidence})
const at = (source, line) => ({kind: 'source', source, ...(line ? {location: {line}} : {})})

for (const entry of catalog ?? []) {
  const tool = Object.assign(toolNamed(entry.name), {facts: entry, propertyLines: keyLines.get(entry.schema.properties) ?? {}})
  expose(tool, 'mcp', entry.schema, at(paths.catalog, entry.line))
  if (app) expose(tool, 'mcp-apps', entry.schema, at(paths.catalog, entry.line))
}
for (const entry of app?.added ?? []) {
  const tool = Object.assign(toolNamed(entry.name), {facts: {...entry, trust: 'none', view: false}, propertyLines: {}})
  expose(tool, 'mcp-apps', entry.schema, at(paths.app, entry.line))
}
for (const entry of vscode?.tools ?? []) expose(toolNamed(entry.name), 'vscode', entry.schema, at(paths.vscode, entry.line))
for (const name of canvas?.actions ?? []) {
  const schema = tools.get(name)?.facts?.schema ?? {type: 'object', properties: {}}
  const withAdded = {...schema, properties: {...schema.properties, ...canvas.added}}
  expose(toolNamed(name), 'copilot-canvas', withAdded, at(paths.canvas, canvas.line))
}

const surfaces = [catalog && 'mcp', app && 'mcp-apps', vscode && 'vscode', canvas && 'copilot-canvas'].filter(Boolean)

const entities = []
const relationships = []
for (const surface of surfaces) entities.push(surfaceRow(surface, {tools, app, vscode, canvas, paths}))
// A parameter a surface adds to every catalog tool it exposes (VS Code's `folder`, the canvas's `project`) is listed
// once, on the surface's row, rather than under every tool.
const everywhere = new Map(surfaces.map(surface => [surface, parameterDifferences(tools, surface).added]))
const surfaceWide = (tool, name) =>
  tool.on.has('mcp') &&
  [...tool.on].every(([surface, {schema}]) => !(name in (schema.properties ?? {})) || everywhere.get(surface).includes(name))
for (const tool of tools.values()) {
  const row = toolRow(tool, {app, canvas})
  entities.push(row)
  const names = [...new Set([...tool.on.values()].flatMap(({schema}) => Object.keys(schema.properties ?? {})))].filter(
    name => !surfaceWide(tool, name),
  )
  for (const name of names) {
    const parameter = parameterRow(tool, name, {canvas, paths})
    entities.push(parameter)
    relationships.push({
      id: `contains:${row.id}->${parameter.id}`,
      kind: 'contains',
      from: row.id,
      to: parameter.id,
      confidence: 'authoritative',
    })
  }
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
process.stdout.write(
  `${JSON.stringify(
    {
      protocolVersion: 0,
      schema: 'api/v0',
      entities: entities.sort(byId),
      relationships: relationships.sort(byId),
      metadata: {surfaces},
    },
    null,
    2,
  )}\n`,
)
