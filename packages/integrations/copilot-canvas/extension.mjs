// The Projections viewer as a GitHub Copilot app canvas: a thin adapter over `projections view`, the page on loopback
// that an agent drives and a person watches (docs/design/agent-viewer.md). `open()` starts or reuses the repository's
// viewer and returns its URL; the actions are the agent tools of the same names and schemas (`open_projection`,
// `current_view`, `screenshot`, `refresh`), answered by the same viewer through `projections view …`. The viewer is
// keyed by project (the repository, or a directory in it with projections of its own), not by canvas instance, so
// opening again (or rehydrating after a reload) shows the same view. The project is the nearest one from the session's
// working directory, as for the CLI, or the one a `project` input names. A `viewer` input names one of several
// independent viewers, each its own page, so canvases side by side can show different projections; an instance
// opened on a named viewer keeps it, and its actions address it unless they name another.
//
// Install it in a repository with `projections canvas install` (it copies this file to
// .github/extensions/projections/extension.mjs). It needs the `projections` CLI on PATH, or PROJECTIONS_CLI naming it.
// A viewer runs repository code (custom extractors and renderers) only when started with --trust: after reviewing the
// repository's projections, run `projections view --trust`, which replaces a viewer running without trust at the same
// URL, so the canvas reconnects. The canvas never grants trust itself, nor remembers it across restarts: trust is a
// review of the code as it is now, and a later checkout may run different code.
//
// Standard output is the extension's JSON-RPC channel: nothing here writes to it.
import {execFile, spawn} from 'node:child_process'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createInterface} from 'node:readline'
import {CanvasError, createCanvas, joinSession} from '@github/copilot-sdk/extension'

const cli = process.env.PROJECTIONS_CLI || 'projections'
/** The tools this canvas answers, by the names VS Code's agent and `projections mcp` use. */
const actions = ['open_projection', 'current_view', 'screenshot', 'refresh']

/** Runs the CLI; resolves `{code, stdout, stderr, error}` and never rejects for a failing command. */
function run(args, cwd, timeout = 300_000) {
  return new Promise(resolve => {
    execFile(cli, args, {cwd, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true}, (error, stdout, stderr) =>
      resolve({code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr, error}),
    )
  })
}

/**
 * The tools' schemas and descriptions, from the CLI's own catalog (`projections mcp`'s `tools/list`), so the actions
 * take exactly what the tools take. Without the CLI the actions still exist, and say how to install it.
 */
function catalog(cwd) {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(cli, ['mcp'], {cwd, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true})
    } catch {
      resolve([])
      return
    }
    let finished = false
    const done = tools => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      child.stdin.end()
      resolve(tools)
    }
    const timer = setTimeout(() => done([]), 15_000)
    child.on('error', () => done([]))
    child.stdin.on('error', () => {})
    createInterface({input: child.stdout}).on('line', line => {
      try {
        const message = JSON.parse(line)
        if (message.id === 2) done(message.result?.tools ?? [])
      } catch {
        // Not a protocol line.
      }
    })
    const send = message => child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', ...message})}\n`)
    send({
      id: 1,
      method: 'initialize',
      params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'projections-canvas', version: '1'}},
    })
    send({id: 2, method: 'tools/list'})
  })
}

/** The repository a directory is in: its Git root. */
function repository(directory) {
  const cwd = directory || process.cwd()
  return new Promise(resolve =>
    execFile('git', ['rev-parse', '--show-toplevel'], {cwd}, (error, stdout) => resolve(error ? cwd : stdout.trim() || cwd)),
  )
}

/** The `project` input: a project directory relative to the repository's root, which the CLI takes as `--root`. */
const projectInput = {
  type: 'string',
  description:
    "The project whose projections to show: a directory relative to the repository's root with its own .github/projections. Default: the nearest one from the session's working directory, else the repository's root.",
}

/**
 * Where the CLI runs for a session, and the options that pick the project: from the session's working directory, so
 * the CLI finds the nearest project as it does in a terminal, or from the repository's root with `--root` for a
 * `project` input.
 */
async function place(directory, input) {
  if (typeof input?.project === 'string' && input.project) return {cwd: await repository(directory), root: ['--root', input.project]}
  return {cwd: directory || process.cwd(), root: []}
}

/** Why a CLI call failed, in its own words. */
function failure(result) {
  if (result.error?.code === 'ENOENT') {
    return "The projections CLI isn't installed (or PROJECTIONS_CLI doesn't name it): install it, then open the canvas again."
  }
  // The tool's own answer (its text, or with --json its error) says why; the last lines of standard error otherwise.
  const answer = result.stdout.trim()
  if (answer) {
    try {
      const value = JSON.parse(answer.split('\n').at(-1))
      if (typeof value?.error === 'string') return value.error
    } catch {
      // Text, not JSON.
    }
    return answer
  }
  return (result.stderr || String(result.error ?? 'projections failed')).trim().split('\n').slice(-6).join('\n')
}

/** A tool's arguments as `projections view` options. */
function options(input, keys) {
  const flags = []
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' || typeof value === 'number') flags.push(key === 'projection' ? '-p' : `--${key}`, String(value))
  }
  return flags
}
const showKeys = ['projection', 'choice', 'before', 'after', 'mode', 'entity', 'scenario', 'viewer']

