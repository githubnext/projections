import {spawn} from 'node:child_process'
import type {ChildProcess} from 'node:child_process'
import {createInterface} from 'node:readline'
import {createRpcClient} from './runner/rpc.ts'

// The JSON-RPC client and the CLI's location and compatibility; this module starts the backend and reads its answers.
// Its modules import each other with `.ts` specifiers, which Node loads from source (unit tests, scripts/tools.mjs).

/** What `initialize` returns: the backend's protocol and version, its repository, and its grants. */
export interface RunnerInfo {
  protocol: number
  version: string
  repository: string
  trusted: boolean
  /** Whether it is an explore session (the repository defines no projections yet). */
  explore: boolean
  /** What it presents: a `repository`, a saved `document`, or renderer `fixtures`. */
  mode?: 'repository' | 'document' | 'fixtures'
}

/** One request to the backend's API: what an HTTP request to the Inspector would be. */
export interface RunnerRequest {
  method: 'GET' | 'POST'
  /** A server-relative `/api/` path with its query. */
  path: string
  body?: unknown
}

/** The backend's answer: the HTTP status and content type, and the body (parsed JSON, `{base64}` or text). */
export interface RunnerResponse {
  status: number
  contentType: string
  body: unknown
  /** The length of the reply line, which bounds the body's size. */
  size: number
}

/** An agent tool, as `tools/list` describes it (the CLI's tool catalog; see docs/runner/agent-tools.md). */
export interface ToolDescription {
  name: string
  title: string
  /** What a model reads to decide when to call it. */
  description: string
  inputSchema: {type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean}
  annotations: {readOnlyHint: boolean; destructiveHint: boolean}
  /** What it needs trust for: `none`, `extract` (repository code), `write` or `onboarding` (writing outside an explore session). */
  trust: string
  /** A view action, answered by the surface that shows the view: this extension with its projection tabs (`open_projection`, `current_view`, `refresh`). */
  view: boolean
}

