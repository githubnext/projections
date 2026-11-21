// The Projections agent tools in VS Code, without VS Code, for tests: the CLI's tool catalog (`tools/list`) as
// `languageModelTools` contributions, and what a tool shows before it runs. The extension registers each contribution
// with `vscode.lm.registerTool` and answers it through the folder's shared backend (`tools/call`).
import type {ToolDescription, ToolResult} from './runner.js'

/** Every contributed tool's name starts with this, so it never collides with another extension's. */
export const toolPrefix = 'projections_'

/** The tag of the tools that write: they preview, and write once the person confirms. */
export const writeTag = 'projections-write'

/** The tag of the tools that write only with trust outside an explore session (adopt); others need it always. */
export const onboardingTag = 'projections-onboarding'

/** The input every contributed tool takes besides the CLI's: which workspace folder it acts on. */
export const folderProperty = {
  type: 'string',
  description:
    "The workspace folder to act on, by name or path, when several are open; default the active editor's folder, else the projection tab's, else the first",
}

const icons: Record<string, string> = {
  list_projections: '$(list-tree)',
  compare: '$(git-compare)',
  explore: '$(search)',
  sweep: '$(history)',
  check: '$(pass)',
  prepare: '$(package)',
  run_comparator_tests: '$(beaker)',
  describe_part: '$(book)',
  open_projection: '$(projections-mark)',
  current_view: '$(eye)',
  refresh: '$(refresh)',
  screenshot: '$(device-camera)',
  adopt: '$(add)',
  set_part: '$(edit)',
  update_snapshots: '$(save-all)',
}

/** A description's first sentence, for people. */
export function firstSentence(text: string): string {
  const end = text.search(/\.(\s|$)/)
  return end < 0 ? text : text.slice(0, end + 1)
}

/**
 * The `languageModelTools` contribution for a tool: the catalog's schema, the same one `projections mcp` lists, without
 * `confirm` (the editor asks the person) and with `folder`.
 */
export function contribution(tool: ToolDescription) {
  const properties = {...tool.inputSchema.properties}
  delete properties.confirm
  const required = (tool.inputSchema.required ?? []).filter(key => key !== 'confirm')
  // Writes preview first; a tool that only runs repository code (prepare) has no preview to confirm.
  const write = !tool.annotations.readOnlyHint && (tool.trust === 'write' || tool.trust === 'onboarding')
  return {
    name: `${toolPrefix}${tool.name}`,
    toolReferenceName: `${toolPrefix}${tool.name}`,
    displayName: tool.title,
    icon: icons[tool.name] ?? '$(tools)',
    canBeReferencedInPrompt: true,
    tags: ['projections', ...(write ? [writeTag] : []), ...(tool.trust === 'onboarding' ? [onboardingTag] : [])],
    userDescription: firstSentence(tool.description),
    modelDescription: tool.description,
    inputSchema: {...tool.inputSchema, properties: {...properties, folder: folderProperty}, required},
  }
}

/** The CLI tool a contributed name calls, or undefined for another extension's. */
export function cliName(name: string): string | undefined {
  return name.startsWith(toolPrefix) ? name.slice(toolPrefix.length) : undefined
}

/** A tool's arguments for the backend: the input without `folder` (and never a `confirm` the model made up). */
export function cliArguments(input: unknown): Record<string, unknown> {
  const args = {...((typeof input === 'object' && input) || {})} as Record<string, unknown>
  delete args.folder
  delete args.confirm
  return args
}

/** What the chat shows while a tool runs: its title and the projection or part it is about. */
export function invocationMessage(title: string, input: Record<string, unknown>): string {
  const subject = [input.projection, input.part, Array.isArray(input.projections) ? input.projections.join(', ') : undefined].find(
    (value): value is string => typeof value === 'string' && value !== '',
  )
  return `${title}${subject ? `: ${subject}` : ''}`
}

/** The preview a write's confirmation shows, and the token that writes it; none when there is nothing to confirm. */
export function confirmation(title: string, preview: ToolResult): {title: string; message: string; token: string} | undefined {
  const token = preview.structuredContent?.confirm
  if (preview.isError || typeof token !== 'string') return undefined
  const text = preview.content
    .map(part => part.text ?? '')
    .join('')
    .replace(/\n*Nothing was written\.\n*$/, '\n')
  return {title: `${title}?`, message: text, token}
}