/** Calls one of the tools on the project's viewer, as the tool returns it: its text, and a screenshot's image. */
async function call({cwd, root}, name, input) {
  if (name === 'screenshot') {
    const directory = await mkdtemp(join(tmpdir(), 'projections-canvas-'))
    try {
      const out = join(directory, 'view.png')
      const keys = ['projection', 'before', 'after', 'mode', 'theme', 'progress', 'width', 'height', 'viewer']
      const shot = await run([...root, 'view', 'screenshot', '--out', out, ...options(input, keys)], cwd)
      if (shot.code !== 0) throw new CanvasError('projections_failed', failure(shot))
      const data = (await readFile(out)).toString('base64')
      return {
        textResultForLlm: shot.stdout,
        binaryResultsForLlm: [{type: 'image', mimeType: 'image/png', data, description: 'What the viewer shows'}],
        resultType: 'success',
      }
    } finally {
      await rm(directory, {recursive: true, force: true})
    }
  }
  const args =
    name === 'open_projection'
      ? ['view', 'show', ...options(input, showKeys)]
      : name === 'current_view'
        ? ['view', 'current', ...options(input, ['viewer'])]
        : name === 'refresh'
          ? ['view', 'refresh', ...options(input, ['viewer'])]
          : undefined
  if (!args) throw new CanvasError('unknown_action', `Projections has no ${name} action`)
  const answered = await run([...root, ...args], cwd)
  if (answered.code !== 0) throw new CanvasError('projections_failed', failure(answered))
  return {textResultForLlm: answered.stdout, resultType: 'success'}
}

/**
 * The inputs each canvas instance was opened with, kept in the session's workspace: `open()` runs again for the same
 * instance after a reload (to rehydrate it), and must not undo what the agent showed since by applying its first input
 * again. Keyed by instance, it says only whether that input was already shown.
 */
let session
const shownFile = () => (session?.workspacePath ? join(session.workspacePath, 'projections-canvas.json') : undefined)
async function alreadyShown(instanceId, input) {
  const file = shownFile()
  const shown = file ? await readFile(file, 'utf8').then(JSON.parse, () => ({})) : {}
  const key = JSON.stringify(input)
  if (shown[instanceId] === key) return true
  shown[instanceId] = key
  if (file) await writeFile(file, JSON.stringify(shown)).catch(() => {})
  return false
}

/** The named viewer an instance was opened on, which its actions address unless they name another. */
async function instanceViewer(instanceId) {
  const file = shownFile()
  if (!file || !instanceId) return undefined
  const shown = await readFile(file, 'utf8').then(JSON.parse, () => ({}))
  try {
    const viewer = JSON.parse(shown[instanceId] ?? '{}').viewer
    return typeof viewer === 'string' ? viewer : undefined
  } catch {
    return undefined
  }
}

/** An action's input, addressing the instance's named viewer when it names none. */
async function withViewer(ctx) {
  const input = ctx.input ?? {}
  if (typeof input.viewer === 'string') return input
  const viewer = await instanceViewer(ctx.instanceId)
  return viewer ? {...input, viewer} : input
}

const root = await repository(process.cwd())
const tools = await catalog(root)
const tool = name => tools.find(item => item.name === name)
/** A tool's input schema with the canvas's own `project` input. */
const withProject = schema => (schema?.type === 'object' ? {...schema, properties: {...schema.properties, project: projectInput}} : schema)

const canvas = createCanvas({
  id: 'projections',
  displayName: 'Projections',
  description:
    'Show the person a projection of this repository (its services, schemas, dependencies or APIs, and how a change reshapes them) in a viewer they watch while you drive it.',
  ...(tool('open_projection') ? {inputSchema: withProject(tool('open_projection').inputSchema)} : {}),
  actions: actions.map(name => ({
    name,
    description: tool(name)?.description ?? `The Projections ${name} tool; it needs the projections CLI.`,
    ...(tool(name) ? {inputSchema: withProject(tool(name).inputSchema)} : {}),
    handler: async ctx => {
      const input = await withViewer(ctx)
      return call(await place(ctx.session?.workingDirectory ?? root, input), name, input)
    },
  })),
  // One viewer per repository and name: opening again, or rehydrating after a reload, returns the same page; the input
  // shows that projection there first.
  open: async ctx => {
    const input = ctx.input ?? {}
    const {cwd, root: project} = await place(ctx.session?.workingDirectory ?? root, input)
    const again = await alreadyShown(ctx.instanceId, input)
    const shown = await run([...project, 'view', 'show', '--json', ...(again ? options(input, ['viewer']) : options(input, showKeys))], cwd)
    if (shown.code !== 0) throw new CanvasError('projections_failed', failure(shown))
    const view = JSON.parse(shown.stdout.trim().split('\n').at(-1) || '{}')
    if (typeof view.url !== 'string') throw new CanvasError('projections_failed', 'The viewer gave no URL')
    return {
      url: view.url,
      title: view.title ? `${view.title} · Projections` : 'Projections',
      ...(view.compared ? {status: view.compared} : {}),
    }
  },
})

session = await joinSession({
  canvases: [canvas],
  hooks: {
    onSessionStart: async () => ({
      additionalContext:
        'Projections can show the person a projection of this repository (its systems, and how a change reshapes them) in the "projections" canvas: open it with open_canvas, whose input is open_projection\'s (projection, and before and after or a choice such as branch, uncommitted or last-commit). ' +
        'Its actions are the Projections tools of the same names: open_projection, current_view (what they see and selected, and why an extraction failed), screenshot (an image of it) and refresh. ' +
        "To show several projections side by side, open more canvases, each with its own viewer name (viewer). They watch, play and select there, and can switch a canvas to another projection from its title; they don't edit.",
    }),
  },
})
