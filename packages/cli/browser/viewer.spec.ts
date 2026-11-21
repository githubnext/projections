// The agent viewer (`projections view`): the page reflects what the agent shows, reports the person's selection and
// mode, mirrors them across open pages, refuses requests without its token, and names no files, even on errors. At a
// canvas's width its header text is whole and its chrome lies flat, edge to edge, every control works, and a page that
// loses its server says so and takes no input. A named viewer is a page of its own, and the person switches a page's
// projection from its title. Where a browser won't load renderer frames' URLs, the page opens their documents itself.
import {test, expect, chromium} from '@playwright/test'
import type {Page} from '@playwright/test'
import {execFileSync, spawn, spawnSync} from 'node:child_process'
import type {ChildProcess} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createInterface} from 'node:readline'

const cli = process.env.PROJECTIONS_CLI!
let repository: string
let cache: string
let viewer: ChildProcess
let url: string
/** A commit off every branch whose subject is longer than a header has room for. */
let long: string
const subject =
  'Merge remote-tracking branch origin/a-very-long-feature-branch-name-for-the-header into the-default-branch-of-this-repository'

const write = (path: string, value: unknown) => {
  mkdirSync(join(repository, path, '..'), {recursive: true})
  writeFileSync(join(repository, path), typeof value === 'string' ? value : JSON.stringify(value))
}
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Viewer', '-c', 'user.email=viewer@example.invalid', ...args], {cwd: repository, stdio: 'pipe'})

test.beforeAll(async () => {
  repository = mkdtempSync(join(tmpdir(), 'projections-viewer-'))
  cache = mkdtempSync(join(tmpdir(), 'projections-viewer-cache-'))
  write('package.json', {name: 'root', private: true, workspaces: ['packages/*']})
  write('packages/a/package.json', {name: 'a', version: '1.0.0'})
  write('packages/b/package.json', {name: 'b', version: '1.0.0'})
  write('.github/projections/packages.json', {
    id: 'packages',
    title: 'Package map',
    extractor: 'workspace-dependencies',
    renderer: 'dependencies',
  })
  // Its extractor is missing: its failure's diagnostics name files, which the page must not show.
  write('.github/projections/broken.json', {
    id: 'broken',
    title: 'Broken map',
    extractor: {command: ['node', 'tools/missing-extractor.mjs']},
    renderer: 'graph',
  })
  git('init', '-q', '--initial-branch=main')
  git('add', '.')
  git('commit', '-qm', 'Add the package map')
  write('packages/b/package.json', {name: 'b', version: '1.0.0', dependencies: {a: 'workspace:*'}})
  git('commit', '-qam', 'b uses a')
  long = git('commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', subject).toString().trim()
  viewer = spawn(cli, ['view', '--trust', '-p', 'packages', '--choice', 'last-commit'], {
    cwd: repository,
    env: {...process.env, PROJECTIONS_CACHE_DIR: cache},
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  url = await new Promise<string>((resolve, reject) => {
    viewer.once('exit', code => reject(new Error(`projections view exited with ${code}`)))
    createInterface({input: viewer.stdout!}).once('line', resolve)
  })
})

test.afterAll(async () => {
  // Windows keeps a running process's directory in use: wait for the viewer to exit, and retry while it lets go.
  // Unset when beforeAll failed before starting it.
  const running = viewer as ChildProcess | undefined
  if (running?.exitCode === null && running.signalCode === null) {
    const exited = new Promise(resolve => running.once('exit', resolve))
    running.kill()
    await exited
  }
  for (const directory of [repository, cache]) rmSync(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 200})
})

async function control(path: string, body?: unknown) {
  const response = await fetch(new URL(path, url), {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}),
  })
  return {status: response.status, body: await response.json()}
}
const state = async () => (await control('control/state')).body

