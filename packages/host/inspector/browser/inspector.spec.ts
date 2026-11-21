import {test as base, expect, type Locator, type Page} from '@playwright/test'
import {execFileSync} from 'node:child_process'
import {mkdtemp, mkdir, rename, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {cli, startHarness, type Harness} from './harness.js'
import {chooseMode, showAs, closeToolbarMenus, openFilter} from './toolbar.js'
import type {ComparisonDocument, ExtractionDocument} from '@githubnext/projections-schemas'

interface FixtureApp {
  url: string
  extraction: ExtractionDocument
  comparison: ComparisonDocument
  untrustedUrl: string
  reviewUrl: string
  repo: string
  /** Full commit SHAs of HEAD~1 and HEAD. */
  base: string
  head: string
}
const test = base.extend<{app: FixtureApp}>({
  app: async ({browserName, context}, use) => {
    const repo = await mkdtemp(join(tmpdir(), `projections-inspector-${browserName}-`))
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
        cwd: repo,
        stdio: 'pipe',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Inspector fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
          GIT_COMMITTER_NAME: 'Inspector fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        },
      })
        .toString()
        .trim()
    let trusted: Harness | undefined
    let untrusted: Harness | undefined
    let review: Harness | undefined
    try {
      git('init', '--quiet')
      await mkdir(join(repo, '.projections'))
      const definition = {
        id: 'architecture',
        title: 'Checkout architecture',
        renderer: 'architecture',
        extractor: {command: [process.execPath, 'collect.mjs']},
      }
      await writeFile(join(repo, '.projections/architecture.json'), JSON.stringify(definition))
      await writeFile(
        join(repo, '.projections/slow.json'),
        JSON.stringify({...definition, id: 'slow', title: 'Slow extractor', extractor: {command: ['/bin/sh', 'slow.sh']}}),
      )
      await writeFile(
        join(repo, '.projections/files.json'),
        JSON.stringify({id: 'files', title: 'Repository files', renderer: 'file-packing', extractor: 'repository-map'}),
      )
      await writeFile(
        join(repo, '.projections/broken.json'),
        JSON.stringify({...definition, id: 'broken', title: 'Failing extractor', extractor: {command: ['/bin/sh', 'fail.sh']}}),
      )
      // Extractors read the examined revision through request.repository.root.
      await writeFile(
        join(repo, 'collect.mjs'),
        "import {readFileSync} from 'node:fs'\nconst {repository} = JSON.parse(readFileSync(0, 'utf8'))\nprocess.stdout.write(readFileSync(`${repository.root}/state.json`, 'utf8'))\nprocess.stderr.write('Extracted local graph\\n')\n",
      )
      await writeFile(join(repo, 'slow.sh'), "printf 'Waiting for cancellation\\n' >&2\n/bin/sleep 30\n")
      await writeFile(join(repo, 'fail.sh'), "printf 'Incomplete result'\nprintf 'Deliberate extractor failure\\n' >&2\nexit 2\n")
      const checkout = {
        id: 'checkout',
        kind: 'service',
        label: 'Checkout',
        data: {layer: 'Application'},
        evidence: [{kind: 'source', source: 'collect.mjs', location: {line: 1}}],
      }
      const legacy = {id: 'legacy', kind: 'service', label: 'Legacy inventory', data: {layer: 'Storage'}}
      const worker = {id: 'worker', kind: 'service', label: 'Inventory worker', previousIds: ['legacy'], data: {layer: 'Storage'}}
      const state = {
        protocolVersion: 0,
        schema: 'architecture/v0',
        entities: [checkout, legacy],
        relationships: [{id: 'reserve', kind: 'calls', from: 'checkout', to: 'legacy'}],
      }
      await writeFile(join(repo, 'state.json'), JSON.stringify(state))
      git('add', '.')
      git('commit', '--quiet', '-m', 'Before inventory worker')
      await writeFile(
        join(repo, 'state.json'),
        JSON.stringify({...state, entities: [checkout, worker], relationships: [{...state.relationships[0], to: 'worker'}]}),
      )
      git('add', 'state.json')
      git('commit', '--quiet', '-m', 'After inventory worker')
      const comparison: ComparisonDocument = JSON.parse(
        execFileSync(cli(), ['-C', repo, 'compare', 'HEAD~1..HEAD', '-p', 'architecture', '--trust', '--json'], {
          encoding: 'utf8',
          env: {PATH: process.env.PATH, LANG: 'C.UTF-8'},
          maxBuffer: 8 * 1024 * 1024,
        }),
      )
      const extraction = comparison.after
      const document = join(repo, 'saved-comparison.json')
      await writeFile(document, JSON.stringify(comparison))
      trusted = await startHarness(context, ['-C', repo, '--trust'])
      untrusted = await startHarness(context, ['-C', repo])
      review = await startHarness(context, ['--document', document])
      await use({
        url: trusted.url,
        untrustedUrl: untrusted.url,
        reviewUrl: review.url,
        extraction,
        comparison,
        repo,
        base: git('rev-parse', 'HEAD~1'),
        head: git('rev-parse', 'HEAD'),
      })
    } finally {
      await trusted?.close()
      await untrusted?.close()
      await review?.close()
      await rm(repo, {recursive: true, force: true})
    }
  },
})

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

/**
 * Opens or closes the Explorer. It starts open at desktop widths; below 1012px it is a drawer over the view that starts
 * closed.
 */
async function sidebar(page: Page, open = true) {
  const toggle = page.getByRole('button', {name: /^(Show|Hide) .* sidebar$/})
  if (((await toggle.getAttribute('aria-pressed')) === 'true') !== open) await toggle.click()
  if (open) await expect(page.getByRole('complementary', {name: 'Explorer'})).toBeVisible()
  else await expect(page.getByRole('complementary', {name: 'Explorer'})).toHaveCount(0)
}

/** Whether the Explorer is a drawer (below 1012px), which covers the view while open. */
const drawer = (page: Page) => page.viewportSize()!.width < 1012

/**
 * Waits until the projection can run: the server's --trust is the grant (the page asks nothing more), and built-in
 * extractors need none.
 */
async function trust(page: Page) {
  await expect(page.locator('.pi-trust-state')).toHaveAttribute('data-trust', /granted|not-needed/)
}

/**
 * How long a repository-mode page may take to extract both sides of its opening comparison and compare them, ms: two
 * extractor runs on a cold backend (no extraction cache), which a starved Linux WebKit runner has taken 7 s over, the
 * default expect timeout being for one interaction.
 */
const openingExtraction = 20_000

/**
 * Waits for a repository-mode page's opening comparison to be drawn, in its two stages, each with its own budget:
 * extracting and comparing both sides (`openingExtraction`), then the renderer loading and painting it (the default
 * timeout). A saved artifact (`reviewUrl`) extracts nothing and needs only the second.
 */
async function openingDrawn(page: Page) {
  await expect(page.locator('.ph[data-mode="comparison"]'), 'the opening comparison, extracted and compared').toBeVisible({
    timeout: openingExtraction,
  })
  await expect(page.locator('.ph[data-mode="comparison"][data-renderer-status="ready"]'), 'its renderer, painted').toBeVisible()
}

