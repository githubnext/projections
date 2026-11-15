import {test, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {story} from './harness.js'

/**
 * The view's chrome lies flat, edge to edge, in every host (docs/guides/host-ui.md): the toolbar and the summary bar
 * are bands of the header surface, each ruled off from the stage by one divider hairline, and the stage has no edge
 * or corners. A one-revision view's toolbar keeps the same full band, its end group drawing no bar of its own.
 */
async function chrome(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('.ph')!
    const tokens = getComputedStyle(root)
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
        shadow: style.boxShadow,
      }
    }
    // The tokens as the browser paints them.
    const probe = document.createElement('div')
    root.append(probe)
    probe.style.backgroundColor = tokens.getPropertyValue('--pj-surface-header')
    probe.style.borderTopColor = tokens.getPropertyValue('--pj-divider')
    const paint = {header: getComputedStyle(probe).backgroundColor, divider: getComputedStyle(probe).borderTopColor}
    probe.remove()
    return {
      paint,
      view: read('.ph'),
      toolbar: read('.ph-toolbar'),
      end: read('[data-toolbar-region="end"]'),
      stage: read('.ph-stage'),
      summary: read('.ph-summary-bar'),
    }
  })
}

for (const [name, id] of [
  ['a one-revision view', 'default-ui-projection-view--extraction'],
  ['a comparison', 'default-ui-projection-view--comparison'],
] as const)
  test(`${name}: the toolbar, stage and summary bar lie flat, edge to edge`, async ({page}) => {
    await page.goto(story(id))
    await expect(page.locator('.ph')).toHaveAttribute('data-renderer-status', 'ready')
    const {paint, view, toolbar, end, stage, summary} = await chrome(page)
    for (const [part, edges] of Object.entries({toolbar, stage, summary})) {
      expect(edges.left, `${part} left`).toBeCloseTo(view.left, 0)
      expect(edges.right, `${part} right`).toBeCloseTo(view.right, 0)
      expect(edges.radius, `${part} corners`).toBe('0px')
    }
    expect(toolbar.top).toBeCloseTo(view.top, 0)
    expect(toolbar.borders).toBe('0px 0px 1px 0px')
    expect(toolbar.background).toBe(paint.header)
    expect(toolbar.borderColor).toBe(paint.divider)
    expect(toolbar.shadow).toBe('none')
    expect(end.borders).toBe('0px 0px 0px 0px')
    expect(end.background).toBe('rgba(0, 0, 0, 0)')
    expect(stage.top).toBeGreaterThanOrEqual(toolbar.bottom - 0.5)
    expect(summary.borders).toBe('1px 0px 0px 0px')
    expect(summary.background).toBe(paint.header)
    expect(summary.borderColor).toBe(paint.divider)
    expect(summary.bottom).toBeCloseTo(view.bottom, 0)
    const single = page.locator('.ph-single')
    if (await single.count()) {
      await expect(single).toHaveCSS('border-top-width', '0px')
      await expect(single).toHaveCSS('border-top-left-radius', '0px')
    }
  })
