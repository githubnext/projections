import {test, expect, type Locator, type Page} from '@playwright/test'
import {explorer} from './harness.js'

/**
 * The toolbar's edge controls sit as far from its ends as from its top and bottom (docs/guides/host-ui.md): inside its border,
 * its 4px padding is the space around every 32px control, the leading pickers or mode switch and the trailing action
 * alike, on its first row and on the playback row (whose lens leads it with no padding before it). Measured on border
 * boxes, in every mode and as the toolbar collapses: the rule the VS Code UI's toolbar holds to, with its
 * measuring helper (packages/host/vscode-ui/browser/cap.ts). The playback row's slider ends inset, so its thumb never
 * touches the border, and is not an edge control.
 */
const regions = '.ph-toolbar-row, [data-toolbar-region], .ph-actions, .ph-pair, .ph-toolbar-end > div:not([aria-label])'
const measure = (page: Page) => toolbarInsets(page.locator('.ph-toolbar').first(), {wrappers: regions, rows: '.ph-toolbar-row'})

test.skip(({isMobile}) => isMobile, 'The test sizes the viewport itself; the desktop projects cover Chromium and WebKit.')

for (const width of [1280, 600, 400, 320]) {
  for (const mode of ['side-by-side', 'animated', 'diff'] as const) {
    test(`at ${width}px, ${mode}: the toolbar insets its edge controls as far from its ends as from its top and bottom`, async ({page}) => {
      await page.setViewportSize({width, height: 700})
      await page.goto(explorer(`mode=${mode}`))
      await page.locator('.ph[data-renderer-status="ready"]').first().waitFor()
      await page.waitForTimeout(500)
      expectEdgeInsets(await measure(page), `at ${width}px, ${mode}`)
    })
  }
}

/**
 * An edge control's insets from the toolbar row around it: `side` is its left inset at the row's start, its right inset
 * at the row's end. A slider's end is its track's, not a control's edge (`slider`).
 */
export interface EdgeInsets {
  what: string
  side: number
  top: number
  bottom: number
  slider?: boolean
}
export interface RowInsets {
  lead: EdgeInsets
  trail: EdgeInsets
}

/**
 * The toolbar's edge insets, from getBoundingClientRect border boxes, per row: the leading control's left inset and the
 * trailing control's right inset, each with its top and bottom insets. Rows are measured inside the toolbar's own
 * border (a bottom hairline is its edge, as in the summary bar). A planned second row (`secondRow`, a grid item under
 * its own top hairline) is measured inside that hairline, and the first row above it; row containers (`rows`) each
 * reach across the gap between them to the next. Controls are the outermost interactive, bordered or filled elements (and
 * text runs), not the layout regions (`wrappers`) holding them; a text run's or slider's top and bottom are the row's
 * tallest control's, since text is centred by its cap height instead.
 */
