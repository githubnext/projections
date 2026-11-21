// Switching what the side bar's Viewing view shows, in real VS Code with a projection tab open: for each switch, what
// the extension did (tree refreshes, tab pages loaded, pairs sent, extraction jobs; `src/probe.ts`), each distinct
// state the tab's page and the side bar drew (sampled every animation frame) and a strip of the screencast's frames.
//   node scripts/screenshots/switch-frames.mjs <output directory> [repository to copy] [projection title]
// Without a repository it uses the smoke test's acme repository. The repository is copied; the copy is changed only
// by the extension.
import {execFileSync} from 'node:child_process'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {chromium} from 'playwright-core'
import {createDemoRepository} from '../../test/smoke/demo-repo.mjs'
import {cli, command, inspectorFrame, launch} from './electron.mjs'

const noop = () => undefined

const output = process.argv[2]
if (!output) throw new Error('Usage: switch-frames.mjs <output directory> [repository] [projection title]')
const source = process.argv[3]
const title = process.argv[4] ?? 'Package dependencies'
await mkdir(output, {recursive: true})
const repository = source
  ? join(await mkdtemp(join(tmpdir(), 'projections-switch-')), 'repo')
  : await createDemoRepository(cli, {acme: true})
if (source) execFileSync('cp', ['-R', source, repository])
const log = join(await mkdtemp(join(tmpdir(), 'projections-switch-log-')), 'events.jsonl')
process.env.PROJECTIONS_TEST_EVENT_LOG = log

