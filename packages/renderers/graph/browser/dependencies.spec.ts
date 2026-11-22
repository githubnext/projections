import {readFileSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import {openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import type {Extraction} from '@githubnext/projections-schemas'
import {paneStatusSuite} from '../../kit/browser/status.js'

const fixture = (name: string): Extraction =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8')) as Extraction
const before = fixture('npm-workspace-v1')
const after = fixture('npm-workspace-v2')

paneStatusSuite({name: 'npm workspace', renderer: 'dependencies', before, after})

test('dependency graphs lay out left to right, roots first, with transitive packages summarized', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'dependencies', extraction: after})
  const frame = renderer.frame
  await expect(frame.locator('svg.graph')).toHaveAttribute('data-orientation', 'horizontal')
  // Workspace members and their direct dependencies are cards; nothing deeper is, until expanded.
  await expect(frame.locator('[data-entity-id="workspace:@shop/api"]')).toBeVisible()
  await expect(frame.locator('[data-entity-id="package:express"]')).toBeVisible()
  await expect(frame.locator('[data-entity-id="package:body-parser"]')).toHaveCount(0)
  const summary = frame.locator('[data-graph-synthetic="transitive:package:express"]')
  await expect(summary).toContainText(/\d+ more packages/u)
  await expect(summary).toHaveAttribute('aria-label', /^Show \d+ transitive packages of express$/u)
  // Summaries stand for no entity, so hosts never see their IDs.
  await expect(frame.locator('[data-entity-id^="transitive"]')).toHaveCount(0)
  expect((await renderer.state()).steps).toEqual([])
  await expect(frame.locator('.node-emphasis, .pk-svg-status')).toHaveCount(0)
  // The summary is prose; package names and versions are identifiers.
  expect(await summary.locator('.node-label').evaluate(element => getComputedStyle(element).fontFamily)).not.toMatch(/mono/iu)
  expect(
    await frame
      .locator('[data-entity-id="package:express"] .node-detail')
      .evaluate(element => element.textContent + getComputedStyle(element).fontFamily),
  ).toMatch(/^5\.1\.0.*mono/iu)
  // Selecting a summary expands it in place and reports no selection to the host.
  await summary.click()
  await expect(frame.locator('[data-entity-id="package:body-parser"]')).toBeVisible()
  expect((await renderer.state()).selection ?? null).toBeNull()
})

test('an expanded package collapses again from the card in its summary’s place, by pointer or keyboard', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'dependencies', extraction: after})
  const frame = renderer.frame
  const card = frame.locator('[data-graph-synthetic="transitive:package:express"]')
  const count = Number(/\d+/u.exec((await card.locator('.node-label').textContent())!)![0])
  await expect(card).toHaveAttribute('aria-label', `Show ${count} transitive packages of express`)
  await expect(card).toHaveAttribute('aria-expanded', 'false')
  await card.focus()
  await page.keyboard.press('Enter')
  // The same card, still focused, now closes the group it opened.
  await expect(frame.locator('[data-entity-id="package:body-parser"]')).toBeVisible()
  await expect(card).toContainText(`Collapse ${count} packages`)
  await expect(card).toHaveAttribute('aria-label', `Collapse ${count} transitive packages of express`)
  await expect(card).toHaveAttribute('aria-expanded', 'true')
  await expect(card).toBeFocused()
  expect(await card.locator('.node-label').evaluate(element => getComputedStyle(element).fontFamily)).not.toMatch(/mono/iu)
  // A package the collapse hides is no longer selected.
  await renderer.select('package:body-parser')
  await card.focus()
  await page.keyboard.press(' ')
  await expect(frame.locator('[data-entity-id="package:body-parser"]')).toHaveCount(0)
  await expect(card).toContainText(`${count} more packages`)
  await expect(card).toBeFocused()
  await expect.poll(async () => (await renderer.state()).selection ?? null).toBeNull()
  // And it opens again.
  await card.click()
  await expect(frame.locator('[data-entity-id="package:body-parser"]')).toBeVisible()
  // Every package shown leaves nothing to collapse.
  await renderer.setOptions({transitive: true})
  await expect(frame.locator('[data-graph-synthetic]')).toHaveCount(0)
})

test('the "All packages" control shows every transitive package', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'dependencies', extraction: after})
  const state = await renderer.state()
  expect(state.controls.map(control => control.id)).toEqual(['zoom-out', 'zoom-fit', 'zoom-in', 'transitive', 'paths'])
  await renderer.setOptions({transitive: true})
  await expect(renderer.frame.locator('svg.graph .graph-node[data-entity-id]')).toHaveCount(after.entities.length)
  await expect(renderer.frame.locator('[data-graph-synthetic]')).toHaveCount(0)
})

