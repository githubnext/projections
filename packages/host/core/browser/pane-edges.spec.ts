import {test, expect, type Page} from '@playwright/test'
import {explorer} from './harness.js'

/**
 * Side by side (left and right, and stacked) and swipe lie flat, like the single frame (docs/guides/host-ui.md): each
 * pane, its label band above its frame, has no edge or corners of its own, and band and frame span the pane alike, so
 * neither draws a side the other lacks. Left and right panes meet at one divider hairline, not a gutter: the after
 * pane's left border. Stacked, they meet at the after pane's top border, full width, with no row gap or left gutter.
 */
async function panes(page: Page) {
  return page.locator('[data-pane-card]').evaluateAll(sections =>
    sections.map(section => {
      const box = (element: Element | null) => {
        const rect = element!.getBoundingClientRect()
        return {left: rect.left, right: rect.right}
      }
      const style = getComputedStyle(section)
      const probe = section.appendChild(document.createElement('span'))
      probe.style.color = 'var(--projections-color-divider)'
      const divider = getComputedStyle(probe).color
      probe.remove()
      const stage = (section.closest('.ph-panes') ?? section.parentElement!).getBoundingClientRect()
      return {
        divider,
        ruleColor: style.borderLeftColor,
        topColor: style.borderTopColor,
        stageLeft: stage.left,
        top: section.getBoundingClientRect().top,
        bottom: section.getBoundingClientRect().bottom,
        side: section.getAttribute('data-side'),
        borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].join(' '),
        radius: style.borderTopLeftRadius,
        pane: {...box(section), inner: section.getBoundingClientRect().left + parseFloat(style.borderLeftWidth)},
        band: box(section.querySelector('[data-pane-band]')),
        frame: box(section.querySelector('iframe.ph-frame')),
      }
    }),
  )
}

const cases = [
  {mode: 'side-by-side', width: 1440, arrangement: 'left and right'},
  {mode: 'side-by-side', width: 390, arrangement: 'stacked'},
  {mode: 'swipe', width: 1440, arrangement: 'swipe'},
  {mode: 'swipe', width: 390, arrangement: 'swipe'},
] as const

for (const {mode, width, arrangement} of cases) {
  test(`${mode} at ${width}px (${arrangement}): each pane lies flat, its band and frame spanning it alike, and left and right panes meet at a hairline`, async ({
    page,
  }) => {
    await page.setViewportSize({width, height: 1000})
    await page.goto(explorer(`before=v1&after=v3&mode=${mode}`))
    const view = page.locator('.ph')
    await expect(view).toHaveAttribute('data-comparison-mode', mode)
    await expect(view).toHaveAttribute('data-renderer-status', 'ready')
    if (arrangement === 'stacked') await expect(page.locator('.ph-panes')).toHaveAttribute('data-stacked', 'true')
    const found = await panes(page)
    expect(found).toHaveLength(2)
    const columns = arrangement === 'left and right'
    const stacked = arrangement === 'stacked'
    for (const {side, borders, radius, pane, band, frame, divider, ruleColor, topColor, stageLeft} of found) {
      const label = `${side} pane`
      const after = side === 'after'
      expect(borders, label).toBe(columns && after ? '0px 0px 0px 1px' : stacked && after ? '1px 0px 0px 0px' : '0px 0px 0px 0px')
      if (columns && after) expect(ruleColor, `${label}: the rule between the panes`).toBe(divider)
      if (stacked && after) expect(topColor, `${label}: the rule between the panes`).toBe(divider)
      if (stacked) expect(Math.abs(pane.left - stageLeft), `${label}: no gutter at its left`).toBeLessThanOrEqual(0.5)
      expect(radius, label).toBe('0px')
      for (const [name, part] of Object.entries({band, frame})) {
        expect(Math.abs(part.left - pane.inner), `${label}: ${name} left`).toBeLessThanOrEqual(0.5)
        expect(Math.abs(part.right - pane.right), `${label}: ${name} right`).toBeLessThanOrEqual(0.5)
      }
    }
    // Left and right, the panes meet: no gutter between them.
    if (columns) expect(Math.abs(found[1]!.pane.left - found[0]!.pane.right), 'gutter').toBeLessThanOrEqual(0.5)
    // Stacked, the upper pane reaches the rule: no gap between them.
    if (stacked) expect(Math.abs(found[1]!.top - found[0]!.bottom), 'row gap').toBeLessThanOrEqual(0.5)
  })
}

/**
 * Where the after frame and its drawing lie against the stage's floating foot (`StageFoot`, a `data-stage-cover`),
 * in the host page's CSS px: the frame, the foot, and in the frame the graph's box (with its padding), the padding
 * below the cards and the `stage-inset-bottom` the frame was sent.
 */
async function footClearance(page: Page) {
  const frame = page.locator('[data-side="after"] iframe.ph-frame')
  const [host, inner] = await Promise.all([
    frame.evaluate(element => {
      const foot = element.closest('.ph-stage-body')!.querySelector('.ph-stage-foot')!.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      return {frameTop: box.top, height: box.height, foot: foot.top}
    }),
    frame
      .contentFrame()
      .locator('svg.graph')
      .evaluate(graph => {
        const box = graph.getBoundingClientRect()
        return {
          view: document.documentElement.clientHeight,
          top: box.top,
          bottom: box.bottom,
          padding: parseFloat(getComputedStyle(graph).paddingBottom),
          inset: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--projections-stage-inset-bottom')),
        }
      }),
  ])
  return {...host, ...inner}
}

test('swipe at 1440px, content-sized: the after frame grows by its foot, and its drawing ends clear of it', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 1000})
  await page.goto(explorer('before=v1&after=v3&mode=swipe&fill=false'))
  const view = page.locator('.ph')
  await expect(view).toHaveAttribute('data-renderer-status', 'ready', {timeout: 30_000})
  await expect(page.locator('.ph-stage-foot')).toBeVisible()
  const settled = async () => {
    const at = await footClearance(page)
    expect(at.inset, 'the frame is sent the foot as its stage-inset-bottom').toBeGreaterThan(0)
    // The frame is as tall as its drawing asks: the drawing, padded, spans it exactly, neither clipped nor left short.
    expect(Math.abs(at.view - at.height), 'the frame has the height it was given').toBeLessThanOrEqual(1)
    expect(Math.abs(at.top), 'the drawing starts at the frame top').toBeLessThanOrEqual(1)
    expect(Math.abs(at.bottom - at.view), 'the drawing ends at the frame bottom').toBeLessThanOrEqual(1)
    expect(at.padding, 'the drawing is padded clear of the foot').toBeGreaterThanOrEqual(at.inset)
    expect(at.frameTop + at.bottom - at.padding, 'the cards end above the foot').toBeLessThanOrEqual(at.foot)
    return at
  }
  await expect(settled).toPass()
  // Still so once the host's height loop guard (`HeightRequests`, 1s) has nothing recent to hold on to.
  const first = await settled()
  await page.waitForTimeout(1200)
  expect(await settled()).toEqual(first)
})
