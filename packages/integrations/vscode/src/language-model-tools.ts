import * as vscode from 'vscode'
import {cliName} from './agent-tools.js'
import {Asked, cliTool} from './language-model-tools/cli-tool.js'
import type {Contributed} from './language-model-tools/cli-tool.js'
import {openProjectionTool} from './language-model-tools/open-projection.js'
import type {ToolAnswer, ToolInput} from './language-model-tools/types.js'
import {currentView, refresh} from './language-model-tools/view-tools.js'
import type {Services} from './services.js'

/** An answer with the note saying where its omitted projection and revisions came from. */
function noted(answer: ToolAnswer, note: string | undefined): ToolAnswer {
  if (!note) return answer
  return typeof answer === 'string' ? `${note}\n\n${answer}` : {...answer, text: `${note}\n\n${answer.text}`}
}

/**
 * The agent tools: each `languageModelTools` contribution (generated from the CLI's catalog by scripts/tools.mjs)
 * calls its CLI tool through the folder's shared backend. A write previews in `prepareInvocation`, which asks the person
 * with the preview; once they approve, `invoke` writes with that preview's confirm token, so it writes what they saw
 * (or previews again if the files changed). Trust is the backend's: a write the workspace can't make isn't offered.
 * `open_projection` opens a projection tab instead, and `current_view` says what the one in front shows; the others take
 * an omitted projection (and compare's revisions) from that tab, and say so (`withTabDefaults`).
 */
export function agentTools(
  services: Services,
  openProjection: (folder: vscode.Uri, id: string, options: {preview?: boolean}) => Promise<void>,
) {
  const contributed = ((services.context.extension.packageJSON as {contributes?: {languageModelTools?: unknown[]}}).contributes
    ?.languageModelTools ?? []) as Contributed[]
  const asked = new Asked()
  const open = openProjectionTool(services.sidebar, openProjection)
  const tools = contributed.flatMap(tool => {
    const name = cliName(tool.name)
    if (!name) return []
    const {prepare, call, defaulted} = cliTool(services, tool, name, asked)
    const invoke = async (given: ToolInput, token?: vscode.CancellationToken): Promise<ToolAnswer> => {
      if (name === 'current_view') return currentView(given)
      if (name === 'refresh') return refresh(given)
      const {input, note} = await defaulted(given)
      if (name === 'open_projection') return noted(await open(input), note)
      return noted(await call(input, token), note)
    }
    return [{name: tool.name, prepare, invoke}]
  })
  const disposables =
    typeof vscode.lm?.registerTool === 'function'
      ? tools.map(tool =>
          vscode.lm.registerTool<ToolInput>(tool.name, {
            prepareInvocation: async (options, token) => {
              const prepared = await tool.prepare(options.input, token)
              return {
                invocationMessage: prepared.invocationMessage,
                ...(prepared.confirmation
                  ? {
                      confirmationMessages: {
                        title: prepared.confirmation.title,
                        message: new vscode.MarkdownString(prepared.confirmation.message),
                      },
                    }
                  : {}),
              }
            },
            invoke: async (options, token) => {
              const answer = await tool.invoke(options.input, token)
              const text = typeof answer === 'string' ? answer : answer.text
              const image = typeof answer === 'string' ? undefined : answer.image
              // VS Code before 1.104 has no data parts: the model reads the text alone.
              const data = (vscode as {LanguageModelDataPart?: {image(data: Uint8Array, mime: string): unknown}}).LanguageModelDataPart
              return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(text),
                ...(image && data ? [data.image(Buffer.from(image.data, 'base64'), image.mimeType)] : []),
              ])
            },
          }),
        )
      : []
  /** For tests: a tool's preparation (its confirmation, which shows a write's preview) and its result, without the chat. */
  const api = {
    prepare: (name: string, input: ToolInput) => {
      const tool = tools.find(item => item.name === name)
      if (!tool) throw new Error(`No tool ${name}`)
      return tool.prepare(input)
    },
    invoke: (name: string, input: ToolInput) => {
      const tool = tools.find(item => item.name === name)
      if (!tool) throw new Error(`No tool ${name}`)
      return tool.invoke(input)
    },
  }
  return {disposables, api}
}