/** Sets a revision as Before or After from the Explorer's History, unless it already is. */
async function mark(page: Page, ref: string, side: 'Before' | 'After') {
  await sidebar(page)
  const button = page.getByRole('button', {name: `Set ${ref} as ${side}`, exact: true})
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

/** The title bar's projection switcher: the current projection's title, its document title. */
const switcher = (page: Page) => page.locator('.pi-titlebar .pi-switcher')
/** The switcher's accessible name for a projection: "Projection: <title>", then any other failing projections. */
const switcherName = (title: string) => new RegExp(`^Projection: ${title}(,|$)`)

/** Chooses a projection with the title bar's switcher (by a click, then the option). */
async function chooseProjection(page: Page, name: string) {
  const trigger = switcher(page)
  await expect(trigger).toBeEnabled()
  if (switcherName(name).test((await trigger.getAttribute('aria-label')) ?? '')) return
  await trigger.click()
  const list = page.getByRole('dialog', {name: 'Switch projection'}).getByRole('listbox', {name: 'Projections'})
  await list.getByRole('option', {name: new RegExp(`^${name},`)}).click()
  await expect(list).toHaveCount(0)
  await expect(trigger).toHaveAttribute('aria-label', switcherName(name))
}

/** The Compare section's ref field for a side. */
const refField = (page: Page, side: 'Before' | 'After' | 'Revision') =>
  page.getByRole('region', {name: 'Compare'}).getByRole('textbox', {name: side, exact: true})

/** Types a ref into a side of the Compare pair and applies it. */
async function setRef(page: Page, side: 'Before' | 'After' | 'Revision', ref: string) {
  await sidebar(page)
  await refField(page, side).fill(ref)
  await refField(page, side).press('Enter')
}

/**
 * Chooses a theme in the title bar's Settings menu (the gear, always in the bar) as a person does: open it, then
 * click the Theme radio item. The menu closes on choosing.
 */
async function chooseTheme(page: Page, name: 'System' | 'Light' | 'Dark') {
  await page.getByRole('toolbar', {name: 'Inspector'}).getByRole('button', {name: 'Settings', exact: true}).click()
  const menu = page.getByRole('menu')
  await menu.getByRole('group', {name: 'Theme'}).getByRole('menuitemradio', {name, exact: true}).click()
  await expect(menu).toHaveCount(0)
}

/** Opens the Settings menu and returns its "Advanced" group's "Definition from" radio group. */
async function definitionMenu(page: Page) {
  await page.getByRole('toolbar', {name: 'Inspector'}).getByRole('button', {name: 'Settings', exact: true}).click()
  const radios = page.getByRole('menu').getByRole('group', {name: 'Definition from'})
  await expect(radios).toBeVisible()
  return radios
}

/** The revision whose definition extractions apply, as the Settings menu's "Definition from" group shows it. */
async function definitionFrom(page: Page): Promise<string> {
  const radios = await definitionMenu(page)
  const checked = (await radios.getByRole('menuitemradio', {checked: true}).textContent()) ?? ''
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  return checked.trim()
}

/** Chooses the advanced "Definition from" revision in the Settings menu, which closes on choosing. */
async function chooseDefinitionFrom(page: Page, option: RegExp) {
  const radios = await definitionMenu(page)
  await radios.getByRole('menuitemradio', {name: option}).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
}

/** Closes the title bar's "More actions" popover, if a picker in it was used. */
async function closeMore(page: Page) {
  const more = page.getByRole('dialog', {name: 'More actions'})
  if (await more.isVisible()) {
    await page.keyboard.press('Escape')
    await expect(more).toHaveCount(0)
  }
}

/**
 * A layout toggle of the title bar (the panel's, the docked Details'): in the bar, or at the bar's last level (on a
 * phone) in "More actions", by the same name.
 */
async function titleToggle(page: Page, name: RegExp) {
  const inline = page.locator('.pi-titlebar').getByRole('button', {name})
  const moreButton = page.locator('.pi-titlebar').getByRole('button', {name: 'More actions'})
  // The title bar plans its layout after it renders: wait until one form of the control is shown.
  await expect(inline.or(moreButton).first()).toBeVisible()
  if (await inline.isVisible()) return inline
  const more = page.getByRole('dialog', {name: 'More actions'})
  // A popover that just closed (choosing from it) is still leaving: wait for it, then open it afresh.
  await expect(page.locator('[role="dialog"][aria-label="More actions"][data-state="closed"]')).toHaveCount(0)
  // Just after loading, a click can land while the title bar replans its layout and open nothing: click again until open.
  await expect(async () => {
    if (!(await more.isVisible())) await moreButton.click()
    await expect(more).toBeVisible({timeout: 2_000})
  }).toPass()
  return more.getByRole('button', {name})
}

/** Opens the bottom panel at a tab. */
async function panel(page: Page, name: string) {
  if (drawer(page)) await sidebar(page, false)
  if (!(await page.getByRole('region', {name: 'Panel'}).count())) await (await titleToggle(page, /^Show panel$/)).click()
  await closeMore(page)
  await page
    .getByRole('tablist', {name: 'Panel views'})
    .getByRole('tab', {name: new RegExp(`^${name}`)})
    .click()
  return page.locator('#pi-panel-content')
}

test('real local Git extractions of a Before → After pair, in-browser comparison and panel views', async ({page, app}, testInfo) => {
  // Real extractions and some thirty interactions: three times the default budget, for loaded machines and
  // slow mobile WebKit, without loosening any assertion.
  test.slow()
  const errors: string[] = []
  // WebKit sometimes reports the spec's benign "ResizeObserver loop" notice (a resize settling over two frames) as a
  // page error; it is not a failure, and every other error still is.
  page.on('pageerror', failure => {
    if (!/^ResizeObserver loop completed with undelivered notifications\.?$/.test(failure.message)) errors.push(failure.message)
  })
  await page.goto(app.url)
  await expect(page.locator('.pi-activity[data-watching]')).toBeAttached()
  await chooseProjection(page, 'Checkout architecture')
  expect(await definitionFrom(page)).toMatch(/^Working tree/)
  // The default pair is real history, HEAD~1 → HEAD, not the dirty tree.
  await sidebar(page)
  await expect(refField(page, 'Before')).toHaveValue('HEAD~1')
  await expect(refField(page, 'After')).toHaveValue('HEAD')
  // Started with --trust, the page asks for nothing more: both sides are extracted by themselves and compared.
  await trust(page)
  await expect(page.locator('.pi-trust-state')).toHaveAttribute('data-trust', 'granted')
  await expect(page.getByRole('button', {name: 'Trust this repository', exact: true})).toHaveCount(0)
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  await sidebar(page)
  await expect(page.locator('[data-revision="HEAD~1"]')).toHaveAttribute('data-status', 'done')
  await expect(page.locator('[data-revision="HEAD"]')).toHaveAttribute('data-status', 'done')
  await expect(page.getByRole('button', {name: 'Set HEAD~1 as Before', exact: true})).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', {name: 'Set HEAD as After', exact: true})).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.pi-statusbar [data-comparator="default"]')).toHaveText('Default comparator')
  await expect(page.locator('.pi-statusbar [data-pair]')).toContainText('HEAD~1 · "Before inventory worker"')
  await expect(page.locator('.pi-statusbar [data-pair]')).toContainText('HEAD · "After inventory worker"')
  // The working tree as After, from the History.
  await mark(page, 'Working tree', 'After')
  await expect(refField(page, 'After')).toHaveValue('Working tree')
  await expect(page.locator('[data-revision="working-tree"]')).toHaveAttribute('data-status', 'done')
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  await mark(page, 'HEAD', 'After')
  // A graph comparison opens in diff (its renderer offers it); Animated adds the transition.
  await sidebar(page, false)
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'diff')
  await page.screenshot({path: testInfo.outputPath('rendered-comparison.png')})
  await chooseMode(page, 'Animated')
  await expect(page.getByRole('slider', {name: 'Transition'})).toBeVisible()
  await showAs(page, 'Table')
  await expect(page.locator('[data-active-view="table"]')).toHaveText('Built-in table view')
  // The toolbar's Filter button expands into the find field (on a phone, it opens it in a popover or More).
  await (await openFilter(page)).fill('Inventory')
  await closeToolbarMenus(page)
  await page.getByRole('button', {name: 'Inventory worker', exact: true}).click()
  // The docked Details panel shows the selection; the view draws no details of its own.
  await details(page)
  await expect(page.locator('.pi-details-dock .ph-details')).toContainText('declared')
  await expect(page.locator('.pi-view .ph-details')).toHaveCount(0)
  await details(page, false)
  await showAs(page, 'Text')
  await expect(page.locator('.ph-text-view')).toContainText('Inventory worker')
  await sidebar(page)
  await page.getByRole('region', {name: 'Compare'}).getByRole('button', {name: 'Swap Before and After', exact: true}).click()
  await expect(page.getByRole('button', {name: 'Set HEAD as Before', exact: true})).toHaveAttribute('aria-pressed', 'true')
  await expect(refField(page, 'Before')).toHaveValue('HEAD')
  // One revision shows the After alone; comparing again restores the Before.
  await page.getByRole('checkbox', {name: 'Show one revision'}).click()
  await expect(refField(page, 'Revision')).toHaveValue('HEAD~1')
  await expect(page.locator('.ph[data-mode="extraction"]')).toBeVisible()
  await page.getByRole('checkbox', {name: 'Show one revision'}).click()
  await expect(refField(page, 'Before')).toHaveValue('HEAD')
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  const raw = await panel(page, 'Raw output')
  await expect(raw).toContainText('Extracted local graph')
  await expect(raw.getByRole('heading', {name: /^Run .+: completed$/})).toHaveCount(3)
  await expect(await panel(page, 'Extraction')).toContainText('"previousIds"')
  const changes = await panel(page, 'Changes')
  await expect(changes.getByRole('cell', {name: 'declared', exact: true})).toBeVisible()
  await expect(changes.locator('caption')).toContainText('default comparator')
  const provenance = await panel(page, 'Provenance')
  await expect(provenance).toContainText('Extraction digest')
  const digests = await provenance.locator('p', {hasText: 'Definition digest'}).allTextContents()
  expect(digests).toHaveLength(2)
  expect(new Set(digests).size).toBe(1)
  await page.getByRole('tablist', {name: 'Panel views'}).getByRole('tab', {name: 'Provenance'}).press('ArrowRight')
  await expect(page.getByRole('tablist', {name: 'Panel views'}).getByRole('tab', {name: /^Diagnostics/})).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test("Definition from applies another revision's definition to both sides, extracted again", async ({page, app}) => {
  test.slow()
  await writeFile(
    join(app.repo, '.projections/architecture.json'),
    JSON.stringify({
      id: 'architecture',
      title: 'Draft architecture',
      renderer: 'architecture',
      extractor: {command: [process.execPath, 'collect.mjs']},
    }),
  )
  await page.goto(app.url)
  await chooseProjection(page, 'Draft architecture')
  await trust(page)
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  await expect(page.getByRole('heading', {name: 'Draft architecture'}).first()).toBeAttached()
  await chooseDefinitionFrom(page, new RegExp(`· ${app.head.slice(0, 8)}$`))
  // Both sides are extracted again with HEAD's definition, so they still compare.
  await expect(page.locator('.pi-titlebar').getByRole('status')).toContainText('definition from')
  await expect(page.getByRole('heading', {name: 'Checkout architecture'}).first()).toBeAttached({timeout: 20_000})
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  await expect(page.locator('.ph-error[data-error-code="definition-mismatch"]')).toHaveCount(0)
  await chooseDefinitionFrom(page, /^Working tree/)
  await expect(page.getByRole('heading', {name: 'Draft architecture'}).first()).toBeAttached({timeout: 20_000})
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
})

test('actual slow extractor is cancellable and untrusted startup cannot execute', async ({page, app}) => {
  await page.goto(app.url)
  await chooseProjection(page, 'Slow extractor')
  await trust(page)
  // The pair starts extracting by itself, and can be cancelled from the view.
  await expect(page.locator('.pi-empty')).toContainText(/Extracting HEAD(~1)?…/)
  await page.locator('.pi-empty').getByRole('button', {name: 'Cancel', exact: true}).click()
  await sidebar(page)
  await expect(page.locator('[data-revision="HEAD~1"]')).toHaveAttribute('data-status', 'cancelled')
  await expect(page.locator('[data-revision="HEAD"]')).toHaveAttribute('data-status', 'cancelled')
  await page.locator('[data-revision="working-tree"]').getByRole('button', {name: 'Extract Working tree', exact: true}).click()
  await expect(page.locator('[data-revision="working-tree"]')).toHaveAttribute('data-status', 'running')
  await page.getByRole('button', {name: 'Cancel extraction', exact: true}).click()
  await expect(page.locator('[data-revision="working-tree"]')).toHaveAttribute('data-status', 'cancelled')
  await expect(page.locator('.ph')).toHaveCount(0)
  await page.goto(app.untrustedUrl)
  await chooseProjection(page, 'Slow extractor')
  // Trust is the one thing needed, so the main view is the trust prompt: what would run, and how to allow it.
  const prompt = page.getByRole('region', {name: 'Trust'})
  await expect(prompt).toContainText('This projection runs repository code')
  await expect(prompt.locator('code').first()).toHaveText('/bin/sh slow.sh')
  await expect(prompt).toContainText('Execution is not authorized')
  await expect(prompt).toContainText('trust the workspace')
  await expect(prompt.locator('code', {hasText: '--trust'})).toBeVisible()
  await expect(page.locator('.pi-titlebar').getByRole('status')).toContainText('Execution off')
  await expect(page.getByRole('button', {name: 'Trust this repository', exact: true})).toHaveCount(0)
  await sidebar(page)
  await expect(page.getByRole('button', {name: 'Extract HEAD', exact: true})).toBeDisabled()
})