test('every change is shown with the path that pulls it in, and version bumps read as upgrades', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'dependencies', before, after, progress: 0})
  const frame = renderer.frame
  // body-parser is transitive but changed: it and express, which pulls it in, are cards.
  for (const id of ['package:express', 'package:body-parser', 'package:lodash', 'package:react']) {
    await expect(frame.locator(`[data-entity-id="${id}"]`)).toHaveCount(1)
  }
  await renderer.seek(1)
  await expect(frame.locator('[data-entity-id="package:zod"]')).toHaveCount(1)
  await expect(frame.locator('[data-entity-id="package:lodash"]')).toHaveCount(0)
  // Endpoints are neutral: no emphasis or status at either end.
  for (const progress of [0, 1]) {
    await renderer.seek(progress)
    await expect(frame.locator('.node-emphasis, .pk-svg-status')).toHaveCount(0)
  }
  const {steps} = await renderer.state()
  let upgraded = false
  for (const end of steps) {
    await renderer.seek(end, {highlighting: 1})
    const status = frame.locator('[data-entity-id="package:express"] .pk-svg-status')
    const text = (await status.allTextContents()).join(' ')
    if (text.includes('Upgraded') && (await status.locator('[data-icon="upgraded"]').count())) upgraded = true
  }
  expect(upgraded, 'express states its upgrade as icon and word').toBe(true)
  await expect(frame.locator('[data-entity-id="package:express"]')).toHaveAttribute('aria-label', /Modified, Upgraded/u)
})

test('a shared package keeps the edge that pulls it in and counts its other dependents; selecting it brings them forward', async ({
  page,
}) => {
  const renderer = await openRenderer(page, {renderer: 'dependencies', before, after, comparisonMode: 'diff'})
  const frame = renderer.frame
  const edgesInto = (id: string) => frame.locator(`.graph-link[data-to="${id}"]`).count()
  // debug is pulled in by express first, and also used by body-parser, send and finalhandler: one edge, and a count.
  const debug = frame.locator('[data-entity-id="package:debug"]')
  await expect(debug.locator('.node-kind')).toContainText(/\+\d+ dependents?/u)
  const primary = await edgesInto('package:debug')
  // Every dependency draws them all again.
  await renderer.setOptions({paths: true})
  await expect(debug.locator('.node-kind')).not.toContainText('dependent')
  await expect.poll(() => edgesInto('package:debug')).toBeGreaterThan(primary)
  await renderer.setOptions({paths: false})
  await expect.poll(() => edgesInto('package:debug')).toBe(primary)
  // Selected, its dependents and dependencies come forward, drawn edge or not; everything else recedes.
  await renderer.select('package:debug')
  await expect(frame.locator('[data-entity-id="package:debug"]')).not.toHaveClass(/receded/u)
  await expect(frame.locator('[data-entity-id="package:body-parser"]')).not.toHaveClass(/receded/u)
  await expect(frame.locator('[data-entity-id="package:react"]')).toHaveClass(/receded/u)
  await expect(
    frame
      .locator('.graph-footer, [role="status"]')
      .filter({hasText: /packages? depends? on debug/u})
      .first(),
  ).toBeAttached()
})

test('the first paint the renderer acknowledges is drawn at its final fit', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'Timing of the first acknowledgement, once.')
  // A member with a column of dependencies, taller than the stage measures before the renderer fills its frame:
  // a fit from then must never be acknowledged.
  const members = ['auth', 'billing', 'core', 'db', 'flags', 'mail', 'tokens'].map(name => `workspace:@acme/${name}`)
  const package_ = (id: string) => ({
    id,
    kind: 'package',
    label: id.slice('workspace:'.length),
    data: {version: '1.0.0', workspaceMember: true},
  })
  const graph = (names: string[]): Extraction => ({
    protocolVersion: 0,
    schema: 'graph/v0',
    entities: [package_('workspace:@acme/api'), ...names.map(package_)],
    relationships: names.map(to => ({id: `dependency:${to}`, kind: 'dependencies', from: 'workspace:@acme/api', to, label: 'workspace:*'})),
  })
  for (let run = 0; run < 5; run++) {
    await openRenderer(page, {renderer: 'dependencies', before: graph(members.slice(0, 5)), after: graph(members), progress: 0})
    // Read in the renderer document at once: a locator's round trips would give a late refit time to land.
    const document = page.frames().find(frame => frame !== page.mainFrame())!
    const scale = () => document.evaluate(() => window.document.querySelector('svg.graph')?.getAttribute('data-scale'))
    const acknowledged = await scale()
    await page.waitForTimeout(300)
    expect(await scale(), `run ${run}`).toBe(acknowledged)
  }
})

test('a fitted graph centred in its canvas still starts at the top of the frame', async ({page}) => {
  // A chain is wide and short: fitted to the width, it is centred down the canvas, below the frame's top.
  const names = ['api', 'auth', 'billing', 'core', 'db', 'flags', 'mail'].map(name => `workspace:@acme/${name}`)
  const extraction: Extraction = {
    protocolVersion: 0,
    schema: 'graph/v0',
    entities: names.map(id => ({
      id,
      kind: 'package',
      label: id.slice('workspace:'.length),
      data: {version: '1.0.0', workspaceMember: true},
    })),
    relationships: names
      .slice(1)
      .map((to, index) => ({id: `dependency:${to}`, kind: 'dependencies', from: names[index]!, to, label: 'workspace:*'})),
  }
  const renderer = await openRenderer(page, {renderer: 'dependencies', extraction, height: 650})
  await renderer.measure('settle')
  const graph = await renderer.frame.locator('svg.graph').boundingBox()
  expect(graph!.y, 'the drawing is centred below the top').toBeGreaterThan(8)
  expect((await renderer.measure<{top: number; element: string}>('contentTop')).top).toBeLessThanOrEqual(8)
})
