// The rows of the agent tools extraction: one per surface, tool and parameter, each with the signature the `api`
// renderer shows and the facts the comparator reads in `data`.

/** The surfaces in the order rows list them. */
export const surfaceOrder = ['mcp', 'mcp-apps', 'vscode', 'copilot-canvas']
const ordered = surfaces => surfaceOrder.filter(surface => surfaces.includes(surface))

/** A JSON value with its object keys sorted and every `description` left out: what a schema requires, not its prose. */
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .filter(key => key !== 'description')
      .sort()
      .map(key => [key, canonical(value[key])]),
  )
}

/** A parameter's type as agents read it: `string`, `"base" | "head"`, `string[]`, `string | object | null`. */
export function typeText(schema = {}) {
  if (Array.isArray(schema.enum)) return schema.enum.map(value => JSON.stringify(value)).join(' | ')
  if (Array.isArray(schema.type)) return schema.type.join(' | ')
  if (schema.type === 'array') {
    const item = typeText(schema.items)
    return item.includes(' | ') ? `(${item})[]` : `${item}[]`
  }
  return schema.type ?? 'any'
}

/** A parameter's limits: ` (1–100 chars)`, ` (0–1)`, ` (≤ 50 items)`, or nothing. */
export function limitsText(schema = {}) {
  const [min, max, unit] =
    schema.type === 'string'
      ? [schema.minLength, schema.maxLength, 'chars']
      : schema.type === 'array'
        ? [schema.minItems, schema.maxItems, 'items']
        : [schema.minimum, schema.maximum, '']
  if (min === undefined && max === undefined) return ''
  if (unit === 'chars' && min === 1 && max === undefined) return ' (non-empty)'
  const range = min !== undefined && max !== undefined ? `${min}–${max}` : min !== undefined ? `≥ ${min}` : `≤ ${max}`
  return ` (${range}${unit ? ` ${unit}` : ''})`
}

/** What the comparator reads of a parameter's schema: its types, its enum values and its range, as one shape. */
function facts(schema) {
  const [min, max] =
    schema.type === 'string'
      ? [schema.minLength, schema.maxLength]
      : schema.type === 'array'
        ? [schema.minItems, schema.maxItems]
        : [schema.minimum, schema.maximum]
  return {
    types: Array.isArray(schema.type) ? [...schema.type] : [schema.type ?? 'any'],
    ...(Array.isArray(schema.enum) ? {values: schema.enum.map(String)} : {}),
    limits: {...(min === undefined ? {} : {min}), ...(max === undefined ? {} : {max})},
    range: limitsText(schema).replace(/^ \((.*)\)$/, '$1') || 'no limit',
  }
}

const listed = (names, sign) => names.map(name => `, ${sign} ${name}`).join('')

/** What a surface adds to the catalog's parameters, and what it leaves out, across every tool it shares with it. */
export function parameterDifferences(tools, surface) {
  const shared = [...tools.values()].filter(tool => tool.on.has('mcp') && tool.on.has(surface))
  const keys = (tool, side) => Object.keys(tool.on.get(side).schema.properties ?? {})
  const always = (names, holds) => [...new Set(names)].filter(holds).sort()
  return {
    added: always(
      shared.flatMap(tool => keys(tool, surface)),
      name => shared.every(tool => keys(tool, surface).includes(name) && !keys(tool, 'mcp').includes(name)),
    ),
    removed: always(
      shared.flatMap(tool => keys(tool, 'mcp')),
      name => shared.every(tool => !keys(tool, 'mcp').includes(name) || !keys(tool, surface).includes(name)),
    ),
  }
}

/** One surface's row: where its tools come from, and how it names and changes them. */
export function surfaceRow(surface, {tools, app, vscode, canvas, paths}) {
  const {added, removed} = parameterDifferences(tools, surface)
  const changes = `${listed(added, '+')}${listed(removed, '−')}`
  const describe = {
    mcp: () => ({signature: 'projections mcp → tools/list', source: paths.catalog}),
    'mcp-apps': () => {
      const extra = app.added.map(tool => `, + ${tool.name}`).join('')
      const shows = app.linked.length ? `; ${app.linked.join(', ')} shows ${app.view}` : ''
      return {signature: `projections mcp → tools/list for MCP Apps hosts${extra}${shows}`, source: paths.app}
    },
    vscode: () => ({signature: `languageModelTools → ${vscode.prefix}<tool>${changes}`, source: paths.vscode}),
    'copilot-canvas': () => ({
      signature: `projections canvas → actions${changes}${canvas.openInput ? `; open input: ${canvas.openInput}` : ''}`,
      source: paths.canvas,
    }),
  }
  const {signature, source} = describe[surface]()
  return {
    id: `surface:${surface}`,
    kind: 'module',
    label: surface,
    data: {signature: `${surface}: ${signature}`, surface, added, removed},
    evidence: [{kind: 'source', source}],
    confidence: 'authoritative',
  }
}