/** A tool's result, as `tools/call` answers (MCP's `CallToolResult`). */
export interface ToolResult {
  /** Text parts, and a screenshot's image part (`data`, base64, with its `mimeType`). */
  content: {type: string; text?: string; data?: string; mimeType?: string}[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

/** A `projections serve --stdio` process this extension started, and its JSON-RPC client. */
export interface Runner {
  readonly info: RunnerInfo
  /** Whether it was started with `--trust` (the workspace is trusted). */
  readonly trusted: boolean
  /** Sends one API request; aborting `signal` cancels it in the backend. */
  request: (request: RunnerRequest, signal?: AbortSignal) => Promise<RunnerResponse>
  /** The agent tools (`tools/list`). */
  tools: (signal?: AbortSignal) => Promise<ToolDescription[]>
  /** Calls an agent tool (`tools/call`); aborting `signal` cancels it in the backend. */
  callTool: (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>
  /** The backend's notifications, such as `changes` (`{generation, changes, complete}`). */
  onNotification: (listener: (method: string, params: unknown) => void) => () => void
  readonly exited: Promise<number | null>
  /** Closes the backend's standard input, which stops it; it is killed if it hasn't exited after a few seconds. */
  stop: () => void
}

/** Validates `initialize`'s result. */
export function parseInfo(value: unknown): RunnerInfo {
  const info = value as Partial<RunnerInfo> | null
  if (
    typeof info !== 'object' ||
    info === null ||
    !Number.isSafeInteger(info.protocol) ||
    typeof info.version !== 'string' ||
    typeof info.repository !== 'string' ||
    typeof info.trusted !== 'boolean' ||
    typeof info.explore !== 'boolean'
  ) {
    throw new Error(`projections serve speaks an unsupported protocol: ${JSON.stringify(value)?.slice(0, 200)}`)
  }
  return info as RunnerInfo
}

/** Validates a `request` result. */
function parseResponse({result, size}: {result: unknown; size: number}): RunnerResponse {
  const response = result as Partial<RunnerResponse> | null
  if (
    typeof response !== 'object' ||
    response === null ||
    typeof response.status !== 'number' ||
    typeof response.contentType !== 'string'
  ) {
    throw new Error('The backend returned an invalid response')
  }
  return {status: response.status, contentType: response.contentType, body: response.body, size}
}

/** Validates a `tools/list` result. */
export function parseTools(value: unknown): ToolDescription[] {
  const tools = (value as {tools?: unknown} | null)?.tools
  if (!Array.isArray(tools) || !tools.every(tool => typeof tool?.name === 'string' && typeof tool.inputSchema === 'object')) {
    throw new Error('The backend listed invalid tools')
  }
  return tools as ToolDescription[]
}

/** Validates a `tools/call` result. */
export function parseToolResult(value: unknown): ToolResult {
  const result = value as Partial<ToolResult> | null
  if (!result || !Array.isArray(result.content)) throw new Error('The backend returned an invalid tool result')
  return result as ToolResult
}

/** A tool result's text, its text parts joined. */
export function toolText(result: ToolResult): string {
  return result.content.map(part => (part.type === 'text' ? (part.text ?? '') : '')).join('')
}

/**
 * Starts `projections serve --stdio` in a repository and initializes it. With `trust` (a trusted workspace) it passes
 * `--trust`, which lets the backend execute the repository's extractor and renderer code; without it only built-in
 * extractors run. The backend has no port, token or listener: only this process reaches it, through its stdio.
 */
export async function startRunner({
  executable,
  repository,
  trust,
  log,
  timeoutMs = 20_000,
  check,
  args: extra = [],
}: {
  executable: string
  repository: string
  trust: boolean
  /** More `serve` arguments, such as `--document FILE` or `--fixtures DIR`. */
  args?: string[]
  log: (line: string) => void
  timeoutMs?: number
  /** Refuses a backend this extension can't use: returns why (see `incompatibility`). */
  check?: (info: RunnerInfo) => string | undefined
}): Promise<Runner> {
  const args = ['serve', '--stdio', ...(trust ? ['--trust'] : []), ...extra]
  log(`Starting ${executable} ${args.join(' ')} in ${repository}`)
  const child: ChildProcess = spawn(executable, args, {cwd: repository, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true})
  const client = createRpcClient({input: child.stdout!, output: child.stdin!, log})
  // A backend that exits never answers; writing to it must not throw.
  child.stdin!.on('error', () => {})
  const exited = new Promise<number | null>(resolve => {
    child.once('exit', code => {
      client.close(`The Projections backend exited (${code})`)
      resolve(code)
    })
    child.once('error', error => {
      client.close(`Could not start ${executable}: ${error.message}. Set projections.cliPath or PROJECTIONS_CLI.`)
      resolve(null)
    })
  })
  createInterface({input: child.stderr!}).on('line', line => log(line))
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.stdin!.end()
    const kill = setTimeout(() => child.kill('SIGTERM'), 3000)
    void exited.then(() => clearTimeout(kill))
  }
  try {
    const initialized = await Promise.race([
      client.call('initialize'),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`projections serve did not start within ${timeoutMs / 1000} seconds`)), timeoutMs)
      }),
    ])
    const info = parseInfo(initialized.result)
    const refused = check?.(info)
    if (refused) throw new Error(refused)
    log(
      `Projections backend ${info.version} serving ${info.repository}${info.trusted ? ' (trusted)' : ''}${info.explore ? ' (explore session)' : ''}`,
    )
    return {
      info,
      trusted: info.trusted,
      exited,
      stop,
      onNotification: listener => client.onNotification(listener),
      request: async ({method, path, body}, signal) =>
        parseResponse(await client.call('request', {method, path, ...(body === undefined ? {} : {body})}, signal)),
      tools: async signal => parseTools((await client.call('tools/list', undefined, signal)).result),
      callTool: async (name, toolArguments, signal) =>
        parseToolResult((await client.call('tools/call', {name, arguments: toolArguments}, signal)).result),
    }
  } catch (error) {
    stop()
    child.kill()
    throw error
  } finally {
    clearTimeout(timer)
  }
}