const sleep = ms =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })
/** Records each distinct state of `read()` once a frame, in the page it runs in, as `globalThis[key]`. */
function sampler({key, read}) {
  const reader = new Function(`return (${read})()`)
  const state = {frames: [], last: '', messages: []}
  globalThis[key] = state
  // Renderer frames' messages (from their opaque origin): `ready` is a frame that loaded, `rendered` a render.
  addEventListener('message', event => {
    const type = event.data?.type
    if (event.origin === 'null' && event.data?.projections !== undefined && typeof type === 'string' && state.messages.length < 5000) {
      state.messages.push({t: Date.now(), type})
    }
  })
  const tick = () => {
    try {
      const value = reader()
      const text = JSON.stringify(value)
      if (text !== state.last && state.frames.length < 5000) state.frames.push({t: Date.now(), ...value})
      state.last = text
    } catch {
      // A page between documents.
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
// The tab's page: its skeleton or empty states, loading indicators and what its view presents.
const readPage = String(() => {
  const view = document.querySelector('.phv-root')
  const visible = element => {
    const box = element.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && getComputedStyle(element).opacity !== '0' && getComputedStyle(element).visibility !== 'hidden'
  }
  return {
    skeleton: Boolean(document.querySelector('[data-skeleton]')),
    empty: Boolean(document.querySelector('#root .pi-empty, #root .ph-computing')),
    loading: [...document.querySelectorAll('[data-loading-indicator], vscode-progress-ring, .ph-loading-indicator')].filter(visible).length,
    mode: view?.getAttribute('data-mode') ?? null,
    status: view?.getAttribute('data-renderer-status') ?? null,
    frame: [...document.querySelectorAll('#root iframe')].filter(visible).length,
    bar: (document.querySelector('[data-summary-bar]')?.textContent ?? '').trim().slice(0, 100),
  }
})
// The side bar: the Viewing view's rows (a check on the chosen one) and the Projections view's (badge and description).
const readSidebar = String(() => {
  const pane = name =>
    [...document.querySelectorAll('.part.sidebar .pane')].find(item =>
      (item.querySelector('.pane-header')?.textContent ?? '').trim().startsWith(name),
    )
  const rows = name =>
    [...(pane(name)?.querySelectorAll('.monaco-list-row') ?? [])].map(row =>
      [
        row.querySelector('.codicon-check') ? '✓' : '',
        (row.querySelector('.label-name')?.textContent ?? '').trim(),
        (row.querySelector('.label-description')?.textContent ?? '').trim(),
        (row.querySelector('.monaco-decoration-itemColor, .label-name')?.getAttribute('data-decoration') ?? '').trim(),
        getComputedStyle(row.querySelector('.label-name') ?? row).color,
      ].join('|'),
    )
  return {viewing: rows('Viewing').join(' / '), projections: rows('Projections').join(' / ')}
})

const {app, window} = await launch({repository})
const events = async () =>
  (await readFile(log, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
try {
  await command(window, 'View: Show Projections')
  const sidebar = window.locator('.part.sidebar')
  const projections = sidebar.locator('.pane', {has: window.locator('.pane-header', {hasText: /^\s*Projections/})})
  const row = projections.locator('.monaco-list-row', {hasText: title}).first()
  await row.waitFor({timeout: 90_000})
  await row.click()
  const frame = await inspectorFrame(window)
  await frame.locator('.phv-root[data-renderer-status="ready"]').first().waitFor({timeout: 120_000})
  await sleep(3000)
  const viewing = sidebar.locator('.pane', {has: window.locator('.pane-header', {hasText: /^\s*Viewing/})})
  // Recent changes, open: it checks the recent commits (with every projection), which is left to finish first.
  const recent = viewing.locator('.monaco-list-row', {hasText: 'Recent changes'}).first()
  if ((await recent.getAttribute('aria-expanded')) !== 'true') await recent.click()
  await sleep(1000)
  for (let waited = 0; waited < 180_000; waited += 1000) {
    if (!(await viewing.locator('.monaco-list-row .codicon-loading').count())) break
    await sleep(1000)
  }
  await sleep(2000)
  await frame.evaluate(sampler, {key: '__switchFrames', read: readPage})
  await window.evaluate(sampler, {key: '__switchFrames', read: readSidebar})
  const cdp = await window.context().newCDPSession(window)
  const screencast = []
  cdp.on('Page.screencastFrame', ({data, sessionId, metadata}) => {
    screencast.push({t: Math.round(metadata.timestamp * 1000), data})
    void cdp.send('Page.screencastFrameAck', {sessionId}).catch(noop)
  })
  await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 70, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1})
  // Current state, Uncommitted changes and the first recent commit, twice: extracted the first time, shown again after.
  const labels = await viewing.locator('.monaco-list-row .label-name').allTextContents()
  const recentCommit = labels[labels.findIndex(text => text.trim() === 'Recent changes') + 1]?.trim()
  if (!recentCommit) throw new Error(`No recent commit in ${labels.join(', ')}`)
  const switches = [
    'Uncommitted changes',
    'Current state',
    recentCommit,
    'Uncommitted changes',
    'Current state',
    recentCommit,
    'Uncommitted changes',
    'Current state',
  ]
  const results = []
  const strips = []
  for (const [index, label] of switches.entries()) {
    const target = viewing.locator('.monaco-list-row', {hasText: label}).first()
    const page0 = await frame.evaluate(() => globalThis.__switchFrames.frames.length)
    const messages0 = await frame.evaluate(() => globalThis.__switchFrames.messages.length)
    const side0 = await window.evaluate(() => globalThis.__switchFrames.frames.length)
    const shot0 = screencast.length
    const at = Date.now()
    await target.click()
    await sleep(5000)
    const end = Date.now()
    const page = (await frame.evaluate(() => globalThis.__switchFrames.frames)).slice(page0)
    const side = (await window.evaluate(() => globalThis.__switchFrames.frames)).slice(side0)
    const renderer = {}
    for (const {type} of (await frame.evaluate(() => globalThis.__switchFrames.messages)).slice(messages0)) {
      renderer[type] = (renderer[type] ?? 0) + 1
    }
    const counts = {}
    for (const event of (await events()).filter(item => item.t >= at && item.t < end)) counts[event.name] = (counts[event.name] ?? 0) + 1
    const shots = screencast.slice(shot0)
    results.push({switch: index + 1, to: label, counts, renderer, page, sidebar: side, screencastFrames: shots.length})
    // The frames whose picture changed, as a strip (each with its time since the click).
    const distinct = []
    for (const shot of shots) if (distinct.at(-1)?.data !== shot.data) distinct.push(shot)
    strips.push({at, frames: distinct})
    const strip = distinct.slice(0, 24)
    const html = `<!doctype html><body style="margin:0;background:#111;color:#ddd;font:12px -apple-system,sans-serif">
      <div style="padding:6px">Switch ${index + 1}: ${label}, ${distinct.length} distinct of ${shots.length} screencast frames</div>
      <div style="display:grid;grid-template-columns:repeat(4,360px);gap:4px;padding:4px">${strip
        .map(
          shot =>
            `<figure style="margin:0"><img src="data:image/jpeg;base64,${shot.data}" width="360"><figcaption>+${Math.max(0, shot.t - at)} ms</figcaption></figure>`,
        )
        .join('')}</div></body>`
    await writeFile(join(output, `switch-${index + 1}.html`), html)
    console.log(JSON.stringify({switch: index + 1, to: label, counts, renderer, pageStates: page.length, sidebarStates: side.length}))
  }
  await cdp.send('Page.stopScreencast').catch(noop)
  // Each strip as an image, and how many of its frames show the editor's view blank: next to no ink where the graph is.
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({viewport: {width: 1480, height: 400}})
    for (const [index, {at, frames}] of strips.entries()) {
      const ink = []
      for (const shot of frames) {
        ink.push({
          ms: Math.max(0, shot.t - at),
          ink: await page.evaluate(async data => {
            const image = new Image()
            image.src = `data:image/jpeg;base64,${data}`
            await image.decode()
            const canvas = new OffscreenCanvas(image.width, image.height)
            const context = canvas.getContext('2d')
            context.drawImage(image, 0, 0)
            // The editor's view, right of the side bar, between its toolbar and summary bar.
            const x = Math.round(image.width * 0.3)
            const y = Math.round(image.height * 0.2)
            const {data: pixels} = context.getImageData(x, y, Math.round(image.width * 0.65), Math.round(image.height * 0.6))
            let inked = 0
            const [r0, g0, b0] = [pixels[0], pixels[1], pixels[2]]
            for (let at = 0; at < pixels.length; at += 4) {
              if (Math.abs(pixels[at] - r0) + Math.abs(pixels[at + 1] - g0) + Math.abs(pixels[at + 2] - b0) > 40) inked++
            }
            return Math.round((inked / (pixels.length / 4)) * 10000) / 100
          }, shot.data),
        })
      }
      const typical = [...ink].map(item => item.ink).sort((a, b) => a - b)[Math.floor(ink.length / 2)] ?? 0
      results[index].ink = ink
      results[index].blankFrames = ink.filter(item => item.ink < typical * 0.25).length
      console.log(
        JSON.stringify({
          switch: index + 1,
          blankFrames: results[index].blankFrames,
          at: ink.filter(item => item.ink < typical * 0.25).map(item => item.ms),
        }),
      )
    }
    await writeFile(join(output, 'switches.json'), `${JSON.stringify(results, null, 2)}\n`)
    for (const index of switches.keys()) {
      await page.goto(pathToFileURL(join(output, `switch-${index + 1}.html`)).href)
      await page.screenshot({path: join(output, `switch-${index + 1}.png`), fullPage: true})
    }
  } finally {
    await browser.close()
  }
} catch (error) {
  console.error(JSON.stringify(await window.evaluate(() => globalThis.__switchFrames?.frames.slice(-6)).catch(() => null), null, 1))
  await window.screenshot({path: join(output, 'failure.png'), timeout: 10_000}).catch(console.error)
  throw error
} finally {
  await app.close()
  await rm(log, {force: true})
}