/** The page's own text, outside renderer frames, and the paths it names. */
async function pathsIn(page: Page) {
  const text = await page.evaluate(() => document.body.innerText)
  return (
    text.match(/(^|[\s("'\x60])(\/|~\/|\.{1,2}\/)\S*|[\w.-]+\/[\w.-]+\/\S*|\b[\w-]+\.(json|mjs|js|ts|yaml|yml)\b|[A-Za-z]:\\\S*/g) ?? []
  )
}

test('requests without the token are refused, and the bare port says how to get the link', async ({page}) => {
  const origin = new URL(url).origin
  const bare = await fetch(`${origin}/`)
  expect(bare.status).toBe(404)
  const token = new URL(url).pathname.split('/')[1]!
  expect(await bare.text()).not.toContain(token)
  expect((await fetch(`${origin}/mount.js`)).status).toBe(404)
  expect((await fetch(url)).status).toBe(200)
  await page.goto(`${origin}/`)
  await expect(page.getByRole('heading', {name: 'Projections viewer'})).toBeVisible()
  await expect(page.locator('body')).toContainText('projections view current')
  expect(page.url()).toBe(`${origin}/`)
})

test('a page framed by a document that is not a secure context still counts as open', async () => {
  // An app's preview pane whose own document is plain http (or a custom scheme) isn't a secure context, and neither is
  // the viewer framed in it, though its loopback origin would be: `crypto.randomUUID` is missing there. Chrome itself
  // refuses such a frame to loopback (its Local Network Access checks), so this is a browser without those checks, as
  // some apps' web views are.
  const browser = await chromium.launch({args: ['--disable-features=LocalNetworkAccessChecks']})
  try {
    expect((await control('control/show', {viewer: 'framed', projection: 'packages', choice: 'last-commit'})).status).toBe(200)
    const page = await browser.newPage()
    await page.route('http://preview.invalid/', route =>
      route.fulfill({contentType: 'text/html', body: `<iframe src="${url}?viewer=framed" style="width:900px;height:600px"></iframe>`}),
    )
    await page.goto('http://preview.invalid/')
    await expect(page.frameLocator('iframe').locator('.pi-viewer-header')).toContainText('Package map', {timeout: 30_000})
    expect(await page.frames()[1]!.evaluate(() => isSecureContext)).toBe(false)
    await expect.poll(async () => (await control('control/state?viewer=framed')).body.pages, {timeout: 15_000}).toBe(1)
  } finally {
    await browser.close()
  }
})

test('screenshot --page captures the viewer page, its chrome and all, without counting as a page', async () => {
  expect((await control('control/show', {projection: 'packages', choice: 'last-commit', mode: 'side-by-side'})).status).toBe(200)
  const out = join(mkdtempSync(join(tmpdir(), 'projections-viewer-shot-')), 'page.png')
  // The CLI finds its browser as its other captures do (PROJECTIONS_BROWSER, else PATH, else the usual install
  // locations): on CI that is the runner's Chrome, whose sandbox works there. Without one it is skipped, except on CI.
  const shot = spawnSync(cli, ['view', 'screenshot', '--page', '--width', '900', '--height', '600', '--out', out, '--json'], {
    cwd: repository,
    env: {...process.env, PROJECTIONS_CACHE_DIR: cache},
    timeout: 150_000,
  })
  const noBrowser = String(shot.stderr).includes('No Chrome, Chromium or Microsoft Edge was found')
  test.skip(noBrowser && !process.env.CI, 'no Chrome, Chromium or Edge is installed')
  expect(shot.status, String(shot.stderr)).toBe(0)
  const result = JSON.parse(String(shot.stdout))
  expect(result).toMatchObject({page: true, projection: 'packages', width: 900, height: 600})
  const png = readFileSync(out)
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([900, 600])
  rmSync(join(out, '..'), {recursive: true, force: true})
  // The capture watched without counting or reporting: no page of the default viewer was opened by it.
  expect((await state()).views.length).toBe(0)
})

test('the page reflects what the agent shows, reports the selection and mirrors it in two pages', async ({context}) => {
  const first = await context.newPage()
  await first.goto(url)
  await expect(first.locator('.pi-viewer-header')).toContainText('Package map')
  await expect(first.locator('.pi-viewer-compared')).toHaveText('Last commit')
  await expect.poll(async () => (await state()).page?.view?.status, {timeout: 30_000}).toBe('ok')

  // The agent shows another mode and selects an item: the page follows and says so.
  expect((await control('control/show', {mode: 'side-by-side', entity: 'workspace:b'})).status).toBe(200)
  await expect.poll(async () => (await state()).page?.selection, {timeout: 15_000}).toBe('workspace:b')
  expect((await state()).page.mode).toBe('side-by-side')

  // A second page shows the same, and what the person does in it mirrors to the first.
  const second = await context.newPage()
  await second.goto(url)
  await expect
    .poll(async () => (await state()).views.filter((view: {selection: string}) => view.selection === 'workspace:b').length, {
      timeout: 30_000,
    })
    .toBe(2)
  const modes = second.locator('.ph-toolbar').getByRole('radiogroup', {name: 'Comparison mode'}).first()
  await modes.getByRole('radio', {name: 'Swipe', exact: true}).click()
  await expect.poll(async () => (await state()).state.mode, {timeout: 10_000}).toBe('swipe')
  await expect
    .poll(async () => (await state()).views.map((view: {mode: string}) => view.mode), {timeout: 10_000})
    .toEqual(['swipe', 'swipe'])

  // The agent reads what the person sees and did, through the same tool VS Code's agent calls.
  const current = (await control('control/tool/current_view', {})).body
  expect(current.content[0].text).toContain('[workspace:b]')
  expect(current.structuredContent.mode).toBe('swipe')
  expect(current.structuredContent.pages).toBe(2)

  expect(await pathsIn(first)).toEqual([])
  await first.close()
  await second.close()
})

test('errors are plain words, and the page names no files', async ({page}) => {
  await page.goto(url)
  expect((await control('control/show', {projection: 'broken', choice: 'now'})).status).toBe(200)
  await expect(page.locator('.pi-viewer-header')).toContainText('Broken map')
  await expect(page.getByText("The extractor didn't run. The agent has the details.").first()).toBeVisible({timeout: 30_000})
  expect(await pathsIn(page)).toEqual([])
  // The agent gets the details the page leaves out.
  await expect
    .poll(async () => (await state()).page?.summary?.failures?.[0], {timeout: 10_000})
    .toMatchObject({ref: 'working-tree', message: expect.stringContaining('Cannot find module')})
  expect((await control('control/show', {projection: 'packages', choice: 'last-commit'})).status).toBe(200)
})

test("in the Copilot app's canvas, the page follows the app's theme tokens and color mode", async ({page}) => {
  await page.emulateMedia({colorScheme: 'light'})
  await page.goto(url)
  await expect(page.locator('.pi-viewer-header')).toBeVisible()
  // What the app does to a canvas document: its tokens and color mode on the root, here after the page loaded.
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent =
      ':root { --background-color-default: #14161c; --border-color-default: #2d3340; --text-color-default: #e6e8ee; --text-color-muted: #8b93a6; --color-focus-outline: #4c8dff; --font-sans: Georgia, serif; --font-mono: Menlo, monospace; --text-body-medium: 14px; }'
    document.head.append(style)
    document.documentElement.setAttribute('data-color-mode', 'dark')
  })
  await expect(page.locator('html')).toHaveClass(/pi-app-theme/)
  await expect(page.locator('.pi-viewer').first()).toHaveAttribute('data-color-mode', 'dark')
  await expect(page.locator('.pi-viewer-header')).toHaveCSS('background-color', 'rgb(20, 22, 28)')
  await expect(page.locator('.pi-viewer-header')).toHaveCSS('font-family', 'Georgia, serif')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--status-bar-color')))
    .toBe('rgb(20, 22, 28)')
  // Back to light with the app.
  await page.evaluate(() => document.documentElement.setAttribute('data-color-mode', 'light'))
  await expect(page.locator('.pi-viewer').first()).toHaveAttribute('data-color-mode', 'light')
})

/** The canvas panel the GitHub Copilot app shows the page in. */
const canvas = {width: 870, height: 900}

/** Opens the page (at `link`, the viewer's URL by default) at a canvas's size on two named revisions, once the comparison is presented by the renderer. */
async function openCanvas(page: Page, link = url) {
  await page.setViewportSize(canvas)
  await page.emulateMedia({colorScheme: 'dark'})
  expect((await control('control/show', {projection: 'packages', before: 'HEAD', after: long})).status).toBe(200)
  await page.goto(link)
  await expect(page.locator('.ph')).toHaveAttribute('data-renderer-status', 'ready', {timeout: 60_000})
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', /.+/)
  // The page has applied what the agent shows, including a mode an earlier test left: until then, a mode it applies
  // replaces one clicked before it (on a slow machine, the comparison is still extracting at this point).
  await expect
    .poll(
      async () => {
        const {page, state: shown} = await state()
        const chosen = Boolean(shown.mode)
        return page?.view?.status === 'ok' && (!chosen || page.mode === shown.mode)
      },
      {timeout: 30_000},
    )
    .toBe(true)
}

test("where a browser blocks renderer frames from loading the viewer's URLs, the page opens their documents itself, still isolated", async ({
  page,
}) => {
  // Claude Code's Preview pane cancels any request from an opaque origin to a loopback address as a client block: a
  // sandboxed renderer frame's navigation to the viewer. The page's own requests still go through.
  const blocked: string[] = []
  await page.route(/\/renderers\/.+\/index\.html$/, (route, request) => {
    if (!request.isNavigationRequest() || !request.frame().parentFrame()) return route.continue()
    blocked.push(request.url())
    return route.abort('blockedbyclient')
  })
  await openCanvas(page)
  expect(blocked.length).toBeGreaterThan(0)
  const frame = page.locator('.ph-frame').first()
  await expect(frame).toHaveAttribute('src', /^blob:/)
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
  const renderer = page.frames().find(each => each.url().startsWith('blob:'))!
  // The document is the renderer's, in an opaque origin, under the renderer policy the page put first in its head, and
  // that policy refuses every request.
  expect(await renderer.evaluate(() => self.origin)).toBe('null')
  expect(await renderer.evaluate(() => document.head.firstElementChild?.getAttribute('content'))).toContain("connect-src 'none'")
  expect(
    await renderer.evaluate(
      link =>
        fetch(link).then(
          () => 'fetched',
          () => 'refused',
        ),
      url,
    ),
  ).toBe('refused')
  expect(
    await renderer.evaluate(() => {
      try {
        // Reading it throws when the frame can't reach its parent.
        return typeof parent.document === 'object' ? 'reached' : 'refused'
      } catch {
        return 'refused'
      }
    }),
  ).toBe('refused')
})

test('at a canvas width, the header text is whole and centred', async ({page}) => {
  const failed: string[] = []
  page.on('response', response => {
    if (response.status() >= 400) failed.push(`${response.status()} ${new URL(response.url()).pathname.replace(/^\/\w+/, '')}`)
  })
  await openCanvas(page)
  // The page asks only for what a viewer serves (never the Inspector's fixtures).
  expect(failed).toEqual([])
  const header = page.locator('.pi-viewer-header')
  await expect(header.locator('[data-projections-mark]')).toBeVisible()
  const chips = header.locator('.pi-viewer-revision')
  await expect(chips).toHaveCount(2)
  await expect(chips.nth(0)).toHaveAttribute('title', 'b uses a')
  await expect(chips.nth(1)).toHaveAttribute('title', subject)
  const measured = await page.evaluate(() => {
    const box = (element: Element) => element.getBoundingClientRect()
    const header = document.querySelector('.pi-viewer-header')!
    const frame = box(header)
    const border = parseFloat(getComputedStyle(header).borderBottomWidth)
    // Each text's glyphs (ascent to descent) against the box that clips it: negative when tops or descenders are cut.
    const texts = [...header.querySelectorAll('.pi-viewer-text')].map(element => {
      const range = document.createRange()
      range.selectNodeContents(element)
      const glyphs = range.getBoundingClientRect()
      const clip = box(element)
      return {text: element.textContent, above: glyphs.top - clip.top, below: clip.bottom - glyphs.bottom}
    })
    // The title's cap height: its box less the padding that keeps its glyphs (styles.css).
    const title = header.querySelector('.pi-viewer-title')!
    const style = getComputedStyle(title)
    const cap = {top: box(title).top + parseFloat(style.paddingTop), bottom: box(title).bottom - parseFloat(style.paddingBottom)}
    const mark = box(header.querySelector('[data-projections-mark]')!)
    return {
      texts,
      mark: {above: mark.top - frame.top, below: frame.bottom - border - mark.bottom, left: mark.left - frame.left},
      title: {
        truncated: title.scrollWidth > title.clientWidth,
        above: cap.top - frame.top,
        below: frame.bottom - border - cap.bottom,
        left: box(title).left - frame.left,
      },
      revision: (() => {
        const pill = header.querySelectorAll('.pi-viewer-revision')[1]!
        const text = pill.querySelector('.pi-viewer-text')!
        return {truncated: text.scrollWidth > text.clientWidth, width: box(pill).width}
      })(),
      overflow: document.scrollingElement!.scrollWidth - innerWidth,
      pills: [...header.querySelectorAll('.pi-viewer-pill')].map(pill => {
        const style = getComputedStyle(pill)
        const text = pill.querySelector('.pi-viewer-text')!
        const textStyle = getComputedStyle(text)
        // The text's cap: its box less the padding that keeps its glyphs.
        const cap = {top: box(text).top + parseFloat(textStyle.paddingTop), bottom: box(text).bottom - parseFloat(textStyle.paddingBottom)}
        return {
          height: box(pill).height,
          border: style.borderTopWidth,
          background: style.backgroundColor,
          radius: parseFloat(style.borderTopLeftRadius),
          above: cap.top - box(pill).top,
          below: box(pill).bottom - cap.bottom,
        }
      }),
    }
  })
  for (const text of measured.texts) {
    expect(text.above, `the top of "${text.text}"`).toBeGreaterThanOrEqual(0)
    expect(text.below, `the descenders of "${text.text}"`).toBeGreaterThanOrEqual(0)
  }
  // The title keeps its words; a long revision name is short, and whole in its tooltip.
  expect(measured.title.truncated).toBe(false)
  expect(measured.revision.truncated).toBe(true)
  expect(measured.revision.width).toBeLessThan(canvas.width * 0.4)
  // A capital E in the title has the same space above and below; the mark before it the same above, below and to its left.
  expect(Math.abs(measured.title.above - measured.title.below)).toBeLessThanOrEqual(1)
  expect(Math.abs(measured.mark.above - measured.mark.below)).toBeLessThanOrEqual(1)
  expect(Math.abs(measured.mark.above - measured.mark.left)).toBeLessThanOrEqual(1.5)
  expect(measured.overflow).toBeLessThanOrEqual(0)
  // What is compared is outline pills: a whole 20px, a 1px border, fully rounded, no fill, the cap centred.
  for (const pill of measured.pills) {
    expect(pill).toMatchObject({height: 20, border: '1px', background: 'rgba(0, 0, 0, 0)'})
    expect(pill.radius).toBeGreaterThanOrEqual(10)
    expect(Math.abs(pill.above - pill.below)).toBeLessThanOrEqual(0.5)
  }
})

test('the toolbar and stage lie flat, edge to edge, under the header, and the summary floats at the foot', async ({page}) => {
  await openCanvas(page)
  expect((await control('control/show', {mode: 'diff'})).status).toBe(200)
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'diff')
  const measured = await page.evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector(selector)!
      const {left, right, top, bottom} = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        left,
        right,
        top,
        bottom,
        radius: style.borderTopLeftRadius,
        borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].join(' '),
        borderColor: style.borderTopWidth === '0px' ? style.borderBottomColor : style.borderTopColor,
        background: style.backgroundColor,
      }
    }
    const host = document.querySelector('.ph-frame-host')!
    const frame = document.querySelector('.ph-frame')!
    return {
      header: read('.pi-viewer-header'),
      toolbar: read('.ph-toolbar'),
      stage: read('.ph-single'),
      summary: read('.ph-stage-foot'),
      frame: {
        overflow: getComputedStyle(host).overflowY,
        past: frame.getBoundingClientRect().bottom - host.getBoundingClientRect().bottom,
      },
    }
  })
  const {header, toolbar, stage, summary} = measured
  for (const [name, edges] of Object.entries({toolbar, stage})) {
    expect(edges.left, `${name} left`).toBeCloseTo(0, 0)
    expect(edges.right, `${name} right`).toBeCloseTo(canvas.width, 0)
    expect(edges.radius, `${name} corners`).toBe('0px')
  }
  // The toolbar is a band of the header's colour, a hairline from the stage, which has no border.
  expect(toolbar.top).toBeCloseTo(header.bottom, 0)
  expect(toolbar.borders).toBe('0px 0px 1px 0px')
  expect(toolbar.background).toBe(header.background)
  expect(stage.borders).toBe('0px 0px 0px 0px')
  expect(stage.top).toBeGreaterThanOrEqual(toolbar.bottom - 0.5)
  // The summary floats in the stage's foot, 12px above the canvas's bottom, edged in the same divider colour.
  expect(summary.borders).toBe('1px 1px 1px 1px')
  expect(summary.bottom).toBeCloseTo(canvas.height - 12, 0)
  expect(summary.borderColor).toBe(toolbar.borderColor)
  // The frame runs past its clipped host, so the fraction of a pixel a frame's whole pixels would leave never shows
  // as a strip at the stage's bottom.
  expect(measured.frame.overflow).toBe('clip')
  expect(measured.frame.past).toBeGreaterThanOrEqual(1)

  // The header and every toolbar row start and end on whole pixels, so the stage does too, in Diff and in Animated
  // (with playback), at the canvas's width and narrower.
  const edges = () =>
    page.evaluate(() => {
      const y = (element: Element) => [element.getBoundingClientRect().top, element.getBoundingClientRect().bottom]
      const toolbar = document.querySelector('.ph-toolbar')!
      return {
        header: y(document.querySelector('.pi-viewer-header')!),
        toolbar: y(toolbar),
        rows: [...toolbar.querySelectorAll(':scope > .ph-toolbar-row')].map(y),
        stage: y(document.querySelector('.ph-stage-body')!)[0]!,
        // Playback floats on the stage, in its utility area.
        playback: Boolean(document.querySelector('.ph-utility [role="group"][aria-label="Comparison playback"]')),
      }
    })
  for (const mode of ['diff', 'animated'] as const) {
    expect((await control('control/show', {mode})).status).toBe(200)
    await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', mode)
    for (const width of [canvas.width, 600]) {
      await page.setViewportSize({...canvas, width})
      const at = `${mode} at ${width}px`
      await expect.poll(async () => (await edges()).playback, at).toBe(mode === 'animated')
      const {header, toolbar: bar, rows, stage: top} = await edges()
      expect(header, at).toEqual([0, 35])
      expect(bar[0], at).toBe(35)
      for (const edge of [...bar, ...rows.flat(), top]) {
        expect(Number.isInteger(edge), `${at}: ${JSON.stringify({bar, rows, top})}`).toBe(true)
      }
    }
    await page.setViewportSize(canvas)
  }
})

