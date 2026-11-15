import * as vscode from 'vscode'
import {cliArguments, confirmation, invocationMessage, onboardingTag, writeTag} from '../agent-tools.js'
import {projectionDefaulted, withTabDefaults} from '../current-view/tool-input.js'
import {tabDefaults} from '../current-view/tab-defaults.js'
import {InspectorPanel} from '../panels/inspector-panel.js'
import {viewedTab} from '../panels/projection-editor.js'
import {toolText} from '../runner.js'
import type {Services} from '../services.js'
import {abortOn, toolFolder} from './folders.js'
import type {Prepared, ToolAnswer, ToolInput} from './types.js'

/** A contributed agent tool, as `package.json` declares it. */
export interface Contributed {
  name: string
  displayName: string
  tags?: string[]
}

/** The confirm tokens of previews the person was asked about, by tool, folder and arguments. */
export class Asked {
  private readonly tokens = new Map<string, string>()
  private key = (name: string, folder: vscode.WorkspaceFolder, args: ToolInput) =>
    `${name}\n${folder.uri.toString()}\n${JSON.stringify(args)}`
  get(name: string, folder: vscode.WorkspaceFolder, args: ToolInput) {
    return this.tokens.get(this.key(name, folder, args))
  }
  set(name: string, folder: vscode.WorkspaceFolder, args: ToolInput, token: string) {
    this.tokens.set(this.key(name, folder, args), token)
  }
  delete(name: string, folder: vscode.WorkspaceFolder, args: ToolInput) {
    this.tokens.delete(this.key(name, folder, args))
  }
}

/** The input with what it omitted taken from the projection tab the person is looking at, and where from. */
async function defaulted(name: string, input: ToolInput): Promise<{input: ToolInput; note?: string}> {
  if (!projectionDefaulted.has(name) && name !== 'describe_part') return {input}
  const viewed = viewedTab(toolFolder(input.folder))
  // A screenshot is of what the person sees: the page's mode, playback, theme and size.
  const facts = viewed ? await viewed.tab.viewFacts(viewed.inFront, {page: name === 'screenshot'}) : undefined
  return withTabDefaults(name, input, facts ? tabDefaults(facts) : undefined)
}

/** What a write that wasn't confirmed needs, after its preview. */
const unconfirmedNote = () =>
  vscode.workspace.isTrusted
    ? 'Ask again to write it: Projections asks the person to approve the preview first.\n'
    : 'Writing needs a trusted workspace: the person can trust it (Workspaces: Manage Workspace Trust), then ask again.\n'

/**
 * A CLI tool called through the folder's shared backend. A write previews in `prepare`, which asks the person with the
 * preview; once they approve, `invoke` writes with that preview's confirm token, so it writes what they saw.
 */
export function cliTool(services: Services, tool: Contributed, name: string, asked: Asked) {
  const {sidebar, withBackend} = services
  const write = tool.tags?.includes(writeTag) ?? false
  const onboarding = tool.tags?.includes(onboardingTag) ?? false
  const prepare = async (given: ToolInput, token?: vscode.CancellationToken): Promise<Prepared> => {
    const input = name === 'current_view' || name === 'refresh' ? given : (await defaulted(name, given).catch(() => ({input: given}))).input
    const message = invocationMessage(tool.displayName, input)
    if (!write) return {invocationMessage: message}
    const folder = toolFolder(input.folder)
    const args = cliArguments(input)
    asked.delete(name, folder, args)
    const [preview, writable] = await withBackend(folder, async runner => [
      await runner.callTool(name, args, abortOn(token)),
      runner.trusted || (onboarding && runner.info.explore),
    ])
    const confirm = confirmation(tool.displayName, preview)
    // Nothing to write, or nothing it may write: invoke reports the preview, or why not.
    if (!confirm || !writable) return {invocationMessage: message}
    asked.set(name, folder, args, confirm.token)
    return {invocationMessage: message, confirmation: {title: `Projections: ${confirm.title}`, message: confirm.message}}
  }
  const call = async (input: ToolInput, token?: vscode.CancellationToken): Promise<ToolAnswer> => {
    const folder = toolFolder(input.folder)
    const args = cliArguments(input)
    const confirm = write ? asked.get(name, folder, args) : undefined
    asked.delete(name, folder, args)
    const result = await withBackend(folder, runner => runner.callTool(name, confirm ? {...args, confirm} : args, abortOn(token)))
    if (result.structuredContent?.written === true) {
      void sidebar.refresh()
      InspectorPanel.refreshExplore(folder)
    }
    let text = toolText(result)
    if (write && !confirm && typeof result.structuredContent?.confirm === 'string') text += unconfirmedNote()
    const image = result.content.find(part => part.type === 'image' && typeof part.data === 'string')
    return image ? {text, image: {data: image.data!, mimeType: image.mimeType ?? 'image/png'}} : text
  }
  return {prepare, call, defaulted: (input: ToolInput) => defaulted(name, input)}
}
