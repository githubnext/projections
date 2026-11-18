// Reads each surface that exposes Projections' agent tools, as the source at a revision declares it:
//
//   mcp             `projections mcp`'s tools/list: the CLI's catalog (packages/cli/src/tools/catalog.rs)
//   mcp-apps        the same list for an MCP Apps host, with open_projection linked to the viewer's view and the
//                   tools only that view calls (packages/cli/src/mcp/app.rs); the MCP App was removed, so only
//                   revisions from before its removal have it
//   vscode          the VS Code extension's languageModelTools (packages/integrations/vscode/package.json), which
//                   scripts/tools.mjs writes from the CLI's tools/list
//   copilot-canvas  the Copilot app canvas's actions (packages/integrations/copilot-canvas/extension.mjs), which take
//                   the catalog's schemas with the canvas's own `project` input
//
// Each reader returns null when its file doesn't exist at the revision, so a surface added or removed is a change.
import {balanced, keyLines, lineAt, quoted, rustModule, tokenize} from './rust-literals.mjs'

export const paths = {
  catalog: 'packages/cli/src/tools/catalog.rs',
  app: 'packages/cli/src/mcp/app.rs',
  vscode: 'packages/integrations/vscode/package.json',
  vscodeTools: 'packages/integrations/vscode/src/agent-tools.ts',
  canvas: 'packages/integrations/copilot-canvas/extension.mjs',
}

/** The catalog's tools in the order agents see them: each one's schema, flags and the line it starts on. */
export function catalogTools(read) {
  const text = read(paths.catalog)
  if (text === undefined) return null
  const start = /pub fn catalog\(\) -> Vec<Tool> \{/.exec(text)
  if (!start) throw new Error(`${paths.catalog}: no catalog() function`)
  const open = start.index + start[0].length - 1
  const body = tokenize(balanced(text, open).inner, lineAt(text, open))
  return rustModule(text, paths.catalog)
    .evaluate(body)
    .map(tool => ({
      name: tool.name,
      title: tool.title,
      readOnly: tool.read_only,
      destructive: tool.destructive,
      trust: tool.trust.replace(/^Trust::/, '').toLowerCase(),
      view: tool.view,
      schema: tool.input_schema,
      line: keyLines.get(tool)?.name,
    }))
}

/** What an MCP Apps host gets besides the catalog: the tools linked to the view, and the view's own tools. */
export function appTools(read) {
  const text = read(paths.app)
  if (text === undefined) return null
  const linked = [...text.matchAll(/tool\["name"\] == "(\w+)"/g)].map(match => match[1])
  const module = rustModule(text, paths.app)
  const added = []
  for (const match of text.matchAll(/tools\.push\(/g)) {
    const open = match.index + match[0].length - 1
    const tool = module.evaluate(tokenize(balanced(text, open).inner, lineAt(text, open)))
    added.push({
      name: tool.name,
      title: tool.title,
      readOnly: tool.annotations?.readOnlyHint === true,
      destructive: tool.annotations?.destructiveHint === true,
      appOnly: (tool._meta?.ui?.visibility ?? []).length > 0 && !tool._meta.ui.visibility.includes('model'),
      schema: tool.inputSchema,
      line: lineAt(text, open),
    })
  }
  const uri = /const RESOURCE_URI: &str = ("[^"]*")/.exec(text)
  return {linked, added, view: uri ? quoted(uri[1], 0).value : undefined}
}

/** The VS Code extension's contributed tools, by the CLI tool each calls, with the manifest line of each. */
export function vscodeTools(read) {
  const text = read(paths.vscode)
  if (text === undefined) return null
  const prefix = /toolPrefix = '([^']*)'/.exec(read(paths.vscodeTools) ?? '')?.[1] ?? 'projections_'
  const lines = text.split('\n')
  return {
    prefix,
    tools: (JSON.parse(text).contributes?.languageModelTools ?? []).map(tool => ({
      name: tool.name.startsWith(prefix) ? tool.name.slice(prefix.length) : tool.name,
      contributed: tool.name,
      schema: tool.inputSchema ?? {type: 'object', properties: {}},
      line: lines.findIndex(line => line.includes(`"name": ${JSON.stringify(tool.name)}`)) + 1 || undefined,
    })),
  }
}

/** The canvas's actions, the input it adds to each, and the tool whose schema its open input takes. */
export function canvasActions(read) {
  const text = read(paths.canvas)
  if (text === undefined) return null
  const actions = /const actions = \[([^\]]*)\]/.exec(text)
  if (!actions) throw new Error(`${paths.canvas}: no actions list`)
  const project = /const projectInput = \{\s*type: '(\w+)'/.exec(text)
  const added = project && /properties: \{\.\.\.schema\.properties, project: projectInput\}/.test(text)
  return {
    actions: [...actions[1].matchAll(/'(\w+)'/g)].map(match => match[1]),
    line: lineAt(text, actions.index),
    added: added ? {project: {type: project[1]}} : {},
    addedLine: project ? lineAt(text, project.index) : undefined,
    openInput: /inputSchema: withProject\(tool\('(\w+)'\)\.inputSchema\)\}/.exec(text)?.[1],
  }
}