test("in the Copilot app's canvas, the rules are the app's own divider, and the pane labels are chips edged in it", async ({page}) => {
  await openCanvas(page)
  expect((await control('control/show', {mode: 'side-by-side'})).status).toBe(200)
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent =
      ':root { --background-color-default: #0d1117; --border-color-default: #3d444d; --text-color-default: #e6edf3; --text-color-muted: #9198a1; --color-focus-outline: #1f6feb; }'
    document.head.prepend(style)
    document.documentElement.setAttribute('data-color-mode', 'dark')
  })
  const chip = page.locator('[data-pane-chip]').first()
  await expect(chip).toBeVisible()
  await expect(page.locator('.pi-viewer-header')).toHaveCSS('border-bottom-color', 'rgb(61, 68, 77)')
  await expect(chip).toHaveCSS('border-bottom-color', 'rgb(61, 68, 77)')
  await expect(chip).toHaveCSS('border-top-color', 'rgb(61, 68, 77)')
})

test("in the Copilot app's canvas, the renderer's stage, text and families are the app's, and follow its theme", async ({page}) => {
  await openCanvas(page)
  /** The shown renderer frame's stage, text and font, as it paints them. */
  const painted = async () => {
    const frame = await (await page.locator('.ph iframe').first().elementHandle()).contentFrame()
    return frame!.evaluate(() => {
      const root = getComputedStyle(document.querySelector('.pk') ?? document.body)
      return {stage: getComputedStyle(document.body).backgroundColor, text: root.color, font: root.fontFamily.split(',')[0]}
    })
  }
  const before = await painted()
  // What the app does to a canvas document: its theme variables in a stylesheet at the head's start, its color mode
  // on the root and body; then it rewrites them in place when the person changes theme.
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.id = 'app-theme'
    style.textContent =
      ':root { --background-color-default: #14161c; --border-color-default: #2d3340; --text-color-default: #e6e8ee; --text-color-muted: #8b93a6; --color-focus-outline: #4c8dff; --font-sans: Georgia, serif; --font-mono: Menlo, monospace; }'
    document.head.prepend(style)
    document.documentElement.setAttribute('data-color-mode', 'dark')
    document.body.setAttribute('data-color-mode', 'dark')
  })
  await expect.poll(painted).toEqual({stage: 'rgb(20, 22, 28)', text: 'rgb(230, 232, 238)', font: 'Georgia'})
  expect(before.stage).not.toBe('rgb(20, 22, 28)')
  await page.evaluate(() => {
    document.getElementById('app-theme')!.textContent =
      ':root { --background-color-default: oklch(0.98 0.003 250); --border-color-default: #d1d9e0; --text-color-default: #1f2328; --text-color-muted: #59636e; --color-focus-outline: #0969da; --font-sans: Georgia, serif; --font-mono: Menlo, monospace; }'
    document.documentElement.setAttribute('data-color-mode', 'light')
    document.body.setAttribute('data-color-mode', 'light')
  })
  // Colors in other notations reach the renderer as sRGB.
  await expect.poll(async () => (await painted()).text).toBe('rgb(31, 35, 40)')
  expect((await painted()).stage).toMatch(/^rgb\((24\d|25\d), (24\d|25\d), (24\d|25\d)\)$/)
})