test('Cancel pressed just as the next extraction starts cancels it, and nothing queued runs', async ({page, app}) => {
  // Presses Cancel while the Slow extractor's first job is being started: the runner hasn't named the job yet. The
  // coordinator requests the job as soon as it is queued, before the page has drawn it, so the request waits for the
  // Cancel button the page draws for it, and is sent once that has been pressed.
  await page.addInitScript(() => {
    const request = window.fetch
    let pressed = false
    const cancelButton = () =>
      new Promise<HTMLButtonElement>((resolve, reject) => {
        const deadline = Date.now() + 5_000
        const find = () => {
          const cancel = [...document.querySelectorAll<HTMLButtonElement>('.pi-empty button')].find(
            button => button.textContent === 'Cancel',
          )
          if (cancel) resolve(cancel)
          else if (Date.now() > deadline) reject(new Error('No Cancel button as the extraction starts'))
          else setTimeout(find, 10)
        }
        find()
      })
    window.fetch = async (input, init) => {
      if (!pressed && input === '/api/jobs' && init?.method === 'POST' && String(init.body).includes('"projectionId":"slow"')) {
        pressed = true
        ;(await cancelButton()).click()
      }
      return request(input, init)
    }
  })
  await page.goto(app.url)
  await chooseProjection(page, 'Slow extractor')
  await trust(page)
  await sidebar(page)
  await expect(page.locator('[data-revision="HEAD~1"]')).toHaveAttribute('data-status', 'cancelled')
  await expect(page.locator('[data-revision="HEAD"]')).toHaveAttribute('data-status', 'cancelled')
  await expect(page.getByRole('button', {name: 'Cancel extraction', exact: true})).toHaveCount(0)
})

test('a focused title-bar control keeps focus while the bar fits itself to a new status', async ({page, app}) => {
  // Phone-wide: Open and Commands are in More, the last of the bar's plans.
  await page.setViewportSize({width: 400, height: 800})
  await page.goto(app.url)
  await chooseProjection(page, 'Checkout architecture')
  await trust(page)
  const status = page.locator('.pi-titlebar').getByRole('status')
  await expect(status).toHaveAttribute('data-activity', 'pair')
  const more = page.getByRole('toolbar', {name: 'Inspector'}).getByRole('button', {name: 'More actions', exact: true})
  await more.focus()
  // Saving the definition extracts again: the status changes, and with it what the bar holds, so the bar measures its
  // plans again. It never tries the ones that would remount the control in the person's hands.
  await save(
    join(app.repo, '.projections/architecture.json'),
    JSON.stringify({id: 'architecture', title: 'Saved', renderer: 'architecture', extractor: {command: [process.execPath, 'collect.mjs']}}),
  )
  await expect(status).toContainText(/ · replayed /, {timeout: 20_000})
  await expect(more).toBeFocused()
})

/** Saves a file the way editors do, by renaming a complete copy over it, so a watcher never reads it half-written. */
async function save(path: string, content: string) {
  await writeFile(`${path}.saving`, content)
  await rename(`${path}.saving`, path)
}

test('the status line names the pair and why it was last replayed', async ({page, app}) => {
  await page.goto(app.url)
  const status = page.locator('.pi-titlebar').getByRole('status')
  await expect(status).toHaveAttribute('aria-live', 'polite')
  await chooseProjection(page, 'Checkout architecture')
  await trust(page)
  await expect(status).toHaveAttribute('data-activity', 'pair')
  await expect(status).toContainText(/^HEAD~1 → HEAD · extracted /)
  await expect(status.locator('code')).toHaveText(['HEAD~1', 'HEAD'])
  // The relative time is shown, but not re-announced as it ticks; assistive technology reads the clock time.
  await expect(status.locator('[aria-hidden="true"]')).toHaveText(/^(just now|\d+ s ago)$/)
  // The whole line is its tooltip, so a truncated line can still be read.
  await expect(status).toHaveAttribute('title', /^HEAD~1 → HEAD · extracted at /)
  // Saving the projection's code replays both sides, and the line names the change.
  await save(
    join(app.repo, '.projections/architecture.json'),
    JSON.stringify({
      id: 'architecture',
      title: 'Saved architecture',
      renderer: 'architecture',
      extractor: {command: [process.execPath, 'collect.mjs']},
    }),
  )
  await expect(status).toContainText(/ · replayed .*after the definition(, the working tree)? changed$/, {timeout: 20_000})
  await expect(page.getByRole('heading', {name: 'Saved architecture'}).first()).toBeAttached()
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  // A saved artifact says so.
  await page.goto(app.reviewUrl)
  await expect(page.locator('.pi-titlebar').getByRole('status')).toHaveAttribute('data-activity', 'artifact')
  await expect(page.locator('.pi-titlebar').getByRole('status')).toContainText('Showing a saved artifact')
})

test('a first-run tip names the loop in its own row until it is dismissed, per repository', async ({page, app}) => {
  await page.goto(app.url)
  const tip = page.getByRole('note', {name: 'Tip'})
  await expect(tip).toContainText('Edit your projection and save: both sides re-extract and replay')
  await expect(tip).toContainText('choose Before → After to test against real history')
  await expect(tip.locator('kbd')).toHaveText(process.platform === 'darwin' ? '⌘K' : 'Ctrl+K')
  // It takes its own row in the main area, below the title bar: nothing lies under it.
  const [bar, row] = [(await page.locator('.pi-titlebar').boundingBox())!, (await tip.boundingBox())!]
  expect(row.y).toBeGreaterThanOrEqual(bar.y + bar.height - 0.5)
  expect(await tip.evaluate(element => element.parentElement?.classList.contains('pi-main'))).toBe(true)
  await tip.getByRole('button', {name: 'Dismiss tip'}).click()
  await expect(tip).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.pi-activity[data-watching]')).toBeAttached()
  await expect(tip).toHaveCount(0)
  // A saved artifact is not repository mode: no tip.
  await page.evaluate(() => localStorage.clear())
  await page.goto(app.reviewUrl)
  await expect(page.locator('.ph[data-renderer-status="ready"]')).toBeVisible()
  await expect(tip).toHaveCount(0)
})

test('the Before → After pair: swap, a tag or SHA by name, one revision, remembered per projection', async ({page, app}) => {
  test.slow()
  await page.goto(app.url)
  await chooseProjection(page, 'Checkout architecture')
  await trust(page)
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  await sidebar(page)
  // A name the repository doesn't know is refused, with the reason, and the pair stays.
  await setRef(page, 'Before', 'no-such-ref')
  await expect(page.getByRole('region', {name: 'Compare'}).getByRole('alert')).toContainText('Not a revision here: no-such-ref')
  await expect(page.getByRole('button', {name: 'Set HEAD~1 as Before', exact: true})).toHaveAttribute('aria-pressed', 'true')
  // A tag (made after the page opened, so the default pair stays HEAD~1 → HEAD), then a commit SHA, by name.
  execFileSync('git', ['-C', app.repo, 'tag', 'v1', 'HEAD~1'])
  await setRef(page, 'Before', 'v1')
  await expect(page.locator('[data-revision="v1"]')).toHaveAttribute('data-status', 'done')
  await expect(page.getByRole('button', {name: 'Set v1 as Before', exact: true})).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.pi-titlebar').getByRole('status')).toContainText('v1 → HEAD')
  await setRef(page, 'After', app.head)
  await expect(page.locator(`[data-revision="${app.head}"]`)).toHaveAttribute('data-status', 'done')
  await expect(refField(page, 'After')).toHaveValue(app.head)
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  // Swap.
  await page.getByRole('region', {name: 'Compare'}).getByRole('button', {name: 'Swap Before and After', exact: true}).click()
  await expect(refField(page, 'Before')).toHaveValue(app.head)
  await expect(refField(page, 'After')).toHaveValue('v1')
  // Recent pairs are offered again.
  await expect(page.getByRole('list', {name: 'Pairs'}).getByRole('button', {name: `Compare v1 → ${app.head.slice(0, 8)}`})).toBeVisible()
  // The pair is remembered for this repository and projection.
  await page.reload()
  await trust(page)
  await sidebar(page)
  await expect(refField(page, 'Before')).toHaveValue(app.head)
  await expect(refField(page, 'After')).toHaveValue('v1')
  // A suggested pair replaces it in one step.
  await page.getByRole('list', {name: 'Pairs'}).getByRole('button', {name: 'Compare HEAD → Working tree'}).click()
  await expect(refField(page, 'Before')).toHaveValue('HEAD')
  await expect(refField(page, 'After')).toHaveValue('Working tree')
  // One revision.
  await page.getByRole('checkbox', {name: 'Show one revision'}).click()
  await expect(refField(page, 'Revision')).toHaveValue('Working tree')
  await setRef(page, 'Revision', 'v1')
  if (drawer(page)) await sidebar(page, false)
  await expect(page.locator('.ph[data-mode="extraction"]')).toBeVisible()
  await expect(page.locator('.pi-titlebar').getByRole('status')).toContainText(/^v1 · /)
})

