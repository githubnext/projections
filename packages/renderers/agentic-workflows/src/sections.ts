import {codeSpan, escapeProse} from '@githubnext/projections-schemas'
import type {Entity} from '@githubnext/projections-schemas'
import type {IconName} from '@githubnext/projections-renderer-kit'

/**
 * What a workflow card shows, section by section, as entries of text with inline code (kit `Prose` draws them). An
 * entry is identified by its `key`, so a comparison can say which arrived, which left and which changed in place.
 */
export interface Value {
  key: string
  /** Text with inline code. */
  text: string
}

export type SectionId = 'triggers' | 'tools' | 'repos' | 'bash' | 'network' | 'permissions' | 'outputs' | 'budgets' | 'loads' | 'secrets'

export interface SectionSpec {
  id: SectionId
  title: string
  icon: IconName
  /** What the section says when it has no entries. */
  empty: string
  /** The section's entries for one revision; `other` is the other revision's data, when there is one. */
  read: (data: Data, other?: Data) => Value[]
}

type Data = Record<string, unknown>

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const record = (value: unknown): Data => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : {})
const text = (value: unknown): string =>
  typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value)
const code = (value: unknown) => codeSpan(text(value))
const strings = (value: unknown) => list(value).map(text)

/** Where an item came from when an import added it: ` via `shared/otlp.md``. */
function via(data: Data, key: string): string {
  const sources = strings(record(data.sources)[key])
  return sources.length ? ` via ${sources.map(code).join(', ')}` : ''
}

function triggers(data: Data): Value[] {
  const events = list(data.triggers).map(record)
  const activation = record(data.activation)
  return [
    ...events.map(trigger => {
      const detail = text(trigger.detail)
      return {key: `event:${text(trigger.event)}`, text: code(trigger.event) + (detail ? ` ${escapeProse(detail)}` : '')}
    }),
    // gh-aw's default roles go without saying; declared ones are a choice to review.
    ...(activation.rolesDeclared === true ? strings(activation.roles) : []).map(role => ({
      key: `role:${role}`,
      text: `role ${codeSpan(role)}`,
    })),
  ]
}

function tools(data: Data): Value[] {
  const github = record(data.github)
  const settings = record(github.settings)
  const guards: Value[] = []
  if (settings.minIntegrity !== undefined) {
    guards.push({key: 'guard:min-integrity', text: `min-integrity ${code(settings.minIntegrity)}`})
  }
  if (settings.readOnly === true) guards.push({key: 'guard:read-only', text: 'read-only'})
  if (settings.lockdown === true) guards.push({key: 'guard:lockdown', text: 'lockdown'})
  return [
    ...strings(data.tools).map(tool => ({key: `tool:${tool}`, text: code(tool) + via(data, `tools:${tool}`)})),
    ...strings(github.toolsets).map(toolset => ({
      key: `toolset:${toolset}`,
      text: `toolset ${codeSpan(toolset)}${via(data, `toolsets:${toolset}`)}`,
    })),
    ...strings(data.mcpServers).map(server => ({
      key: `mcp:${server}`,
      text: `MCP server ${codeSpan(server)}${via(data, `mcp:${server}`)}`,
    })),
    ...guards,
  ]
}

function repos(data: Data): Value[] {
  if (!strings(data.tools).includes('github')) return []
  const allowed = record(data.github).repos
  if (!Array.isArray(allowed)) return [{key: 'repos:any', text: 'any repository its token reaches'}]
  return strings(allowed).map(repo => ({key: `repo:${repo}`, text: code(repo)}))
}

function bash(data: Data): Value[] {
  if (!Array.isArray(data.bash)) return []
  return strings(data.bash).map(command => ({key: `bash:${command}`, text: command === '*' ? 'any command' : code(command)}))
}

function network(data: Data): Value[] {
  const settings = record(data.network)
  return [
    ...strings(settings.allowed).map(domain => ({key: `allow:${domain}`, text: code(domain) + via(data, `network:${domain}`)})),
    ...strings(settings.blocked).map(domain => ({key: `block:${domain}`, text: `blocks ${codeSpan(domain)}`})),
  ]
}

function permissions(data: Data): Value[] {
  const declared = data.permissions
  // `permissions: {}` grants nothing, unlike inheriting GitHub's defaults (no `permissions`).
  if (declared && typeof declared === 'object' && !Array.isArray(declared) && !Object.keys(declared).length) {
    return [{key: 'permissions:none', text: 'none (`permissions: {}`)'}]
  }
  return Object.entries(record(declared))
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([scope, level]) => ({key: `permission:${scope}`, text: codeSpan(`${scope}: ${text(level)}`)}))
}