/** A warm off-white agent harness, and its dark twin, as `projections view --theme` takes them. */
const harness = {
  light: {background: '#f7f6f3', text: '#2f2e2b', muted: '#75736d', border: '#e4e2dd', accent: '#c96442'},
  dark: {background: '#1f1e1c', text: '#ecebe7', border: '#3a3935', accent: '#d97757'},
}
const themed = (seed: unknown) => `${url}?theme=${encodeURIComponent(typeof seed === 'string' ? seed : JSON.stringify(seed))}`

test("a theme seed in the link colors the stage and chrome in each mode it has, over the app's own", async ({page}) => {
  await openCanvas(page, themed(harness))
  /** The renderer frame's stage and text, and the chrome's header, rules and border variable, as they paint. */
  const painted = async () => {
    const frame = await (await page.locator('.ph iframe').first().elementHandle()).contentFrame()
    const stage = await frame!.evaluate(() => ({
      stage: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(document.querySelector('.pk') ?? document.body).color,
    }))
    const chrome = await page.locator('.pi-viewer-header').evaluate(header => ({
      header: getComputedStyle(header).backgroundColor,
      border: getComputedStyle(header.closest('.pj-root')!).getPropertyValue('--pj-border').trim(),
      fontSize: getComputedStyle(header).fontSize,
    }))
    return {...stage, ...chrome}
  }
  const dark = {stage: 'rgb(31, 30, 28)', text: 'rgb(236, 235, 231)', header: 'rgb(31, 30, 28)', border: '#3a3935', fontSize: '13px'}
  const light = {stage: 'rgb(247, 246, 243)', text: 'rgb(47, 46, 43)', header: 'rgb(247, 246, 243)', border: '#e4e2dd', fontSize: '13px'}
  await expect.poll(painted).toEqual(dark)
  await page.emulateMedia({colorScheme: 'light'})
  await expect.poll(painted).toEqual(light)
  // The page says it took the seed, and the agent reads it.
  await expect.poll(async () => (await state()).page?.theme).toEqual({seeded: true})
  expect((await control('control/tool/current_view', {})).body.content[0].text).toContain('Theme: the theme seed in')
  // The Copilot app's own theme doesn't replace a seed in the link: the seed is the more explicit.
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = ':root { --background-color-default: #14161c; --text-color-default: #e6e8ee; --border-color-default: #2d3340; }'
    document.head.prepend(style)
    document.documentElement.setAttribute('data-color-mode', 'dark')
  })
  await expect.poll(painted).toEqual(dark)

  // A seed with only one mode colors only that one: the other keeps the page's own theme.
  await page.emulateMedia({colorScheme: 'dark'})
  await page.goto(themed({light: harness.light}))
  await expect(page.locator('.ph')).toHaveAttribute('data-renderer-status', 'ready', {timeout: 60_000})
  await expect.poll(async () => (await painted()).stage).not.toBe(dark.stage)
  expect((await painted()).stage).not.toBe(light.stage)
  await page.emulateMedia({colorScheme: 'light'})
  await expect.poll(painted).toEqual(light)
})

