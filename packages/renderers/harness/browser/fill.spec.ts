import {expect, test} from '@playwright/test'
import {openStage} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

/**
 * Spatial renderers use a tall frame: a host that sizes the frame itself
 * (filling its container) gets the canvas stretched to the frame's full height,
 * the content centred in it and fitted (all of it in view), never magnified, and captions at the
 * bottom, with nothing of the renderer's own above the canvas. The frame
 * fills a box taller than any content here, as such a host's does. Zoomable content
 * opens fitted unless that would draw its smallest text (SVG or HTML) below
 * the 8 px opening floor: then it opens at that floor, at the top, and scrolls.
 * The smallest text is reported.
 */
const cases = [
  {key: 'graph/service-platform', content: 'svg.graph', stage: '.graph-scroll', fit: true},
  {key: 'graph/file-reflow-horizontal', content: 'svg.graph', stage: '.graph-scroll', fit: true},
  {key: 'graph/ci-pipeline', content: 'svg.graph', stage: '.graph-scroll', fit: true},
  {key: 'graph/platform-worker', content: 'svg.graph', stage: '.graph-scroll', fit: true},
  {key: 'dependency-injection/orders', content: 'svg.di-canvas', stage: '.di-scroll', fit: true},
  {key: 'file-packing/sample-app', content: 'svg.fp-packing', stage: '.fp-stage', fit: false},
  {key: 'database/organizations', content: '.database-content', stage: '.database-view', fit: true},
]

for (const {key, content, stage: stageSelector, fit} of cases) {
  test(`${key}: the canvas fills a tall frame and its content uses the space`, async ({page}, testInfo) => {
    const mobile = testInfo.project.name.includes('mobile')
    const inspector = harnessInspector()
    const height = mobile ? 640 : 860
    // The host sizes the frame itself: it fills a box of `height` (and tells the renderer so).
    const stage = await openStage(page, inspector, {scenario: key, progress: 0, height})
    const measure = () =>
      stage.frame.locator('.pk').evaluate(
        (root, [contentSelector, stageSelector]) => {
          const box = (element: Element | null) => {
            const rect = element!.getBoundingClientRect()
            return {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height}
          }
          const area = root.querySelector(stageSelector)!
          const footer = root.querySelector('.graph-footer, .di-legend')
          const scale = Number(root.querySelector(contentSelector)!.getAttribute('data-scale') ?? NaN)
          // The smallest drawn text in the scaled content, SVG or HTML: its font size times the scale it is drawn at
          // (an SVG's screen transform, or the CSS transforms above it). Visually hidden text (a 1 px box) doesn't count.
          let smallestText = Infinity
          const walker = document.createTreeWalker(root.querySelector(contentSelector)!, NodeFilter.SHOW_TEXT)
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const element = node.parentElement
            if (!element || !node.textContent?.trim() || !element.getClientRects().length) continue
            let scale = 1
            if (element instanceof SVGTextContentElement) {
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
            smallestText = Math.min(smallestText, parseFloat(getComputedStyle(element).fontSize) * scale)
          }
          return {
            smallestText,
            zoom: Number(area.getAttribute('data-zoom') ?? 1),
            frame: innerHeight,
            root: box(root),
            stage: box(area),
            content: box(root.querySelector(contentSelector)),
            footer: footer ? box(footer) : null,
            scale,
            overflows: area.scrollHeight > area.clientHeight + 1 || area.scrollWidth > area.clientWidth + 1,
          }
        },
        [content, stageSelector] as const,
      )
    await expect.poll(async () => (await measure()).frame).toBe(height)
    // Resizes settle before measuring: two readings 250ms apart agree.
    let m = await measure()
    for (let attempt = 0; attempt < 20; attempt++) {
      await page.waitForTimeout(250)
      const next = await measure()
      if (JSON.stringify(next) === JSON.stringify(m)) break
      m = next
    }
    expect(m.root.height, 'the renderer takes the frame height').toBeGreaterThanOrEqual(height - 1)
    expect(m.stage.height, 'the canvas takes most of the frame').toBeGreaterThan(height * 0.7)
    // No renderer header above the canvas: the host owns title, schema and counts.
    expect(m.stage.top - m.root.top, 'the canvas starts at the top of the frame').toBeLessThanOrEqual(8)
    if (m.footer) expect(Math.abs(m.footer.bottom - height), 'captions sit at the bottom of the frame').toBeLessThan(2)
    if (fit && m.zoom === 1) expect(m.overflows, 'fitted content never scrolls').toBe(false)
    else if (fit) {
      // Fitted, the text would be smaller than the floor: it opens where the smallest text is 8 px, at the top.
      expect(m.zoom, 'opens zoomed in, never below the fit').toBeGreaterThan(1)
      expect(m.smallestText, 'opens at the 8 px text floor').toBeCloseTo(8, 1)
      expect(m.overflows, 'content at the floor scrolls').toBe(true)
      expect(m.content.top - m.stage.top, 'opens at the top of the content').toBeGreaterThanOrEqual(-1)
    }
    // How small the text is drawn is information.
    if (Number.isFinite(m.smallestText)) {
      testInfo.annotations.push({type: 'smallest text', description: `${m.smallestText.toFixed(1)}px at scale ${m.scale.toFixed(3)}`})
    }
    if (!m.overflows) {
      // Centred both ways, with no more than the padding between it and the stage on the fitted axis.
      expect(Math.abs((m.content.left + m.content.right) / 2 - (m.stage.left + m.stage.right) / 2)).toBeLessThan(2)
      expect(Math.abs((m.content.top + m.content.bottom) / 2 - (m.stage.top + m.stage.bottom) / 2)).toBeLessThan(2)
      const share = Math.max(m.content.width / m.stage.width, m.content.height / m.stage.height)
      if (fit) {
        expect(m.scale, 'fitted, never magnified').toBeLessThanOrEqual(1.0001)
        if (m.scale < 0.999) expect(share, 'a scaled-down graph fills one dimension').toBeGreaterThan(0.9)
      } else expect(share, 'the content spans the stage').toBeGreaterThan(0.9)
    }
    // Framing never changes while scrubbing.
    const viewBox = () => stage.frame.locator(content).getAttribute('viewBox')
    const sizes: string[] = []
    for (const progress of [0, 0.3, 0.5, 0.7, 1]) {
      await stage.seek(progress)
      const {content: box} = await measure()
      sizes.push(`${await viewBox()} ${box.width.toFixed(1)}x${box.height.toFixed(1)}`)
    }
    expect(new Set(sizes).size, `framing is constant: ${sizes.join(' | ')}`).toBe(1)
  })
}