test('saving the projection re-extracts both sides; one side failing leaves the other shown with its failure', async ({page, app}) => {
  test.slow()
  // An extractor that doesn't handle the old layout (HEAD~1 still has the legacy entity).
  const picky = [
    "const fs = require('node:fs')",
    "const {repository} = JSON.parse(fs.readFileSync(0, 'utf8'))",
    "const state = fs.readFileSync(repository.root + '/state.json', 'utf8')",
    "if (state.includes('\"legacy\"') && !state.includes('\"worker\"')) { process.stderr.write('Old layout not handled\\n'); process.exit(3) }",
    'process.stdout.write(state)',
  ].join('\n')
  await writeFile(
    join(app.repo, '.projections/picky.json'),
    JSON.stringify({
      id: 'picky',
      title: 'Picky extractor',
      renderer: 'architecture',
      extractor: {command: [process.execPath, '-e', picky]},
    }),
  )
  await page.goto(app.url)
  await chooseProjection(page, 'Picky extractor')
  await trust(page)
  const failure = page.locator('.pi-failure[data-side="before"]')
  await expect(failure).toContainText("Before (HEAD~1) didn't extract")
  await expect(failure).toContainText('Showing after (HEAD) alone')
  // What the extractor reported, once, without the path of the process that ran it; its stderr is in Raw output.
  await expect(failure.locator('.pi-failure-diagnostics')).toContainText('Old layout not handled')
  await expect(failure.locator('.pi-failure-stderr')).toHaveCount(0)
  expect((await failure.textContent())?.split('Old layout not handled').length).toBe(2)
  await expect(failure).not.toContainText(process.execPath)
  // The After side is shown alone, not hidden.
  await expect(page.locator('.ph[data-mode="extraction"]')).toBeVisible()
  await expect(page.locator('.pi-titlebar').getByRole('status')).toContainText('Before (HEAD~1) failed to extract')
  await failure.getByRole('button', {name: 'Diagnostics', exact: true}).click()
  await expect(page.getByRole('tablist', {name: 'Panel views'}).getByRole('tab', {name: /^Diagnostics/})).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.keyboard.press(`${mod}+j`)
  // Saving a fixed extractor re-extracts both sides, which then compare.
  await writeFile(
    join(app.repo, '.projections/picky.json'),
    JSON.stringify({
      id: 'picky',
      title: 'Picky extractor',
      renderer: 'architecture',
      extractor: {command: [process.execPath, 'collect.mjs']},
    }),
  )
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible({timeout: openingExtraction})
  await expect(failure).toHaveCount(0)
  await sidebar(page)
  await expect(page.locator('[data-revision="HEAD~1"]')).toHaveAttribute('data-status', 'done')
  await expect(page.locator('[data-revision="HEAD"]')).toHaveAttribute('data-status', 'done')
})

test('a projection is three parts: override the renderer and the comparator for the session, reset or save to the definition', async ({
  page,
  app,
}) => {
  test.slow()
  await page.goto(app.url)
  await chooseProjection(page, 'Checkout architecture')
  await trust(page)
  await openingDrawn(page)
  await sidebar(page)
  const parts = page.locator('.pi-parts')
  await expect(parts.locator('.pi-part-trigger')).toHaveCount(3)
  for (const name of ['Extractor', 'Comparator', 'Renderer']) await expect(parts.getByRole('combobox', {name, exact: true})).toBeVisible()
  await expect(parts.locator('[data-part="extractor"]')).toContainText('collect.mjs')
  await expect(parts.locator('.pi-changed')).toHaveCount(0)
  // The renderer: built-ins that can't present this extractor's schema are listed, disabled, with the reason.
  await parts.getByRole('combobox', {name: 'Renderer', exact: true}).click()
  const listbox = page.getByRole('listbox')
  const database = listbox.getByRole('option', {name: /^Database/})
  await expect(database).toHaveAttribute('aria-disabled', 'true')
  await expect(database).toContainText('Expects `database/v0`; this extractor emits `architecture/v0`')
  await listbox.getByRole('option', {name: /^Graph/}).click()
  await expect(listbox).toHaveCount(0)
  const renderer = parts.locator('[data-part="renderer"]')
  await expect(renderer.locator('.pi-changed')).toHaveText('changed from definition')
  await expect(page.locator('.ph[data-renderer-status="ready"]')).toBeVisible()
  await expect(page.locator('[data-active-view="renderer"]')).toContainText('Graph renderer')
  // Save to definition shows the definition file's diff and offers its JSON (the API can't write it).
  await parts.getByRole('button', {name: 'Save to definition…'}).click()
  const saveDialog = page.getByRole('dialog', {name: 'Save to definition'})
  // Once the runner previews the edit, the diff is its exact edit of the file: the fixture's one-line JSON, rewritten pretty.
  await expect(saveDialog.getByRole('button', {name: /^Save to .*architecture\.json$/})).toBeEnabled()
  await expect(saveDialog.locator('[data-kind="removed"]').filter({hasText: '"renderer":"architecture"'})).toHaveCount(1)
  await expect(saveDialog.locator('[data-kind="added"]').filter({hasText: '"renderer": "graph"'})).toHaveCount(1)
  await expect(saveDialog.getByRole('button', {name: 'Copy definition JSON'})).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(saveDialog).toHaveCount(0)
  // The comparator: the default one's ordering is changed in place; only the comparison runs again, in the browser.
  await sidebar(page)
  const jobs = await page.locator('[data-revision] [aria-label="Extracting"]').count()
  await parts.getByRole('combobox', {name: 'Order changes by'}).click()
  await page.getByRole('listbox').getByRole('option', {name: 'Dependents'}).click()
  const comparator = parts.locator('[data-part="comparator"]')
  await expect(comparator.locator('.pi-changed')).toHaveText('changed from definition')
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  expect(jobs).toBe(0)
  await expect(page.locator('[data-revision="HEAD~1"]')).toHaveAttribute('data-status', 'done')
  await expect(page.locator('[data-revision="HEAD"]')).toHaveAttribute('data-status', 'done')
  // Reset returns a part to the definition's.
  await renderer.getByRole('button', {name: "Reset the renderer to the definition's"}).click()
  await expect(renderer.locator('.pi-changed')).toHaveCount(0)
  await parts.getByRole('button', {name: 'Reset all'}).click()
  await expect(parts.locator('.pi-changed')).toHaveCount(0)
  // The same overrides are in the command palette.
  // The drawer (on a phone) closes first, so More's popover opens over the view.
  if (drawer(page)) await sidebar(page, false)
  await (await titleToggle(page, /^Command palette$/)).click()
  await page.keyboard.type('use renderer')
  const palette = page.getByRole('dialog', {name: 'Command palette'})
  await expect(palette.getByRole('option', {name: /^Use renderer: Graph/})).toBeVisible()
  await expect(palette.getByRole('option', {name: /^Use renderer: Database/})).toHaveCount(0)
  await palette.getByRole('option', {name: /^Use renderer: Graph/}).click()
  await sidebar(page)
  await expect(renderer.locator('.pi-changed')).toHaveText('changed from definition')
  // The drawer (on a phone) closes first, so More's popover opens over the view.
  if (drawer(page)) await sidebar(page, false)
  await (await titleToggle(page, /^Command palette$/)).click()
  await page.keyboard.type('use extractor')
  await expect(palette.getByRole('option', {name: /^Use extractor: Built-in repository-map/})).toBeVisible()
  await page.keyboard.press('Escape')
})

test('built-in extractors that run no repository code need no trust', async ({page, app}) => {
  await page.goto(app.untrustedUrl)
  await chooseProjection(page, 'Repository files')
  await expect(page.locator('.pi-trust-state')).toHaveAttribute('data-trust', 'not-needed')
  await expect(page.locator('.pi-trust')).toHaveCount(0)
  // Without trust the pair still extracts and compares.
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  await sidebar(page)
  await expect(page.locator('[data-revision="HEAD~1"]')).toHaveAttribute('data-status', 'done')
  await expect(page.locator('[data-revision="HEAD"]')).toHaveAttribute('data-status', 'done')
  await chooseProjection(page, 'Checkout architecture')
  await expect(page.locator('.pi-trust-state')).toHaveAttribute('data-trust', 'unauthorized')
  await sidebar(page)
  await expect(page.getByRole('button', {name: 'Extract HEAD', exact: true})).toBeDisabled()
})

test('offline saved artifact uses strict Wasm validation and rejects forged or duplicate input', async ({page, app}) => {
  // The review server holds a token, but any page can open saved artifacts without a runner.
  await page.goto(app.reviewUrl)
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  const upload = page.getByLabel('Open saved artifact', {exact: true})
  const artifact = JSON.stringify(app.extraction)
  await upload.setInputFiles({name: 'extraction.json', mimeType: 'application/json', buffer: Buffer.from(artifact)})
  await expect(page.locator('.ph[data-mode="extraction"]')).toBeVisible()
  await expect(page.getByRole('slider', {name: 'Transition'})).toHaveCount(0)
  await sidebar(page, false)
  await showAs(page, 'Table')
  await expect(page.getByRole('button', {name: 'Inventory worker', exact: true})).toBeVisible()
  await sidebar(page)
  await expect(page.getByLabel('Any ref')).toHaveCount(0)
  await upload.setInputFiles({name: 'comparison.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(app.comparison))})
  // A saved comparison becomes a preselected pair that the browser recomputes.
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'diff')
  await expect(page.getByRole('button', {name: /^Set Before .* as Before$/})).toHaveAttribute('aria-pressed', 'true')
  await upload.setInputFiles({
    name: 'forged.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({...app.extraction, digest: '0'.repeat(64)})),
  })
  await expect(page.locator('.pi-error[role=alert]')).toContainText('Could not load artifact')
  await upload.setInputFiles({
    name: 'duplicate.json',
    mimeType: 'application/json',
    buffer: Buffer.from(artifact.replace('"version":0', '"version":0,"version":0')),
  })
  await expect(page.locator('.pi-error[role=alert]')).toContainText('Could not load artifact')
})

test('extractor failures retain raw evidence, open diagnostics, and a supplied review never enables execution', async ({page, app}) => {
  await page.goto(app.url)
  await chooseProjection(page, 'Failing extractor')
  await trust(page)
  // Each side's failure is reported in the view, with which ref failed, what failed and the extractor's stderr.
  const failure = page.locator('.pi-failure')
  await expect(failure).toHaveCount(2)
  await expect(failure.first()).toContainText("Before (HEAD~1) didn't extract")
  await expect(failure.last()).toContainText("After (HEAD) didn't extract")
  await expect(failure.first()).toContainText('RUNNER_ERROR')
  await expect(failure.first().locator('.pi-failure-diagnostics')).toContainText('Deliberate extractor failure')
  await expect(failure.first()).not.toContainText(' exited with ')
  await expect(page.locator('.ph')).toHaveCount(0)
  // A revision outside the pair that fails is reported as an error, and the panel opens on Diagnostics.
  await sidebar(page)
  await page.getByRole('button', {name: 'Extract Working tree', exact: true}).click()
  await expect(page.locator('[data-revision="working-tree"]')).toHaveAttribute('data-status', 'failed')
  if (drawer(page)) await sidebar(page, false)
  await expect(page.locator('.pi-error[role=alert]')).toContainText('failed')
  await expect(page.locator('.ph')).toHaveCount(0)
  await expect(page.getByRole('tablist', {name: 'Panel views'}).getByRole('tab', {name: /^Diagnostics/})).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.locator('#pi-panel-content')).toContainText('RUNNER_ERROR')
  const raw = await panel(page, 'Raw output')
  await expect(raw).toContainText('Deliberate extractor failure')
  await expect(raw).toContainText('Incomplete result')
  await page.goto(app.reviewUrl)
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'diff')
  await sidebar(page)
  await expect(page.getByLabel('Any ref')).toHaveCount(0)
  await expect(page.getByRole('button', {name: /^Extract /})).toHaveCount(0)
})