test("a theme seed that isn't valid is ignored, and the page and the agent say so", async ({page}) => {
  await page.emulateMedia({colorScheme: 'light'})
  const warnings: string[] = []
  page.on('console', message => void (message.type() === 'warning' && warnings.push(message.text())))
  // A color that isn't one, which a stylesheet would take as CSS.
  await page.goto(themed({light: {background: 'white;}body{display:none'}}))
  await expect(page.locator('.pi-viewer-status')).toHaveText("This link's theme isn't valid, so the page keeps its own")
  await expect(page.locator('.pi-viewer-status')).toHaveAttribute('title', /theme\.light\.background isn't a color/)
  await expect(page.locator('html')).not.toHaveClass(/pi-app-theme/)
  expect(warnings.join('\n')).toContain("theme.light.background isn't a color")
  await expect.poll(async () => (await state()).page?.theme?.ignored).toContain("isn't a color")
  expect((await control('control/tool/current_view', {})).body.content[0].text).toContain(
    'Theme: the page ignored the theme seed in its link',
  )
})

test('the agent reads what a page did with its theme seed while the page is still loading the projection', async ({page}) => {
  // The page reports its theme in its first report, before the projection loads: with the definitions held, it never does.
  let release = () => {}
  const held = new Promise<void>(resolve => (release = resolve))
  await page.route(/\/api\/definitions/, async route => {
    await held
    await route.continue().catch(() => {})
  })
  await page.goto(themed({light: {background: 'white;}body{display:none'}}))
  // This page's report: its theme, and no projection yet (an earlier test's page reported the projection loaded).
  await expect
    .poll(async () => {
      const shown = (await state()).page
      const loaded = Boolean(shown?.summary?.projection)
      return loaded ? 'a loaded page' : (shown?.theme?.ignored ?? 'no theme')
    })
    .toContain("isn't a color")
  const text = (await control('control/tool/current_view', {})).body.content[0].text
  expect(text).toContain('No page shows it yet')
  expect(text).toContain('Theme: the page ignored the theme seed in its link')
  release()
  await page.unrouteAll({behavior: 'ignoreErrors'})
})

test("a one-revision view says what it shows once, at the header's end, and its toolbar still spans the page", async ({page}) => {
  await page.setViewportSize(canvas)
  expect((await control('control/show', {projection: 'packages', choice: 'now'})).status).toBe(200)
  await page.goto(url)
  await expect(page.locator('.ph')).toHaveAttribute('data-renderer-status', 'ready', {timeout: 60_000})
  await expect(page.locator('.ph')).toHaveAttribute('data-mode', 'extraction')
  const header = page.locator('.pi-viewer-header')
  await expect(header.locator('.pi-viewer-compared')).toHaveText('Current state')
  await expect(page.getByText('Current state', {exact: true})).toHaveCount(1)
  const [end, compared] = await Promise.all([header.boundingBox(), header.locator('.pi-viewer-compared').boundingBox()])
  expect(end!.x + end!.width - (compared!.x + compared!.width)).toBeCloseTo(12, 0)
  const toolbar = page.getByRole('group', {name: 'Projection toolbar'})
  await expect(toolbar.locator('.pi-viewer-shown')).toHaveCount(0)
  const box = (await toolbar.boundingBox())!
  const stage = (await page.locator('.ph-single').boundingBox())!
  expect(box.x).toBeCloseTo(stage.x, 0)
  expect(box.width).toBeCloseTo(stage.width, 0)

  // A commit rather than the working tree: the toolbar adds only its short hash, which the header doesn't say.
  expect((await control('control/show', {projection: 'packages', after: long})).status).toBe(200)
  await expect(toolbar.locator('.pi-viewer-shown')).toHaveText(long.slice(0, 7), {timeout: 30_000})
  await expect(header.locator('.pi-viewer-revision')).toHaveAttribute('title', subject)
})

/** The shown renderer frame's zoom, as the graph kit marks its scroller. */
async function zoom(page: Page) {
  const frame = await (await page.locator('.ph iframe').first().elementHandle()).contentFrame()
  return frame!.evaluate(() => document.querySelector('[data-projections-scroll]')?.getAttribute('data-zoom') ?? null)
}

test('at a canvas width, every mode and toolbar control works', async ({page}) => {
  await openCanvas(page)
  const view = page.locator('.ph')
  const toolbar = page.getByRole('group', {name: 'Projection toolbar'})
  const modes = toolbar.getByRole('radiogroup', {name: 'Comparison mode'}).first()
  for (const [name, mode] of [
    ['Side by side', 'side-by-side'],
    ['Animated', 'animated'],
    ['Swipe', 'swipe'],
    ['Diff', 'diff'],
  ] as const) {
    await modes.getByRole('radio', {name, exact: true}).click()
    await expect(view).toHaveAttribute('data-comparison-mode', mode)
    await expect.poll(async () => (await state()).state.mode, {timeout: 10_000}).toBe(mode)
  }
  await expect(view).toHaveAttribute('data-renderer-status', 'ready')

  // Zoom in and out step the renderer's zoom, and Fit to view returns it to the fitted scale (zoom 1). Each step waits
  // for the renderer to apply the last, so two steps in and one out leave it unambiguously above the fit.
  await expect.poll(() => zoom(page)).not.toBeNull()
  const press = (name: string) => toolbar.getByRole('button', {name, exact: true}).click()
  const zoomed = async () => Number(await zoom(page))
  const opening = await zoomed()
  await press('Zoom in')
  await expect.poll(zoomed, {message: 'Zoom in'}).toBeGreaterThan(opening)
  const once = await zoomed()
  await press('Zoom in')
  await expect.poll(zoomed, {message: 'Zoom in again'}).toBeGreaterThan(once)
  const twice = await zoomed()
  await press('Zoom out')
  await expect.poll(zoomed, {message: 'Zoom out'}).toBeLessThan(twice)
  expect(await zoomed()).toBeGreaterThan(1)
  await press('Fit to view')
  await expect.poll(() => zoom(page), {message: 'Fit to view'}).toBe('1')

  // Filter opens its field, Settings its menu, and About its panel; full screen enters and exits.
  await toolbar.getByRole('button', {name: 'Filter', exact: true}).click()
  await expect(page.getByLabel('Filter rows', {exact: true}).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await toolbar.getByRole('button', {name: 'Settings', exact: true}).click()
  await expect(page.getByRole('menu', {name: 'Settings'})).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', {name: 'Settings'})).toHaveCount(0)
  await toolbar.getByRole('button', {name: 'About this projection', exact: true}).click()
  await expect(page.getByRole('dialog', {name: 'About this projection'})).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', {name: 'About this projection'})).toHaveCount(0)
  await toolbar.getByRole('button', {name: 'Enter full screen', exact: true}).click()
  await expect(toolbar.getByRole('button', {name: 'Exit full screen', exact: true})).toBeVisible()
  await toolbar.getByRole('button', {name: 'Exit full screen', exact: true}).click()
  await expect(toolbar.getByRole('button', {name: 'Enter full screen', exact: true})).toBeVisible()
})

test('a named viewer is its own page, and the person switches its projection from the title', async ({page}) => {
  expect((await control('control/show', {viewer: 'side', projection: 'broken', choice: 'now'})).status).toBe(200)
  const before = (await state()).state
  await page.goto(`${url}?viewer=side`)
  const header = page.locator('.pi-viewer-header')
  await expect(header.locator('.pi-viewer-title')).toHaveText('Broken map')
  const trigger = header.getByRole('button', {name: 'Broken map, switch projection'})
  await expect(trigger).toBeVisible({timeout: 30_000})
  // It reads as the title, not a button: no fill, border or padding of its own at rest.
  const rest = await trigger.evaluate(element => {
    const style = getComputedStyle(element)
    return {background: style.backgroundColor, border: style.borderTopWidth, height: element.getBoundingClientRect().height}
  })
  expect(rest).toEqual({background: 'rgba(0, 0, 0, 0)', border: '0px', height: 24})
  await trigger.hover()
  expect(await trigger.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')

  // The keyboard opens it: a search over the repository's projections, the current one checked.
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const dialog = page.getByRole('dialog', {name: 'Switch projection'})
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-projection]')).toHaveCount(2)
  await expect(dialog.getByRole('option', {name: 'Pin projections pane'})).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await dialog.getByRole('option', {name: /^Package map, packages/}).click()

  // That viewer shows it, and the agent reads that the person chose it; the default viewer is unchanged.
  await expect(header.locator('.pi-viewer-title')).toHaveText('Package map')
  await expect
    .poll(async () => {
      const side = (await control('control/state?viewer=side')).body.state
      return [side.projection, side.chosenBy]
    })
    .toEqual(['packages', 'person'])
  const current = (await control('control/tool/current_view', {viewer: 'side'})).body
  expect(current.content[0].text).toContain('The person chose this projection themselves')
  const main = (await state()).state
  expect([main.projection, main.chosenBy]).toEqual([before.projection, 'agent'])
  expect(await pathsIn(page)).toEqual([])
})

test('the person pins the projections pane from the title, and closes it back to the menu', async ({page}) => {
  expect((await control('control/show', {viewer: 'pane', projection: 'packages', choice: 'now'})).status).toBe(200)
  await page.setViewportSize({width: 1280, height: 800})
  await page.goto(`${url}?viewer=pane`)
  const header = page.locator('.pi-viewer-header')
  const trigger = header.getByRole('button', {name: 'Package map, switch projection'})
  await expect(trigger).toBeVisible({timeout: 30_000})

  // The menu's last option, after its projections, pins the pane: the arrow keys reach it.
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const dialog = page.getByRole('dialog', {name: 'Switch projection'})
  for (let step = 0; step < 3 && (await dialog.locator('[data-pin-pane][aria-selected="true"]').count()) === 0; step++) {
    await page.keyboard.press('ArrowDown')
  }
  await page.keyboard.press('Enter')

  // A navigation landmark at the page's start, 240px wide, its current projection focused; the title is the title alone.
  const pane = page.getByRole('navigation', {name: 'Projections'})
  await expect(pane).toBeVisible()
  expect((await pane.boundingBox())?.width).toBeCloseTo(240, 0)
  await expect(pane.locator('[aria-current="page"]')).toBeFocused()
  await expect(pane.locator('[aria-current="page"]')).toContainText('Package map')
  await expect(trigger).toHaveCount(0)
  const toolbar = await page.locator('.ph-toolbar').first().boundingBox()
  expect(toolbar?.x).toBeCloseTo(240, 0)

  // Choosing another shows it; the pane stays pinned across a reload, without taking focus.
  await pane.getByRole('button', {name: /Broken map/}).click()
  await expect(header.locator('.pi-viewer-title')).toHaveText('Broken map')
  await expect(pane.locator('[aria-current="page"]')).toContainText('Broken map')
  await page.reload()
  await expect(pane).toBeVisible({timeout: 30_000})
  await expect(pane.locator('[aria-current="page"]')).not.toBeFocused()

  // Too narrow for it, the page falls back to the menu, which takes the focus the pane held and doesn't offer pinning.
  await pane.locator('[aria-current="page"]').focus()
  await page.setViewportSize({width: 860, height: 800})
  await expect(pane).toHaveCount(0)
  const narrow = header.getByRole('button', {name: /, switch projection$/})
  await expect(narrow).toBeFocused()
  await narrow.click()
  await expect(dialog.getByRole('option', {name: 'Pin projections pane'})).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Wide enough again, the pane comes back and takes the focus the menu held.
  await expect(narrow).toBeFocused()
  await page.setViewportSize({width: 1280, height: 800})
  await expect(pane.locator('[aria-current="page"]')).toBeFocused()

  // Closing it returns to the menu, focused, and forgets it.
  await pane.getByRole('button', {name: 'Close projections pane'}).click()
  await expect(pane).toHaveCount(0)
  await expect(narrow).toBeFocused()
  expect(await page.evaluate(() => localStorage.getItem('projections:pane-pinned:viewer'))).toBeNull()
})

test('a page that loses its server says so, takes no input, and reconnects when it answers again', async ({page}) => {
  await openCanvas(page)
  const stopped = page.locator('.pi-viewer-stopped')
  await expect(stopped).toHaveCount(0)
  // The server stops answering the page's long poll, as when it exits.
  await page.route('**/view/state**', route => route.abort())
  // Ends the poll in flight, so the page's next one fails.
  expect((await control('control/refresh', {})).status).toBe(200)
  await expect(stopped).toBeVisible({timeout: 30_000})
  await expect(stopped).toContainText('Viewer stopped')
  await expect(page.getByRole('status').filter({hasText: 'Viewer stopped'})).toBeVisible()
  const inert = () => page.evaluate(() => document.querySelector<HTMLElement>('.pi-viewer-body')!.inert)
  expect(await inert()).toBe(true)
  // It answers again: the page resumes, and its controls with it.
  await page.unroute('**/view/state**')
  await expect(stopped).toHaveCount(0, {timeout: 10_000})
  expect(await inert()).toBe(false)
  await page.getByRole('group', {name: 'Projection toolbar'}).getByRole('radio', {name: 'Swipe', exact: true}).click()
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'swipe')

  // The viewer exits: the page says so at once (this is the file's last test: the server is gone after it).
  viewer.kill()
  await expect(stopped).toBeVisible({timeout: 10_000})
})