/** One tool's row: the surfaces that expose it, and what calling it does (writes, needs trust). */
export function toolRow(tool, {app, canvas}) {
  const surfaces = ordered([...tool.on.keys()])
  const toolFacts = tool.facts ?? {}
  const linked = Boolean(app?.linked.includes(tool.name))
  const openInput = canvas?.openInput === tool.name
  const where = surfaces
    .map(surface =>
      surface === 'mcp-apps' && linked
        ? 'mcp-apps (shows the view)'
        : surface === 'copilot-canvas' && openInput
          ? 'copilot-canvas (and its open input)'
          : surface,
    )
    .join(', ')
  const effect =
    toolFacts.readOnly === undefined ? [] : [toolFacts.readOnly ? 'read-only' : toolFacts.destructive ? 'destructive' : 'writes']
  const flags = [
    ...effect,
    ...(toolFacts.trust && toolFacts.trust !== 'none' ? [`trust: ${toolFacts.trust}`] : []),
    ...(toolFacts.view ? ['view'] : []),
    ...(toolFacts.appOnly ? ['app only'] : []),
  ]
  return {
    id: `tool:${tool.name}`,
    kind: 'function',
    label: tool.name,
    data: {
      signature: `${tool.name} on ${where}${flags.map(flag => ` · ${flag}`).join('')}`,
      surfaces,
      ...(toolFacts.readOnly === undefined ? {} : {readOnly: toolFacts.readOnly, destructive: toolFacts.destructive}),
      ...(toolFacts.trust ? {trust: toolFacts.trust} : {}),
      ...(toolFacts.view ? {view: true} : {}),
      ...(toolFacts.appOnly ? {appOnly: true} : {}),
      ...(linked ? {showsView: true} : {}),
      ...(openInput ? {canvasOpenInput: true} : {}),
    },
    evidence: surfaces.map(surface => tool.on.get(surface).evidence),
    confidence: 'authoritative',
  }
}

/** One parameter's row: its type, limits and whether it is required, and the surfaces that take it. */
export function parameterRow(tool, name, {canvas, paths}) {
  const toolSurfaces = ordered([...tool.on.keys()])
  const shapes = new Map()
  for (const surface of toolSurfaces) {
    const {schema} = tool.on.get(surface)
    const property = schema.properties?.[name]
    if (property) shapes.set(surface, {property, required: (schema.required ?? []).includes(name)})
  }
  const surfaces = [...shapes.keys()]
  const reference = shapes.get(surfaces[0])
  const key = shape => JSON.stringify([canonical(shape.property), shape.required])
  const differsOn = surfaces.filter(surface => key(shapes.get(surface)) !== key(reference))
  const only = surfaces.length < toolSurfaces.length ? ` · only on ${surfaces.join(', ')}` : ''
  const differs = differsOn.length ? ` · differs on ${differsOn.join(', ')}` : ''
  const optional = reference.required ? '' : '?'
  const line = tool.propertyLines?.[name]
  const evidence = line
    ? {kind: 'source', source: paths.catalog, location: {line}}
    : surfaces[0] === 'copilot-canvas' && canvas.addedLine
      ? {kind: 'source', source: paths.canvas, location: {line: canvas.addedLine}}
      : tool.on.get(surfaces[0]).evidence
  return {
    id: `tool:${tool.name}/${name}`,
    kind: 'property',
    label: name,
    data: {
      signature: `${name}${optional}: ${typeText(reference.property)}${limitsText(reference.property)}${only}${differs}`,
      tool: tool.name,
      required: reference.required,
      ...facts(reference.property),
      schema: canonical(reference.property),
      surfaces,
      ...(differsOn.length ? {differsOn} : {}),
    },
    evidence: [evidence],
    confidence: 'authoritative',
  }
}