/** A safe output handler's limits in words: `max 3`, `to `o/r``, `staged`. */
function limits(handler: Data): string {
  const parts: string[] = []
  if (handler.max !== undefined) parts.push(`max ${code(handler.max)}${handler.maxDeclared === false ? ' (default)' : ''}`)
  if (handler.targetRepo !== undefined) parts.push(`to ${code(handler.targetRepo)}`)
  if (strings(handler.allowedRepos).length) parts.push(`also to ${strings(handler.allowedRepos).map(codeSpan).join(', ')}`)
  if (strings(handler.allowed).length) parts.push(`only ${strings(handler.allowed).map(codeSpan).join(', ')}`)
  if (strings(handler.workflows).length) parts.push(`starts ${strings(handler.workflows).map(codeSpan).join(', ')}`)
  if (handler.draft === true) parts.push('as drafts')
  if (handler.staged === true) parts.push('staged')
  return parts.join(', ')
}

function outputs(data: Data): Value[] {
  const outputs = record(data.safeOutputs)
  const handlers = list(outputs.handlers).map(record)
  return [
    ...handlers.map(handler => {
      const kind = text(handler.kind)
      const words = limits(handler)
      return {key: `output:${kind}`, text: codeSpan(kind) + (words ? ` ${words}` : '') + importedOutput(outputs, kind)}
    }),
    ...strings(outputs.jobs).map(job => ({key: `job:${job}`, text: `job ${codeSpan(job)}`})),
    ...(outputs.staged === true ? [{key: 'staged', text: 'every output staged'}] : []),
  ]
}

const importedOutput = (outputs: Data, kind: string) => {
  const sources = strings(record(outputs.sources)[kind])
  return sources.length ? ` via ${sources.map(codeSpan).join(', ')}` : ''
}

/**
 * Budgets in the order a reviewer weighs them, each `{value, declared}`. One left at gh-aw's default isn't listed,
 * unless the other revision declares it: then its default is the counterpart a change moves from or to.
 */
const budgetNames: readonly [string, string, string][] = [
  ['timeoutMinutes', 'timeout', ' min'],
  ['maxTurns', 'turns', ''],
  ['maxToolCalls', 'tool calls', ''],
  ['maxAiCredits', 'AI credits per run', ''],
  ['maxDailyAiCredits', 'AI credits per day', ''],
]

function budgets(data: Data, other?: Data): Value[] {
  const limits = record(data.limits)
  const theirs = record(other?.limits)
  return budgetNames.flatMap(([key, name, unit]) => {
    const limit = record(limits[key])
    const declared = limit.declared !== false
    if (!(key in limits) || (!declared && record(theirs[key]).declared !== true)) return []
    const value = limit.value
    const shown = typeof value === 'number' ? `${value.toLocaleString('en')}${unit}` : text(value)
    return [{key: `budget:${key}`, text: `${name} ${codeSpan(shown)}${declared ? '' : ' (default)'}`}]
  })
}

/** Imports and skills, each with its classes (`guardrail`), by name so a moved pin changes in place. */
function loads(data: Data): Value[] {
  const classes = (entry: Data) => {
    const names = strings(entry.classes)
    return names.length ? ` · ${names.map(codeSpan).join(', ')}` : ''
  }
  return [
    ...list(data.skills)
      .map(record)
      .map(skill => ({key: `skill:${text(skill.name ?? skill.ref)}`, text: `skill ${code(skill.ref)}${classes(skill)}`})),
    ...list(data.imports)
      .map(record)
      .map(entry => ({
        key: `import:${text(entry.path)}`,
        text: `${code(entry.path)}${entry.found === false ? ' (not read)' : ''}${classes(entry)}`,
      })),
  ]
}

function secrets(data: Data): Value[] {
  return strings(data.secrets).map(secret => ({key: `secret:${secret}`, text: codeSpan(secret)}))
}

/** The card's sections, in the order a reviewer reads a workflow: what starts it, what it reaches, what it writes, what it may spend, what it loads. */
export const sectionSpecs: readonly SectionSpec[] = [
  {id: 'triggers', title: 'Starts on', icon: 'process', empty: 'nothing', read: triggers},
  {id: 'tools', title: 'Tools', icon: 'settings', empty: 'none', read: tools},
  {id: 'repos', title: 'Repositories', icon: 'host', empty: 'no GitHub tool', read: repos},
  {id: 'bash', title: 'Bash', icon: 'process', empty: 'off', read: bash},
  {id: 'network', title: 'Network', icon: 'network', empty: 'none', read: network},
  {id: 'permissions', title: 'Permissions', icon: 'policy', empty: 'GitHub’s defaults', read: permissions},
  {id: 'outputs', title: 'Writes', icon: 'file', empty: 'nothing', read: outputs},
  {id: 'budgets', title: 'Budgets', icon: 'agent', empty: 'gh-aw’s defaults', read: budgets},
  {id: 'loads', title: 'Loads', icon: 'module', empty: 'nothing', read: loads},
  {id: 'secrets', title: 'Secrets', icon: 'credential', empty: 'none', read: secrets},
]

/** The entity's `data`, or none. */
export const dataOf = (entity: Entity | undefined): Data => record(entity?.data)