test('the built-in renderer presents a saved review in a sandboxed frame', async ({page, app}) => {
  await page.goto(app.reviewUrl)
  await expect(page.locator('.ph[data-mode="comparison"][data-renderer-status="ready"]')).toBeVisible()
  await expect(page.locator('[data-active-view="renderer"]')).toHaveText('Graph renderer · built-in, sandboxed')
  // It opens in diff, one frame; side by side draws one sandboxed frame per revision.
  await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'diff')
  await chooseMode(page, 'Side by side')
  const frames = page.locator('iframe.ph-frame')
  await expect(frames).toHaveCount(2)
  for (const frame of await frames.all()) await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
  await expect(page.frameLocator('iframe.ph-frame').first().getByText('Inventory worker').first()).toBeVisible()
  // Animated presents both in one frame; Home on the transition slider shows the before revision.
  await chooseMode(page, 'Animated')
  await expect(frames).toHaveCount(1)
  // Playback joins the toolbar, which replans over a few frames; a key pressed while the slider moves is retried.
  await expect(async () => {
    await page.getByRole('group', {name: 'Comparison playback'}).getByRole('slider', {name: 'Transition'}).press('Home')
    await expect(page.locator('.ph[data-progress="0"][data-rendered-progress="0"]')).toBeVisible({timeout: 2000})
  }).toPass()
})

test('the snapshot page presents the served document chrome-free and marks when every pane has painted', async ({page, app}) => {
  const snapshot = (query: string) => app.reviewUrl.replace('/#', `/?view=snapshot&${query}#`)
  const html = page.locator('html')
  await page.goto(snapshot('mode=side-by-side&theme=dark'))
  await expect(html).toHaveAttribute('data-projections-snapshot', 'ready')
  await expect(page.locator('#snapshot[data-mode="side-by-side"]')).toBeVisible()
  await expect(page.locator('iframe.ph-frame')).toHaveCount(2)
  for (const frame of await page.locator('iframe.ph-frame').all()) await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
  // No controls but the summary bar's figures, which the picture draws below the stage as every view has it.
  await expect(page.getByRole('group', {name: 'Summary'})).toHaveAttribute('data-sentence', /\S/)
  await expect(page.getByRole('group', {name: 'Summary'}).locator('[data-summary-figure]')).not.toHaveCount(0)
  await expect(page.getByRole('button').and(page.locator(':not([data-summary-bar] *)'))).toHaveCount(0)
  await expect(page.getByText(/Before · [0-9a-f]{8}/)).toBeVisible()
  // By default one card frames the stage, the legend and the summary bar, on no page background.
  await expect(page.locator('#snapshot[data-frame="card"] .pi-snapshot-card [data-summary-bar]')).toBeVisible()
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  // --frame none: the renderer's content alone.
  await page.goto(snapshot('frame=none'))
  await expect(html).toHaveAttribute('data-projections-snapshot', 'ready')
  await expect(page.locator('#snapshot[data-frame="none"] iframe.ph-frame')).toHaveCount(1)
  await expect(page.getByRole('group', {name: 'Summary'})).toHaveCount(0)
  // The before revision, at progress 0 of the animated transition.
  await page.goto(snapshot('progress=0'))
  await expect(html).toHaveAttribute('data-projections-snapshot', 'ready')
  // The card, by its accessible name, shows the before revision's name (not a hidden tooltip with the same text).
  await expect(page.frameLocator('iframe.ph-frame').getByRole('button', {name: /^Inspect (\S+ )?Legacy inventory,/})).toBeVisible()
  // The graph renderer's diff, one static frame.
  await page.goto(snapshot('mode=diff'))
  await expect(html).toHaveAttribute('data-projections-snapshot', 'ready')
  await expect(page.locator('iframe.ph-frame')).toHaveCount(1)
  // What can't be shown fails with a reason instead of an image.
  await page.goto(snapshot('progress=2'))
  await expect(html).toHaveAttribute('data-projections-snapshot-error', /progress/)
})

test('a renderer that never becomes ready is reported and the built-in views remain usable', async ({page, app}) => {
  await page.route('**/renderers/graph/index.html', route =>
    route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><title>Silent</title>'}),
  )
  await page.goto(app.reviewUrl)
  await expect(page.locator('.ph[data-renderer-status="failed"]')).toBeVisible({timeout: 20_000})
  await expect(page.getByText('The Graph renderer stopped.', {exact: false}).first()).toBeVisible()
  await page.getByRole('button', {name: 'Show table', exact: true}).first().click()
  await expect(page.locator('[data-active-view="table"]')).toHaveText('Built-in table view')
  await expect(page.getByRole('button', {name: 'Inventory worker', exact: true})).toBeVisible()
})

test('renderer frames never learn the page address', async ({page, app}) => {
  await page.goto(app.reviewUrl)
  await expect(page.locator('.ph[data-renderer-status="ready"]')).toBeVisible()
  expect(
    await page
      .frameLocator('iframe.ph-frame')
      .first()
      .locator('body')
      .evaluate(() => document.referrer),
  ).toBe('')
  // A reload reads the runner again.
  await page.reload()
  await expect(page.locator('.ph[data-renderer-status="ready"]')).toBeVisible()
})

test('the workbench gives the view the space: a short title bar and status bar at desktop size', async ({page, app}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop geometry')
  await page.setViewportSize({width: 1440, height: 900})
  await page.goto(app.reviewUrl)
  await expect(page.locator('.ph[data-renderer-status="ready"]')).toBeVisible()
  await expect(page.getByRole('region', {name: 'Panel'})).toHaveCount(0)
  const title = (await page.locator('.pi-titlebar').boundingBox())!
  const status = (await page.locator('.pi-statusbar').boundingBox())!
  const main = (await page.locator('.pi-main').boundingBox())!
  expect(title.height).toBeLessThanOrEqual(40)
  expect(status.height).toBeLessThanOrEqual(24)
  expect((main.width * main.height) / (1440 * 900)).toBeGreaterThanOrEqual(0.7)
  expect(title.width).toBe(1440)
})

test('human text is sentence case: nothing in the workbench is uppercased by style', async ({page, app}) => {
  await page.goto(app.url)
  await panel(page, 'Extraction')
  await sidebar(page)
  await expect(page.getByRole('heading', {name: 'History', exact: true})).toBeVisible()
  const uppercased = await page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter(element => getComputedStyle(element).textTransform === 'uppercase' && element.textContent?.trim())
      .map(element => element.textContent!.trim().slice(0, 40)),
  )
  expect(uppercased).toEqual([])
})

test('keyboard first: the command palette, sidebar and panel shortcuts', async ({page, app}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Keyboard shortcuts are for desktop')
  await page.goto(app.reviewUrl)
  await expect(page.locator('.ph[data-renderer-status="ready"]')).toBeVisible()
  await page.keyboard.press(`${mod}+k`)
  const palette = page.getByRole('dialog', {name: 'Command palette'})
  await expect(palette).toBeVisible()
  await expect(page.getByRole('combobox', {name: 'Command'})).toBeFocused()
  await page.keyboard.type('panel diagnostics')
  await expect(palette.getByRole('option').first()).toContainText('Show Diagnostics')
  await page.keyboard.press('Enter')
  await expect(palette).toHaveCount(0)
  await expect(page.getByRole('region', {name: 'Panel'})).toBeVisible()
  await page.keyboard.press(`${mod}+j`)
  await expect(page.getByRole('region', {name: 'Panel'})).toHaveCount(0)
  await page.keyboard.press(`${mod}+b`)
  await expect(page.getByRole('complementary', {name: 'Explorer'})).toHaveCount(0)
  await page.keyboard.press(`${mod}+b`)
  await expect(page.getByRole('complementary', {name: 'Explorer'})).toBeVisible()
  // Arrow keys move through the commands; Escape closes and returns focus.
  await page.getByRole('button', {name: 'Command palette'}).click()
  await expect(page.getByRole('combobox', {name: 'Command'})).toBeFocused()
  await page.keyboard.type('theme dark')
  await expect(palette.getByRole('option')).toHaveCount(1)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(page.locator('.pi-shell')).toHaveAttribute('data-color-mode', 'dark')
  await page.getByLabel('Open saved artifact', {exact: true}).focus()
  await page.keyboard.press(`${mod}+k`)
  await expect(page.getByRole('combobox', {name: 'Command'})).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(palette).toHaveCount(0)
  await expect(page.getByLabel('Open saved artifact', {exact: true})).toBeFocused()
  await page.keyboard.press(`${mod}+i`)
  await sidebar(page)
  await expect(page.getByRole('button', {name: /^Set After .* as Before$/})).toHaveAttribute('aria-pressed', 'true')
})

test('the Explorer: open by default, ⌘B toggles it, its width is remembered, a drawer on phones', async ({page, app}, testInfo) => {
  await page.goto(app.url)
  await expect(page.locator('.pi-activity[data-watching]')).toBeAttached()
  const explorer = page.getByRole('complementary', {name: 'Explorer'})
  if (testInfo.project.name.includes('mobile')) {
    // A drawer: closed at first, then over the view (not beside it), and closed by its backdrop.
    await expect(explorer).toHaveCount(0)
    await sidebar(page)
    await expect(explorer).toHaveCSS('position', 'absolute')
    await expect(explorer.getByRole('navigation', {name: 'Explorer'})).toBeVisible()
    const box = (await explorer.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    await page.mouse.click(page.viewportSize()!.width - 10, 400)
    await expect(explorer).toHaveCount(0)
    return
  }
  await expect(explorer).toBeVisible()
  await expect(explorer.getByRole('navigation', {name: 'Explorer'})).toBeVisible()
  // Only the current projection's sections: the title bar's switcher chooses the projection, and names it.
  for (const name of ['Parts', 'Compare']) await expect(explorer.getByRole('region', {name})).toBeVisible()
  await expect(explorer.getByRole('tree')).toHaveCount(0)
  await expect(explorer).not.toContainText('Parts of')
  // Sections collapse and stay collapsed.
  await explorer.getByRole('button', {name: 'Parts', exact: true}).click()
  await expect(explorer.getByRole('button', {name: 'Parts', exact: true})).toHaveAttribute('aria-expanded', 'false')
  await expect(explorer.locator('.pi-parts')).toBeHidden()
  await page.keyboard.press(`${mod}+b`)
  await expect(explorer).toHaveCount(0)
  await page.keyboard.press(`${mod}+b`)
  await expect(explorer).toBeVisible()
  // The splitter resizes it from the keyboard too; the width is remembered.
  const width = (await explorer.boundingBox())!.width
  await page.getByRole('separator', {name: 'Resize sidebar'}).focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => Math.round((await explorer.boundingBox())!.width)).toBe(Math.round(width + 48))
  await page.reload()
  await expect(explorer).toBeVisible()
  expect(Math.round((await explorer.boundingBox())!.width)).toBe(Math.round(width + 48))
  await expect(explorer.getByRole('button', {name: 'Parts', exact: true})).toHaveAttribute('aria-expanded', 'false')
})

