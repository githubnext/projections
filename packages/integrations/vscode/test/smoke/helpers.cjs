// What the smoke test's workflows share (see suite.cjs): waiting, driving the Inspector, and the session each workflow
// is given, with the side bar's test API and the helpers that read it.
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const vscode = require('vscode')
const {execFileSync} = require('node:child_process')

const extensionId = 'githubnext.projections-vscode'

const control = (message, target) => vscode.commands.executeCommand('projections.inspectorControl', message, target)
/** Polls `check` until it returns something; on timeout, the error adds what `describe` reports, to diagnose it. */
async function until(what, check, timeoutMs = 60_000, describe) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await check()
    } catch (error) {
      last = undefined
      if (Date.now() + 250 >= deadline) throw error
    }
    if (last) return last
    await new Promise(resolve => {
      setTimeout(resolve, 250)
    })
  }
  const state = describe ? await describe().catch(error => `(describing it failed: ${error.message})`) : undefined
  throw new Error(
    `Timed out waiting for ${what}${state === undefined ? '' : `: ${typeof state === 'string' ? state : JSON.stringify(state)}`}`,
  )
}
const elements = (selector, attribute, target) => control({op: 'elements', selector, ...(attribute ? {attribute} : {})}, target)

/**
 * The demo repository's folder, the extension's test API (activating it again returns the same) and the helpers that
 * read the side bar and the projection tabs, for every workflow.
 */
async function session() {
  const folder = vscode.workspace.workspaceFolders[0].uri
  const extension = await vscode.extensions.getExtension(extensionId).activate()
  const api = extension.sidebar
  const mergeBase = execFileSync('git', ['merge-base', 'main', 'HEAD'], {cwd: folder.fsPath}).toString().trim()
  const manifest = vscode.extensions.getExtension(extensionId).packageJSON.contributes
  const choiceName = async () => {
    const bar = api.statusBar()
    // While the tab in front's job runs (and for a moment after, as the spinner shows at least 400 ms), it's a spinner.
    if (!bar.visible || / \$\(sync(~spin)?\)$/.test(bar.text ?? '')) return undefined
    return bar.text?.replace(/^\$\(projections-mark\) /, '').replace(/ \$\(warning\)$/, '')
  }
  /** A subject as the status bar cuts it, at 24 characters with an ellipsis. */
  const short = text => ([...text].length <= 24 ? text : `${[...text].slice(0, 23).join('').trimEnd()}…`)
  const swaps = async () => api.viewing().rows.filter(row => /\bswappable\b/.test(row.contextValue ?? '')).length
  const summaryBar = async () =>
    (await api.control('packages', {op: 'elements', selector: '[data-summary-bar]', attribute: 'data-sentence'}))[0]?.value ?? ''
  const shownSummary = () => api.tabs('packages')[0]?.summary ?? null
  const tabShows = (what, check) =>
    until(what, async () => {
      const summary = shownSummary()
      return summary?.comparison?.compared && check(summary) ? summary : undefined
    })
  const projectionTabs = () =>
    vscode.window.tabGroups.all
      .flatMap(group => group.tabs)
      .filter(tab => tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'projections.projection')
  /** An agent tool's result, as VS Code's agent gets it. */
  const invoke = async (name, input) =>
    (await vscode.lm.invokeTool(name, {input, toolInvocationToken: undefined})).content.map(part => part.value ?? '').join('')
  return {
    folder,
    tests: extension.comparatorTests,
    api,
    manifest,
    mergeBase,
    choiceName,
    short,
    swaps,
    summaryBar,
    shownSummary,
    tabShows,
    projectionTabs,
    invoke,
  }
}

/**
 * Runs git in `cwd` and resolves with its trimmed output, retrying while another git process holds the index lock:
 * VS Code's own git extension refreshes the workspace in the background, and on Windows its lock can outlast a test's
 * next command.
 */
async function git(cwd, ...args) {
  for (let attempt = 0; ; attempt++) {
    try {
      return execFileSync('git', args, {cwd, encoding: 'utf8', stdio: 'pipe'}).trim()
    } catch (error) {
      if (attempt >= 20 || !String(error.stderr ?? error.message).includes('index.lock')) throw error
      await new Promise(resolve => {
        setTimeout(resolve, 250)
      })
    }
  }
}

module.exports = {control, until, elements, session, git}
