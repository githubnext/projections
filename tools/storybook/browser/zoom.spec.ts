import {test as base, expect} from '@playwright/test'
import type {Frame, Locator, Page} from '@playwright/test'
import type {Theme} from './smoke.spec.js'

const test = base.extend<{theme: Theme}>({theme: ['light', {option: true}]})

/**
 * Scalable renderers open fitted, with every entity within the stage, in animated mode and in both panes of side by
 * side, at desktop, tablet and phone widths, unless that draws their smallest text below the 8 px opening floor: then
 * they open at that floor; and they can always zoom out until everything fits again: after Fit to view and at the
 * least zoom (Zoom out until it stops changing).
 */
const stories = [
  {name: 'Infrastructure', id: 'default-ui-renderers--infrastructure'},
  {name: 'Dependencies', id: 'default-ui-renderers--dependencies'},
  {name: 'Database', id: 'default-ui-renderers--database'},
]
const sizes = [
  {width: 1440, height: 900},
  {width: 768, height: 1024},
  {width: 390, height: 844},
]
const modes = ['Animated', 'Side by side'] as const

/** A zoom action inline in the toolbar, or in More where the toolbar is narrow; menus are closed again after. */
async function zoomAction(page: Page, name: 'Zoom out' | 'Fit to view' | 'Zoom in') {
  const inline = page.locator('.ph-toolbar').getByRole('button', {name, exact: true}).first()
  if (await inline.isVisible()) await inline.click()
  else {
    const more = page.getByRole('dialog', {name: 'More'})
    if (!(await more.isVisible())) await page.getByRole('button', {name: 'More', exact: true}).first().click()
    await more.getByRole('button', {name, exact: true}).click()
  }
  for (let i = 0; i < 3 && (await page.getByRole('dialog').count()); i++) await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

/** Renderer frames on screen: one in animated mode, both panes in side by side. */
async function visibleFrames(page: Page): Promise<{frame: Frame; element: Locator}[]> {
  const frames = []
  const elements = page.locator('.ph iframe')
  for (let index = 0; index < (await elements.count()); index++) {
    const element = elements.nth(index)
    const box = await element.boundingBox()
    if (!box || box.width < 2 || box.height < 2 || !(await element.isVisible())) continue
    const frame = await (await element.elementHandle()).contentFrame()
    if (frame) frames.push({frame, element})
  }
  return frames
}

interface Reading {
  zoom: string | null
  scale: string | null
  entities: number
  outside: string[]
  /** The smallest drawn text in the stage, CSS px: SVG text by its screen transform, HTML by the transforms above it. */
  smallest: number
}

/**
 * Every entity's bounds against the stage: the scroll container's client area, within the frame's viewport. A graph
 * shows "Laying out the graph…" without a stage until its layout lands, which can be after the renderer is ready: wait
 * for the stage, and measure it in the same task that finds it (`waitForFunction` resolves only on a reading).
 */
const read = async (frame: Frame): Promise<Reading> =>
  (
    await frame.waitForFunction((): Reading | null => {
      const scroller = document.querySelector<HTMLElement>('[data-projections-scroll]')
      if (!scroller) return null
      const rect = scroller.getBoundingClientRect()
      const left = Math.max(0, rect.left + scroller.clientLeft),
        top = Math.max(0, rect.top + scroller.clientTop)
      const right = Math.min(innerWidth, rect.left + scroller.clientLeft + scroller.clientWidth)
      const bottom = Math.min(innerHeight, rect.top + scroller.clientTop + scroller.clientHeight)
      const entities = [...document.querySelectorAll('[data-entity-id]')].filter(element => {
        const box = element.getBoundingClientRect()
        return (box.width > 0 || box.height > 0) && getComputedStyle(element).visibility !== 'hidden'
      })
      const outside = entities
        .filter(element => {
          const box = element.getBoundingClientRect()
          return box.left < left - 1 || box.top < top - 1 || box.right > right + 1 || box.bottom > bottom + 1
        })
        .map(element => {
          const box = element.getBoundingClientRect()
          return `${element.getAttribute('data-entity-id')} [${[box.left, box.top, box.right, box.bottom].map(Math.round)}] in [${[left, top, right, bottom].map(Math.round)}]`
        })
      let smallest = Infinity
      const walker = document.createTreeWalker(scroller, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const element = node.parentElement
        if (!element || !node.textContent?.trim() || !element.getClientRects().length) continue
        let scale = 1
        if (element instanceof SVGGraphicsElement) {
          const matrix = element.getScreenCTM()
          if (!matrix) continue
          scale = Math.hypot(matrix.a, matrix.b)
        } else if (element instanceof HTMLElement && !element.closest('svg')) {
          if (element.offsetWidth <= 1 || element.offsetHeight <= 1) continue
          for (let above: Element | null = element; above; above = above.parentElement) {
            const transform = getComputedStyle(above).transform
            if (transform && transform !== 'none') {
              const matrix = new DOMMatrix(transform)
              scale *= Math.hypot(matrix.a, matrix.b)
            }
          }
        } else continue
        smallest = Math.min(smallest, parseFloat(getComputedStyle(element).fontSize) * scale)
      }
      return {
        smallest: Math.round(smallest * 100) / 100,
        zoom: scroller.getAttribute('data-zoom'),
        scale: document.querySelector('[data-scale]')?.getAttribute('data-scale') ?? null,
        entities: entities.length,
        outside,
      }
    })
  ).jsonValue() as Promise<Reading>

/** Readings of every shown frame once two consecutive ones agree (resizes and refits settle). */
async function settled(page: Page) {
  let previous = ''
  for (let attempt = 0; attempt < 30; attempt++) {
    const frames = await visibleFrames(page)
    const readings = await Promise.all(frames.map(({frame}) => read(frame)))
    const key = JSON.stringify(readings)
    if (readings.length && readings.every(reading => reading.entities > 0 && reading.scale !== '0') && key === previous) {
      return {frames, readings}
    }
    previous = key
    await page.waitForTimeout(250)
  }
  throw new Error(`renderer frames never settled: ${previous}`)
}

/** Every pane on the page and, unless `floored` lets a pane open at the 8 px text floor, showing every entity. */
async function expectAllInView(page: Page, label: string, panes: number, floored = false) {
  const {frames, readings} = await settled(page)
  expect(frames.length, `${label}: shown panes`).toBe(panes)
  const viewport = page.viewportSize()!
  for (const [index, {element}] of frames.entries()) {
    const box = (await element.boundingBox())!
    expect(box.x + box.width, `${label}: pane ${index} is on the page`).toBeLessThanOrEqual(viewport.width + 1)
    expect(box.y + box.height, `${label}: pane ${index} is on the page`).toBeLessThanOrEqual(viewport.height + 1)
    const reading = readings[index]!
    if (floored && reading.zoom !== '1') {
      expect(Number(reading.zoom), `${label}: pane ${index} never opens below the fit`).toBeGreaterThan(1)
      expect(reading.smallest, `${label}: pane ${index} opens at the 8 px text floor`).toBeCloseTo(8, 1)
    } else expect(reading.outside, `${label}: pane ${index} shows every entity`).toEqual([])
  }
  return readings
}

for (const story of stories) {
  for (const size of sizes) {
    for (const mode of modes) {
      test(`${story.name} at ${size.width}px, ${mode.toLowerCase()}: opens fitted or at the text floor, Fit and the least zoom show everything`, async ({
        page,
        theme,
      }, testInfo) => {
        test.skip(testInfo.project.name === 'chromium-dark', 'framing does not depend on the theme')
        test.setTimeout(90_000)
        await page.setViewportSize(size)
        await page.goto(
          new URL(
            `iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme}&args=initialMode:${mode === 'Animated' ? 'animated' : 'side-by-side'};changesOnly:!false`,
            process.env.PROJECTIONS_STORYBOOK_URL,
          ).href,
        )
        await expect(page.locator('.ph[data-renderer-status="ready"]').first()).toBeVisible({timeout: 30_000})
        // Every item (the Changes scope frames the changes); opened in the mode under test (renderers that offer diff open in it by default); the switch confirms it.
        await expect(page.locator('.ph').first()).toHaveAttribute('data-comparison-mode', mode === 'Animated' ? 'animated' : 'side-by-side')
        const panes = mode === 'Side by side' ? 2 : 1
        // Opens at the fit, everything in view, or at the 8 px text floor where the fit draws smaller text.
        await expectAllInView(page, 'on open', panes, true)
        // Zoomed in, then Fit to view.
        await zoomAction(page, 'Zoom in')
        await zoomAction(page, 'Zoom in')
        await expect.poll(async () => (await read((await visibleFrames(page))[0]!.frame)).zoom).not.toBe('1')
        await zoomAction(page, 'Fit to view')
        const fitted = await expectAllInView(page, 'after Fit to view', panes)
        for (const reading of fitted) expect(reading.zoom).toBe('1')
        // Zoomed in, then out until it stops changing: the least zoom is the fit.
        await zoomAction(page, 'Zoom in')
        let previous = ''
        for (let presses = 0; presses < 12; presses++) {
          await zoomAction(page, 'Zoom out')
          const {readings} = await settled(page)
          const key = JSON.stringify(readings.map(reading => reading.scale))
          if (key === previous) break
          previous = key
        }
        const least = await expectAllInView(page, 'at the least zoom', panes)
        expect(least.map(reading => reading.scale)).toEqual(fitted.map(reading => reading.scale))
      })
    }
  }
}