test('the projection switcher: the centred document title, opened by a click or ⌘P, filters, switches keeping the pair, shows other failures', async ({
  page,
  app,
}, testInfo) => {
  test.slow()
  const mobile = testInfo.project.name.includes('mobile')
  await page.goto(app.url)
  const trigger = switcher(page)
  await trust(page)
  await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
  // The current projection's title is the document title, centred in the title bar, with a chevron.
  await expect(trigger).toHaveAttribute('aria-label', 'Projection: Checkout architecture')
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toHaveAttribute('title', /^Checkout architecture \(architecture\)/)
  const box = (await trigger.boundingBox())!
  expect(Math.abs(box.x + box.width / 2 - page.viewportSize()!.width / 2)).toBeLessThanOrEqual(1)
  // A click opens it on the current projection, checked: every projection with its ID and status.
  await trigger.click()
  const dialog = page.getByRole('dialog', {name: 'Switch projection'})
  const input = dialog.getByRole('combobox', {name: 'Find a projection'})
  const list = dialog.getByRole('listbox', {name: 'Projections'})
  const options = list.getByRole('option')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute('aria-autocomplete', 'list')
  await expect(input).toHaveAttribute('aria-controls', (await list.getAttribute('id'))!)
  await expect(options).toHaveCount(4)
  await expect(options.locator('code')).toHaveText(['architecture', 'broken', 'files', 'slow'])
  const current = list.locator('[aria-current="true"]')
  await expect(current).toHaveAttribute('data-projection', 'architecture')
  await expect(current).toHaveAttribute('aria-selected', 'true')
  await expect(input).toHaveAttribute('aria-activedescendant', (await current.getAttribute('id'))!)
  await expect(current).toHaveAccessibleName('Checkout architecture, architecture, OK, current')
  // Its status is an icon with words, never color alone.
  await expect(current.locator('.pi-dot[data-status="ok"]')).toHaveText('OK')
  await expect(current.locator('.pi-dot svg')).toHaveCount(1)
  // Arrow keys move the active option (and wrap); Escape closes and returns focus to the switcher.
  await page.keyboard.press('ArrowDown')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(options.last()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toBeFocused()
  // A pair other than the default.
  await sidebar(page)
  await page.getByRole('list', {name: 'Pairs'}).getByRole('button', {name: 'Compare HEAD → Working tree'}).click()
  await expect(refField(page, 'After')).toHaveValue('Working tree')
  if (drawer(page)) await sidebar(page, false)
  // ⌘P opens it (the palette names it too); on a phone it is a sheet, opened by a tap.
  if (mobile) await trigger.click()
  else await page.keyboard.press(`${mod}+p`)
  await expect(input).toBeFocused()
  if (mobile) {
    await expect(dialog).toHaveAttribute('data-sheet', 'true')
    const sheet = (await dialog.boundingBox())!
    expect(sheet.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 17)
  }
  // Typing filters by title or ID; no match says so; Enter switches to the active option.
  await page.keyboard.type('nothing like this')
  await expect(options).toHaveCount(0)
  await expect(list).toContainText('No matching projection.')
  await input.fill('files')
  await expect(options).toHaveCount(1)
  await expect(options.first()).toHaveAttribute('data-projection', 'files')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toHaveAttribute('aria-label', 'Projection: Repository files')
  // Switching keeps the pair: the data axis is independent of the projection.
  await sidebar(page)
  await expect(refField(page, 'Before')).toHaveValue('HEAD')
  await expect(refField(page, 'After')).toHaveValue('Working tree')
  await expect(page.getByRole('region', {name: 'Parts'}).locator('[data-part="extractor"]')).toContainText('Built-in · repository-map')
  if (drawer(page)) await sidebar(page, false)
  // Another projection's failure stays in sight: the trigger counts it, and its option says so.
  await chooseProjection(page, 'Failing extractor')
  await expect(page.locator('.pi-failure')).toHaveCount(2)
  await expect(trigger).not.toHaveAttribute('data-failing')
  await chooseProjection(page, 'Repository files')
  await expect(trigger).toHaveAttribute('aria-label', 'Projection: Repository files, 1 other projection failing')
  await expect(trigger.locator('.pi-failing')).toHaveText('1 failing')
  await expect(trigger).toHaveAttribute('title', /Failing: Failing extractor/)
  await trigger.click()
  const broken = list.locator('[data-projection="broken"]')
  await expect(broken).toHaveAttribute('data-status', 'failed')
  await expect(broken.locator('.pi-dot')).toHaveText('Failed')
  await expect(broken).toHaveAccessibleName('Failing extractor, broken, Failed')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  // The choice is remembered for this repository.
  await page.reload()
  await expect(trigger).toHaveAttribute('aria-label', switcherName('Repository files'))
})

test('without trust, the switcher marks the projections that need it', async ({page, app}) => {
  await page.goto(app.untrustedUrl)
  await expect(switcher(page)).toBeEnabled()
  await switcher(page).click()
  const list = page.getByRole('listbox', {name: 'Projections'})
  for (const id of ['architecture', 'broken', 'slow']) {
    await expect(list.locator(`[data-projection="${id}"] .pi-dot`), id).toHaveText('Needs trust')
  }
  await expect(list.locator('[data-projection="files"]')).not.toHaveAttribute('data-status', 'trust')
  await page.keyboard.press('Escape')
})

test('the Settings gear is a toolbar item whose menu chooses the theme from the keyboard', async ({page, app}) => {
  await page.goto(app.url)
  await expect(page.locator('.pi-activity[data-watching]')).toBeAttached()
  const toolbar = page.getByRole('toolbar', {name: 'Inspector'})
  await expect(toolbar.getByRole('button', {name: 'Settings', exact: true})).toHaveAttribute('aria-haspopup', 'menu')
  // An open menu hides the rest of the page from assistive technology, so the gear is found by its class too.
  const gear = page.locator('.pi-settings')
  await expect(gear).toHaveAttribute('title', 'Settings')
  // The toolbar's roving focus reaches the gear: Arrow Left from its neighbor, Commands (or More on a phone).
  const next = toolbar.getByRole('button', {name: /^(Command palette|More actions)$/})
  // Just after loading, the title bar can replan its layout between the focus and the key: start over until it lands.
  await expect(async () => {
    await next.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(gear).toBeFocused({timeout: 2_000})
  }).toPass()
  // Enter opens the menu on its first item; it renders in the scoped root, the current theme checked.
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(gear).toHaveAttribute('aria-expanded', 'true')
  expect(await menu.evaluate(element => Boolean(element.closest('.pj-root')))).toBe(true)
  const theme = menu.getByRole('group', {name: 'Theme'})
  await expect(theme.getByRole('menuitemradio')).toHaveText(['System', 'Light', 'Dark'])
  await expect(theme.getByRole('menuitemradio', {name: 'System'})).toHaveAttribute('aria-checked', 'true')
  await expect(theme.getByRole('menuitemradio', {name: 'System'})).toBeFocused()
  // Arrow Down moves to Dark; Enter chooses it, closes the menu and returns focus to the gear.
  await page.keyboard.press('ArrowDown')
  await expect(theme.getByRole('menuitemradio', {name: 'Light'})).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(theme.getByRole('menuitemradio', {name: 'Dark'})).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
  await expect(gear).toBeFocused()
  await expect(page.locator('.pi-shell')).toHaveAttribute('data-color-mode', 'dark')
  // Arrow Down and Space open it too, with Dark now checked; Escape closes it and returns focus to the gear.
  for (const key of ['ArrowDown', 'Space']) {
    await page.keyboard.press(key)
    await expect(menu, key).toBeVisible()
    await expect(theme.getByRole('menuitemradio', {name: 'Dark'}), key).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await expect(menu, key).toHaveCount(0)
    await expect(gear, key).toBeFocused()
  }
  await expect(page.locator('.pi-shell')).toHaveAttribute('data-color-mode', 'dark')
  // The roving focus still moves on from the gear in both directions.
  await page.keyboard.press('ArrowRight')
  await expect(next).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(gear).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(gear).not.toBeFocused()
})

test('every title-bar control moves its content, never its box, while pressed; reduced motion presses nothing', async ({
  page,
  app,
}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'A mouse press; the desktop projects cover Chromium and WebKit.')
  await page.setViewportSize({width: 1600, height: 800})
  await page.goto(app.url)
  // Pressed only once the opening comparison is drawn: on a starved runner, startup (the extractions landing, the
  // renderer loading) kept the page from answering a style read for two seconds, though the press showed at once.
  await openingDrawn(page)
  // By CSS: an open menu hides the rest of the page from assistive technology, and some controls open one on press.
  const toolbar = page.locator('.pi-titlebar [role="toolbar"]')
  /** The `translate` of a control's content: its element children, or a file button's face beside its input. */
  const offsets = (control: Locator) =>
    control.evaluate(element => {
      const face = element instanceof HTMLInputElement ? element.parentElement! : element
      return [...face.children].filter(child => child.tagName !== 'INPUT').map(child => getComputedStyle(child).translate)
    })
  const press = async (expected: string) => {
    // A menu trigger opens on pointerdown, and under load WebKit can drop `:active` once the menu takes the pointer before
    // the first read. The hold keeps menus closed, so it measures only the press; springing back while open is checked below.
    await page.evaluate(() => {
      const hold = (event: Event) => {
        if ((event.target as Element | null)?.closest?.('[aria-haspopup]')) event.stopImmediatePropagation()
      }
      ;(window as unknown as {__hold?: typeof hold}).__hold = hold
      window.addEventListener('pointerdown', hold, true)
    })
    const seen: string[] = []
    for (const control of await toolbar.locator('button, [role="combobox"], input[type="file"]').filter({visible: true}).all()) {
      if (await control.isDisabled()) continue
      const name = (await control.getAttribute('aria-label')) ?? (await control.textContent()) ?? ''
      const before = (await control.boundingBox())!
      await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
      await page.mouse.down()
      // Polled: under load, the first style read can land before the pressed state is applied. A failure shows the
      // offsets read, not only that they were wrong.
      await expect
        .poll(
          async () => {
            const moved = await offsets(control)
            return moved.length > 0 && moved.every(offset => offset === expected) ? expected : moved.join(', ') || 'no content'
          },
          {message: name},
        )
        .toBe(expected)
      const during = (await control.boundingBox())!
      // Released elsewhere, the press is no click; a menu that opens on press closes again.
      await page.mouse.move(2, 400)
      await page.mouse.up()
      expect(during, name).toEqual(before)
      seen.push(name)
      if (await page.locator('[role="menu"], [role="listbox"]').count()) {
        await page.keyboard.press('Escape')
        await expect(page.locator('[role="menu"], [role="listbox"]')).toHaveCount(0)
      }
    }
    await page.evaluate(() => {
      const hold = (window as unknown as {__hold?: (event: Event) => void}).__hold
      if (hold) window.removeEventListener('pointerdown', hold, true)
    })
    return seen
  }
  const seen = await press('0px 1px')
  expect(seen).toEqual(expect.arrayContaining(['Settings', 'Open saved artifact', 'Command palette', 'Hide explorer sidebar']))
  // Presses spring back on release: the gear's content is back in place while its menu is open, and after.
  await toolbar.getByRole('button', {name: 'Settings', exact: true}).click()
  await expect(page.getByRole('menu')).toBeVisible()
  expect(new Set(await offsets(page.locator('.pi-settings')))).toEqual(new Set(['none']))
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  expect(new Set(await offsets(page.locator('.pi-settings')))).toEqual(new Set(['none']))
  await page.emulateMedia({reducedMotion: 'reduce'})
  await press('none')
})

