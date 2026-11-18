// Runs inside VS Code's extension host, in order with the other workflows (see ../suite.cjs).
/* eslint-disable @typescript-eslint/no-require-imports -- VS Code loads extension tests with require() */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const vscode = require('vscode')
const {until, git: run} = require('../helpers.cjs')

module.exports = async function currentView({folder, api, invoke}) {
  // The agent knows the projection tab the person is looking at. A CI pipeline whose last commit removes the Test
  // job (and splits it into Unit tests and Deploy) is shown on Last commit, pinned to its tab: the folder's choice and
  // the suggested pair (the branch since main) only add jobs. Asked "what is this projection?" and "what was
  // removed?", the agent reads the current view and compares exactly what is on screen, and says so.
  const git = (...args) => run(folder.fsPath, ...args)
  const workflow = jobs => `name: CI\non: [push]\njobs:\n${jobs}`
  const job = (id, name, needs) =>
    `  ${id}:\n    name: ${name}\n${needs ? `    needs: ${needs}\n` : ''}    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${id}\n`
  await fs.mkdir(path.join(folder.fsPath, '.github', 'workflows'), {recursive: true})
  const ciFile = path.join(folder.fsPath, '.github', 'workflows', 'ci.yml')
  await fs.writeFile(ciFile, workflow(job('build', 'Build') + job('test', 'Test', 'build')))
  await fs.writeFile(
    path.join(folder.fsPath, '.github', 'projections', 'ci-jobs.json'),
    `${JSON.stringify({id: 'ci-jobs', title: 'CI pipeline', extractor: 'github-actions-jobs', renderer: 'dag', inputs: {workflowPath: '.github/workflows/ci.yml'}}, null, 2)}\n`,
  )
  await git('add', '.github/workflows/ci.yml', '.github/projections/ci-jobs.json')
  await git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Add CI workflow')
  await fs.writeFile(ciFile, workflow(job('build', 'Build') + job('unit', 'Unit tests', 'build') + job('deploy', 'Deploy', 'unit')))
  await git('add', '.github/workflows/ci.yml')
  await git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Deploy after unit tests')
  const [before, after] = [await git('rev-parse', 'HEAD~1'), await git('rev-parse', 'HEAD')]
  assert.ok(vscode.lm.tools.some(tool => tool.name === 'projections_current_view'))
  await until('the CI pipeline row', async () => api.rows()[0].projections.some(row => row.id === 'ci-jobs'))
  const opened = await invoke('projections_open_projection', {projection: 'ci-jobs', before: 'HEAD~1', after: 'HEAD', pin: true})
  assert.match(opened, /^Opened CI pipeline \(ci-jobs\)/, opened)
  const view = await until(
    'the current view of the compared CI pipeline',
    async () => {
      const text = await invoke('projections_current_view', {})
      return /^- removed \S+ Test \[/m.test(text) && /^Mode: /m.test(text) ? text : undefined
    },
    90_000,
  )
  assert.match(view, /^The projection tab in front is "CI pipeline" \(projection ci-jobs\) in /m, view)
  assert.match(view, /^Definition: \.github\/projections\/ci-jobs\.json; extractor `github-actions-jobs`/m, view)
  assert.match(view, /, pinned to this tab\./, view)
  assert.match(view, new RegExp(`^Revisions: before ${before}, after ${after}\\.$`, 'm'), view)
  // The mode the tab shows, as its title bar's mode toggle reads it (which it reports every half second).
  const modeNames = {'side-by-side': 'Side by side', animated: 'Animated', swipe: 'Swipe', diff: 'Diff'}
  await until('the current view in the mode the tab reports', async () => {
    const mode = modeNames[api.tabs('ci-jobs').at(-1).summary?.view?.mode]
    return (mode && new RegExp(`^Mode: ${mode} \\(of `, 'm').test(await invoke('projections_current_view', {}))) || undefined
  })
  // The person switches the mode: the view says the new one.
  await api.control('ci-jobs', {op: 'view', action: 'setMode', value: 'swipe'})
  await until(
    'the current view in Swipe',
    async () => /^Mode: Swipe \(of /m.test(await invoke('projections_current_view', {})) || undefined,
  )
  // The agent sets the mode, refreshes the tab and screenshots what it shows: the same tools projections mcp answers
  // with its viewer.
  const moded = await invoke('projections_open_projection', {
    projection: 'ci-jobs',
    before: 'HEAD~1',
    after: 'HEAD',
    pin: true,
    mode: 'side-by-side',
  })
  assert.match(moded, /, in side-by-side/, moded)
  assert.match(await invoke('projections_refresh', {}), /^Extracted again\.\n\nThe projection tab in front is "CI pipeline"/)
  const shot = await vscode.lm.invokeTool('projections_screenshot', {input: {width: 640, height: 400}, toolInvocationToken: undefined})
  const shotText = shot.content.map(part => part.value ?? '').join('')
  // Rendering needs Chrome, Chromium or Edge, which a runner may lack.
  if (!/needs? (Chrome|a browser)|No (Chrome|browser)|browser executable/i.test(shotText)) {
    assert.match(shotText, /^Projection: ci-jobs, the one the "CI pipeline" tab shows\.[\s\S]*Rendered ci-jobs on /, shotText)
    assert.match(shotText, /side-by-side/, shotText)
    assert.ok(
      shot.content.some(part => part.mimeType === 'image/png' && part.data?.length > 1000),
      shotText,
    )
  }
  assert.match(view, /^- added \S+ Unit tests \[/m, view)
  assert.match(view, /^Summary bar: /m, view)
  // compare without a projection or revisions compares the tab's, and says so.
  const compared = await invoke('projections_compare', {})
  assert.match(
    compared,
    new RegExp(
      `^Projection: ci-jobs, the one the "CI pipeline" tab shows\\. Revisions: ${before.slice(0, 8)} → ${after.slice(0, 8)}, the ones the "CI pipeline" tab shows \\([^)]*, pinned to the tab\\)\\. This is the comparison on the person's screen\\.`,
    ),
    compared,
  )
  assert.match(compared, /^ *Removed entity Test \[job:test\]$/m, compared)
  assert.match(compared, new RegExp(`Comparing ${before} \\(`), compared)
  // Revisions other than the tab's are said not to be the ones on screen.
  const asked = await invoke('projections_compare', {before: 'HEAD~2', after: 'HEAD~1'})
  assert.match(
    asked,
    /^Projection: ci-jobs, the one the "CI pipeline" tab shows\. Revisions: as asked\. Not the comparison the "CI pipeline" tab shows/,
    asked,
  )
  // Before the commit that added the workflow, the pipeline didn't exist yet: the tab shows its jobs added, with a
  // notice naming the missing file, rather than an extraction failure.
  const added = await git('rev-parse', 'HEAD~2')
  await invoke('projections_open_projection', {projection: 'ci-jobs', before: 'HEAD~2', after: 'HEAD~1', pin: true})
  const notice = `\`.github/workflows/ci.yml\` doesn't exist at \`${added.slice(0, 8)}\`, so its contents show as added.`
  const missing = await until(
    'the CI pipeline added since before its workflow existed',
    async () => {
      const text = await invoke('projections_current_view', {})
      return text.includes(`Notice: ${notice}`) && /^- added \S+ Test \[/m.test(text) ? text : undefined
    },
    90_000,
  )
  assert.match(missing, /^- added \S+ Build \[/m, missing)
  assert.doesNotMatch(missing, /^- (removed|modified) /m, missing)
  assert.doesNotMatch(missing, /^Status: failed/m, missing)
}