export function toolbarInsets(toolbar: Locator, options: {wrappers: string; secondRow?: string; rows?: string}) {
  return toolbar.evaluate((element, {wrappers, secondRow, rows}) => {
    const style = getComputedStyle(element)
    const border = (side: string) => parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0
    const box = element.getBoundingClientRect()
    const inner = {
      left: box.left + border('left'),
      right: box.right - border('right'),
      top: box.top + border('top'),
      bottom: box.bottom - border('bottom'),
    }
    type Band = typeof inner
    const interactive =
      'button, a[href], input, select, textarea, [role="button"], [role="radiogroup"], [role="radio"], [role="combobox"], [role="checkbox"], [role="switch"], [role="slider"], [role="menuitem"], [tabindex]'
    const drawn = (node: Element) => {
      const own = getComputedStyle(node)
      const filled = !/^(?:transparent|rgba\(0, 0, 0, 0\))$/u.test(own.backgroundColor)
      const bordered = ['top', 'right', 'bottom', 'left'].some(
        side => parseFloat(own.getPropertyValue(`border-${side}-width`)) > 0 && own.getPropertyValue(`border-${side}-style`) !== 'none',
      )
      return filled || bordered
    }
    const text = (node: Element) => [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && !!child.textContent?.trim())
    interface Control {
      what: string
      rect: DOMRect
      text: boolean
      slider: boolean
    }
    const controls = (root: Element, skip: Element | null): Control[] => {
      const found: Control[] = []
      const visit = (node: Element) => {
        for (const child of node.children) {
          if (child === skip || getComputedStyle(child).visibility === 'hidden') continue
          const rect = child.getBoundingClientRect()
          const control =
            !child.matches(wrappers) && (child.matches(interactive) || child.tagName.includes('-') || drawn(child) || text(child))
          if (control && rect.width >= 2 && rect.height >= 2) {
            const slider = child.matches('input[type="range"], [role="slider"]')
            found.push({
              what: `${child.tagName.toLowerCase()}.${[...child.classList].filter(name => !name.includes(':')).join('.')}`,
              rect,
              text: slider || (!child.matches(interactive) && !child.tagName.includes('-') && !drawn(child)),
              slider,
            })
          } else if (!control) visit(child)
        }
      }
      visit(root)
      return found
    }
    const row = (found: Control[], band: Band) => {
      const lead = found.reduce((a, b) => (b.rect.left < a.rect.left ? b : a))
      const trail = found.reduce((a, b) => (b.rect.right > a.rect.right ? b : a))
      const tallest = found.filter(control => !control.text).reduce((a, b) => (b.rect.height > a.rect.height ? b : a), found[0]!)
      const vertical = (control: Control) => {
        const rect = control.text ? tallest.rect : control.rect
        return {
          top: rect.top - band.top,
          bottom: band.bottom - rect.bottom,
          ...(control.slider ? {slider: true} : {}),
        }
      }
      return {
        lead: {
          what: lead.what,
          side: lead.rect.left - band.left,
          ...vertical(lead),
        },
        trail: {
          what: trail.what,
          side: band.right - trail.rect.right,
          ...vertical(trail),
        },
      }
    }
    if (rows) {
      const lines = [...element.querySelectorAll(`:scope > ${rows}`)].filter(line => line.getBoundingClientRect().height > 0)
      const boxes = lines.map(line => line.getBoundingClientRect())
      const result: Record<string, RowInsets> = {}
      lines.forEach((line, index) => {
        const top = index === 0 ? inner.top : boxes[index - 1]!.bottom
        const bottom = index === lines.length - 1 ? inner.bottom : boxes[index + 1]!.top
        result[index === 0 ? 'main' : 'playback'] = row(controls(line, null), {
          ...inner,
          top,
          bottom,
        })
      })
      return result as {main: RowInsets; playback?: RowInsets}
    }
    const second =
      secondRow && element.getAttribute('data-rows') === '2' ? element.querySelector<HTMLElement>(`:scope > ${secondRow}`) : null
    const main = row(controls(element, second), {
      ...inner,
      bottom: second ? second.getBoundingClientRect().top : inner.bottom,
    })
    if (!second) return {main}
    const top = second.getBoundingClientRect().top + (parseFloat(getComputedStyle(second).borderTopWidth) || 0)
    return {main, playback: row(controls(second, null), {...inner, top})}
  }, options)
}

/** Each edge control's side inset equals its top and bottom insets, within half a pixel (a slider's end is not checked). */
export function expectEdgeInsets(insets: {main: RowInsets; playback?: RowInsets}, what: string) {
  test.info().annotations.push({
    type: 'insets',
    description: `${what} ${JSON.stringify(insets)}`,
  })
  for (const [name, row] of Object.entries(insets)) {
    for (const edge of [row.lead, row.trail]) {
      if (edge.slider) continue
      const measured = `${what}, ${name} row, ${edge === row.lead ? 'leading' : 'trailing'} ${JSON.stringify(edge)}`
      expect.soft(Math.abs(edge.side - edge.top), measured).toBeLessThanOrEqual(0.5)
      expect.soft(Math.abs(edge.side - edge.bottom), measured).toBeLessThanOrEqual(0.5)
    }
  }
}