test('the title bar is a planned toolbar: no overlap, nothing clipped or truncated without a title, everything reachable', async ({
  page,
  app,
}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'The sweep sets its own widths')
  test.slow()
  await page.goto(app.url)
  await expect(page.locator('.pi-activity[data-watching]')).toBeAttached()
  await chooseProjection(page, 'Checkout architecture')
  // The title bar names the product quietly on the left; the projection switcher in the centre is the document title.
  await expect(page.locator('.pi-titlebar .pi-title')).toHaveText('Projections Inspector')
  await expect(switcher(page)).toHaveAttribute('aria-label', 'Projection: Checkout architecture')
  await expect(page.locator('.pi-titlebar [role="toolbar"] > svg, .pi-titlebar .pi-title svg')).toHaveCount(0)
  await expect(page.getByRole('toolbar', {name: 'Inspector'})).toBeVisible()
  for (const width of [1440, 1024, 768, 600, 480, 390]) {
    await page.setViewportSize({width, height: 800})
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const at = `at ${width}px`
    const bar = await page.locator('.pi-titlebar').evaluate(header => {
      const box = (element: Element) => element.getBoundingClientRect()
      const shown = (element: Element) => box(element).width > 1 && box(element).height > 1
      const outer = box(header)
      const controls = [...header.querySelectorAll('button, [role="combobox"], input, [role="status"]')].filter(shown).map(element => ({
        name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
        rect: box(element),
      }))
      const overlaps: string[] = []
      for (const [index, a] of controls.entries()) {
        for (const b of controls.slice(index + 1)) {
          if (
            Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 0.5 &&
            Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) > 0.5
          ) {
            overlaps.push(`${a.name} × ${b.name}`)
          }
        }
      }
      const outside = controls
        .filter(
          ({rect}) => rect.left < outer.left - 0.5 || rect.right > outer.right + 0.5 || rect.top < outer.top || rect.bottom > outer.bottom,
        )
        .map(({name}) => name)
      // Text cut short (by overflow) must carry its full value as a title, on itself or an ancestor.
      const untitled = [...header.querySelectorAll('span, button, [role="combobox"]')]
        .filter(element => shown(element) && element.scrollWidth > element.clientWidth + 1 && !element.closest('[title]'))
        .map(element => element.textContent?.trim())
      return {height: outer.height, overflow: header.scrollWidth - header.clientWidth, overlaps, outside, untitled}
    })
    expect(bar.height, at).toBeLessThanOrEqual(40)
    expect(bar.overflow, at).toBeLessThanOrEqual(0)
    expect(bar.overlaps, at).toEqual([])
    expect(bar.outside, at).toEqual([])
    expect(bar.untitled, at).toEqual([])
    // The switcher stays centred in the window at every width, its title truncated (with a tooltip) when it must be.
    const center = (await switcher(page).boundingBox())!
    expect(Math.abs(center.x + center.width / 2 - width / 2), at).toBeLessThanOrEqual(1)
    expect(center.width, at).toBeGreaterThanOrEqual(96)
    await expect(switcher(page), at).toHaveAttribute('title', /^Checkout architecture \(architecture\)/)
    // Every item is in the bar, or in "More actions" by the same name; the status line keeps its text for assistive technology.
    await expect(page.locator('.pi-activity[data-watching]'), at).toBeAttached()
    await expect(page.locator('.pi-trust-state'), at).toBeVisible()
    const titlebar = page.locator('.pi-titlebar')
    const more = page.getByRole('dialog', {name: 'More actions'})
    if (await titlebar.getByRole('button', {name: 'More actions'}).isVisible()) {
      await titlebar.getByRole('button', {name: 'More actions'}).click()
    }
    // The Settings gear is already an icon: it stays in the bar at every width.
    await expect(titlebar.getByRole('button', {name: 'Settings', exact: true}), at).toBeVisible()
    for (const name of [/^(Show|Hide) explorer sidebar$/, /^(Show|Hide) panel$/, /^(Show|Hide) details panel$/, /^Command palette$/]) {
      await expect(titlebar.or(more).getByRole('button', {name}).first(), `${name} ${at}`).toBeVisible()
    }
    await expect(
      titlebar
        .getByLabel('Open saved artifact', {exact: true})
        .or(more.getByRole('button', {name: 'Open saved artifact'}))
        .first(),
      at,
    ).toBeVisible()
    if (await more.isVisible()) {
      await page.keyboard.press('Escape')
      await expect(more).toHaveCount(0)
    }
  }
})

/** Text left edges inside the Explorer (section labels, Parts and Compare row titles, sublabels), relative to the card. */
const textColumns = (page: Page) =>
  page.getByRole('complementary', {name: 'Explorer'}).evaluate(explorer => {
    const left = explorer.getBoundingClientRect().left
    const start = (element: Element | null) => {
      if (!element) return undefined
      const range = document.createRange()
      range.selectNodeContents(element)
      return Math.round(range.getBoundingClientRect().left - left)
    }
    return {
      headers: [...explorer.querySelectorAll('.pi-x-header .pi-x-title')].map(start),
      rows: [...explorer.querySelectorAll('.pi-x-row .pi-x-title')].map(start),
      sublabels: [...explorer.querySelectorAll('.pi-x-sublabel h3')].map(start),
      fills: [...explorer.querySelectorAll('.pi-x-row[aria-pressed="true"]')].map(row => {
        const box = row.getBoundingClientRect(),
          body = row.closest('.pi-x-body')!.getBoundingClientRect()
        return {left: Math.round(box.left - body.left), right: Math.round(body.right - box.right), height: Math.round(box.height)}
      }),
    }
  })

for (const [theme, width] of [
  ['Light', 1440],
  ['Dark', 1440],
  ['Light', 390],
  ['Dark', 390],
] as const) {
  test(`the Explorer's spacing is one system (${theme.toLowerCase()}, ${width}px)`, async ({page, app}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'One project covers the geometry')
    await page.setViewportSize({width, height: 900})
    await page.goto(app.url)
    await trust(page)
    await chooseTheme(page, theme)
    await sidebar(page)
    await expect(page.locator('.pi-part').first()).toBeVisible()
    await expect(page.locator('.pi-x-row[aria-pressed="true"]').first()).toBeVisible()
    const columns = await textColumns(page)
    // Section labels, the Parts and Compare rows' titles and the sublabels start on one column.
    expect(columns.headers.length, JSON.stringify(columns)).toBe(2)
    expect(columns.rows.length, JSON.stringify(columns)).toBeGreaterThanOrEqual(8)
    expect(columns.sublabels.length, JSON.stringify(columns)).toBeGreaterThanOrEqual(2)
    const all = [...columns.headers, ...columns.rows, ...columns.sublabels].filter(value => value !== undefined)
    expect(new Set(all), JSON.stringify(columns)).toEqual(new Set([all[0]]))
    // A selected fill is inset evenly from both sides of its section, and rows are on the 4px grid.
    for (const fill of columns.fills) {
      expect(fill.left, JSON.stringify(fill)).toBe(fill.right)
      expect(fill.height % 4, JSON.stringify(fill)).toBe(0)
    }
    if (process.env.PROJECTIONS_SHOTS) {
      await page
        .getByRole('complementary', {name: 'Explorer'})
        .screenshot({path: join(process.env.PROJECTIONS_SHOTS, `explorer-${theme.toLowerCase()}-${width}.png`)})
    }
  })
}

/** The look of a card: its radius, border and surface. */
const cardLook = (locator: Locator) =>
  locator.evaluate(element => {
    const style = getComputedStyle(element)
    return {
      radius: style.borderTopLeftRadius,
      border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
      surface: style.backgroundColor,
    }
  })