test('graph zoom enlarges the opening view and Fit shows everything', async ({page}) => {
  const stage = await openStage(page, harnessInspector(), {scenario: 'graph/service-platform', progress: 1, height: 700})
  const scale = async () => Number(await stage.frame.locator('svg.graph').getAttribute('data-scale'))
  const zoom = async () => Number(await stage.frame.locator('.graph-scroll').getAttribute('data-zoom'))
  // The opening view is fitted to the taller frame: wait for the resize to reach the frame and settle.
  await expect.poll(() => stage.frame.locator('.pk').evaluate(() => innerHeight)).toBe(700)
  await expect.poll(scale).toBeGreaterThan(0)
  let reading = `${await scale()} ${await zoom()}`
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(250)
    const next = `${await scale()} ${await zoom()}`
    if (next === reading) break
    reading = next
  }
  const opening = await scale()
  const fitted = opening / (await zoom())
  // The dot grid scrolls with the graph (`local`), is spaced by its scale, and keeps a dot on the drawing's origin.
  const grid = () =>
    stage.frame.locator('.graph-scroll').evaluate(scroller => {
      const svg = scroller.querySelector('svg.graph')!
      const box = scroller.getBoundingClientRect()
      const drawn = svg.getBoundingClientRect()
      const origin = drawn.left - box.left - scroller.clientLeft + scroller.scrollLeft + parseFloat(getComputedStyle(svg).paddingLeft)
      const read = (name: string) => parseFloat(scroller.style.getPropertyValue(name))
      const spacing = read('--pk-grid-spacing')
      const off = (((origin - read('--pk-grid-x') - spacing / 2) % spacing) + spacing) % spacing
      return {attachment: getComputedStyle(scroller).backgroundAttachment, spacing, off: Math.min(off, spacing - off)}
    })
  const opened = await grid()
  expect(opened.attachment).toBe('local')
  expect(opened.spacing).toBeCloseTo(16 * opening, 2)
  expect(opened.off).toBeLessThan(0.5)
  await stage.action('zoom-in')
  await expect.poll(scale).toBeCloseTo(opening * 1.5, 5)
  await expect.poll(async () => (await grid()).spacing).toBeCloseTo(16 * opening * 1.5, 2)
  expect((await grid()).off).toBeLessThan(0.5)
  await stage.action('zoom-fit')
  await expect.poll(scale).toBeCloseTo(fitted, 5)
  await expect.poll(zoom).toBe(1)
})