for (const [theme, width] of [
  ['Light', 1440],
  ['Dark', 1440],
  ['Light', 390],
  ['Dark', 390],
] as const) {
  test(`the workbench is cards on a gutter (${theme.toLowerCase()}, ${width}px)`, async ({page, app}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'One project covers the geometry')
    await page.setViewportSize({width, height: 900})
    await page.goto(app.url)
    await trust(page)
    await chooseTheme(page, theme)
    await page.getByRole('note', {name: 'Tip'}).getByRole('button', {name: 'Dismiss tip'}).click()
    await openingDrawn(page)
    const gutter = 8
    const explorer = page.getByRole('complementary', {name: 'Explorer'})
    // The view's card sets the radius, border and surface every workbench card shares; inside it the view is flat.
    await expect(page.locator('.ph')).toHaveAttribute('data-comparison-mode', 'diff')
    const viewCard = page.locator('.pi-view.pi-card')
    const stage = await cardLook(viewCard)
    await expect(page.locator('.ph-single').first()).toHaveCSS('border-top-width', '0px')
    await expect(page.locator('.ph-toolbar').first()).toHaveCSS('border-top-left-radius', '0px')
    await sidebar(page)
    expect(await cardLook(explorer)).toEqual(stage)
    // The title bar and status bar sit on the gutter: no fill or edge of their own.
    for (const bar of ['.pi-titlebar', '.pi-statusbar']) {
      expect(
        await page.locator(bar).evaluate(element => {
          const style = getComputedStyle(element)
          return [style.backgroundColor, style.borderTopWidth, style.borderBottomWidth]
        }),
        bar,
      ).toEqual(['rgba(0, 0, 0, 0)', '0px', '0px'])
    }
    // Section labels sit on the card: no bars, no full-width dividers.
    const sections = await explorer.locator('.pi-explorer-section').evaluateAll(list =>
      list.map(section => {
        const header = section.querySelector(':scope > div')!
        return {
          border: getComputedStyle(section).borderBottomWidth,
          header: getComputedStyle(header).backgroundColor,
          card: getComputedStyle(section.closest('.pi-card')!).backgroundColor,
        }
      }),
    )
    for (const section of sections) {
      expect(section.border).toBe('0px')
      expect(section.header).toBe(section.card)
    }
    const titlebar = (await page.locator('.pi-titlebar').boundingBox())!
    const statusbar = (await page.locator('.pi-statusbar').boundingBox())!
    const card = (await explorer.boundingBox())!
    // The cards float between the bars, one gutter from them and from the window's edge.
    expect(Math.round(card.x)).toBe(gutter)
    expect(Math.round(card.y - (titlebar.y + titlebar.height))).toBe(gutter)
    expect(Math.round(statusbar.y - (card.y + card.height))).toBe(gutter)
    if (!drawer(page)) {
      // One gutter between the Explorer and the view, with the resize handle in it, shown on hover.
      const view = (await viewCard.boundingBox())!
      expect(Math.round(view.x - (card.x + card.width))).toBe(gutter)
      expect(Math.round(view.y)).toBe(Math.round(card.y))
      const handle = page.getByRole('separator', {name: 'Resize sidebar'})
      const grip = (await handle.boundingBox())!
      expect(Math.round(grip.x)).toBe(Math.round(card.x + card.width))
      expect(Math.round(grip.width)).toBe(gutter)
      const line = () => handle.evaluate(element => getComputedStyle(element, '::after').backgroundColor)
      expect(await line()).toBe('rgba(0, 0, 0, 0)')
      await handle.hover()
      await expect.poll(line).not.toBe('rgba(0, 0, 0, 0)')
      await page.mouse.move(width / 2, 400)
      // The docked Details panel is a card of the same look, one gutter right of the view and from the window.
      await details(page)
      const dock = page.getByRole('complementary', {name: 'Details'})
      expect(await cardLook(dock)).toEqual(stage)
      const right = (await dock.boundingBox())!
      const stageNow = (await viewCard.boundingBox())!
      expect(Math.round(right.x - (stageNow.x + stageNow.width))).toBe(gutter)
      expect(Math.round(width - (right.x + right.width))).toBe(gutter)
      expect(Math.round(right.y)).toBe(Math.round(card.y))
      await details(page, false)
      // Collapsed (⌘B) there is no Explorer card: the view's card starts one gutter from the window's edge.
      await page.keyboard.press(`${mod}+b`)
      await expect(explorer).toHaveCount(0)
      expect(Math.round((await viewCard.boundingBox())!.x)).toBe(gutter)
    } else {
      // Below 1012px it is a sheet over the view, with the same card look.
      await expect(explorer).toHaveCSS('position', 'absolute')
      expect(card.width).toBeLessThan(width - 2 * gutter)
    }
  })
}

test('the docked Details panel: toggled and resized like the Explorer, remembered, and it follows the selection', async ({
  page,
  app,
}, testInfo) => {
  const mobile = testInfo.project.name.includes('mobile')
  await page.goto(app.url)
  await trust(page)
  await openingDrawn(page)
  if (drawer(page)) await sidebar(page, false)
  const dock = page.getByRole('complementary', {name: 'Details'})
  // Closed until someone opens it; then it says how to fill it.
  await expect(dock).toHaveCount(0)
  await details(page)
  await expect(dock).toContainText('Select an entity or relationship in the view')
  if (drawer(page)) await details(page, false)
  // It follows the selection without popping in or out, and the view draws no details of its own.
  await showAs(page, 'Table')
  await page.getByRole('button', {name: 'Inventory worker', exact: true}).click()
  await details(page)
  const raw = dock.locator('.ph-details')
  await expect(raw).toContainText('worker')
  await expect(raw).toContainText('Storage')
  await expect(raw).toContainText('Modified')
  await expect(page.locator('.pi-view .ph-details')).toHaveCount(0)
  if (mobile) {
    // A sheet over the view, closed by its scrim.
    await expect(dock).toHaveCSS('position', 'absolute')
    await page.mouse.click(4, 400)
    await expect(dock).toHaveCount(0)
    return
  }
  // Checkout is unchanged: every item lists it.
  await page.getByRole('radiogroup', {name: 'Scope'}).getByRole('radio', {name: /^All/}).click()
  await page.getByRole('button', {name: 'Checkout', exact: true}).click()
  await expect(raw).toContainText('checkout')
  // The worker's details are gone (its layer; the revisions' commit subjects mention the worker too).
  await expect(raw).not.toContainText('Storage')
  await expect(dock).toBeVisible()
  // ⌥⌘B / Ctrl+Alt+B toggles it; so does the palette.
  await page.keyboard.press(`${mod}+Alt+b`)
  await expect(dock).toHaveCount(0)
  await page.keyboard.press(`${mod}+Alt+b`)
  await expect(dock).toBeVisible()
  await page.keyboard.press(`${mod}+k`)
  await page.keyboard.type('details panel')
  const option = page.getByRole('dialog', {name: 'Command palette'}).getByRole('option', {name: /^Hide details panel/})
  await expect(option).toContainText(process.platform === 'darwin' ? '⌥⌘B' : 'Ctrl+Alt+B')
  await page.keyboard.press('Escape')
  // Its handle resizes it from the keyboard too; its width and visibility are remembered.
  const width = (await dock.boundingBox())!.width
  await page.getByRole('separator', {name: 'Resize details panel'}).focus()
  await page.keyboard.press('Shift+ArrowLeft')
  await expect.poll(async () => Math.round((await dock.boundingBox())!.width)).toBe(Math.round(width + 48))
  await page.reload()
  await expect(dock).toBeVisible()
  expect(Math.round((await dock.boundingBox())!.width)).toBe(Math.round(width + 48))
  await details(page, false)
  await page.reload()
  await expect(page.locator('.pi-activity[data-watching]')).toBeAttached()
  await expect(dock).toHaveCount(0)
})

test('the command palette input has no focus ring; the active command row is highlighted', async ({page, app}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'The palette is for keyboard desktops')
  await page.goto(app.url)
  for (const theme of ['Light', 'Dark'] as const) {
    await chooseTheme(page, theme)
    await page.keyboard.press(`${mod}+k`)
    const palette = page.getByRole('dialog', {name: 'Command palette'})
    const input = palette.getByRole('combobox', {name: 'Command'})
    await expect(input).toBeFocused()
    await page.keyboard.press('ArrowDown')
    expect(await input.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none')
    const active = palette.locator('[role="option"][aria-selected="true"]')
    await expect(active).toHaveCount(1)
    const look = await active.evaluate(element => ({
      background: getComputedStyle(element).backgroundColor,
      outline: getComputedStyle(element).outlineStyle,
    }))
    expect(look.outline).toBe('none')
    expect(look.background).not.toBe('rgba(0, 0, 0, 0)')
    if (process.env.PROJECTIONS_SHOTS && testInfo.project.name === 'chromium-desktop') {
      await palette.screenshot({path: join(process.env.PROJECTIONS_SHOTS, `palette-${theme.toLowerCase()}.png`)})
    }
    await page.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)
  }
})

/** Opens or closes the docked Details panel (a sheet below 1012px), from its title-bar toggle (or More on a phone). */
async function details(page: Page, open = true) {
  const toggle = await titleToggle(page, /^(Show|Hide) details panel$/)
  if (((await toggle.getAttribute('aria-pressed')) === 'true') !== open) await toggle.click()
  await closeMore(page)
  if (open) await expect(page.getByRole('complementary', {name: 'Details'})).toBeVisible()
  else await expect(page.getByRole('complementary', {name: 'Details'})).toHaveCount(0)
}

for (const [theme, width] of [
  ['Light', 1440],
  ['Dark', 1440],
  ['Light', 390],
  ['Dark', 390],
] as const) {
  test(`screenshots of the workbench, the switcher and Details (${theme.toLowerCase()}, ${width}px)`, async ({page, app}, testInfo) => {
    test.skip(!process.env.PROJECTIONS_SHOTS || testInfo.project.name !== 'chromium-desktop', 'Screenshots on request')
    const shot = (name: string) =>
      page.screenshot({path: join(process.env.PROJECTIONS_SHOTS!, `${name}-${theme.toLowerCase()}-${width}.png`)})
    await page.setViewportSize({width, height: width > 1000 ? 900 : 844})
    await page.goto(app.url)
    await trust(page)
    await chooseTheme(page, theme)
    await page.getByRole('note', {name: 'Tip'}).getByRole('button', {name: 'Dismiss tip'}).click()
    await expect(page.locator('.ph[data-mode="comparison"]')).toBeVisible()
    await expect(page.locator('.ph[data-renderer-status="ready"]')).toBeVisible()
    await sidebar(page)
    await shot('workbench')
    if (drawer(page)) await sidebar(page, false)
    await page.locator('.pi-switcher').click()
    await expect(page.getByRole('listbox', {name: 'Projections'})).toBeVisible()
    await shot('switcher')
    await page.keyboard.press('Escape')
    await showAs(page, 'Table')
    await page.getByRole('button', {name: 'Inventory worker', exact: true}).click()
    await details(page)
    await expect(page.locator('.pi-details-dock .ph-details')).toContainText('worker')
    await shot('details')
    if (drawer(page)) return
    await page.locator('.pi-switcher').click()
    await expect(page.getByRole('listbox', {name: 'Projections'})).toBeVisible()
    await shot('switcher-details')
  })
}
