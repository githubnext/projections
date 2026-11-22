import {test, expect} from '@playwright/test'
import type {Locator, Page} from '@playwright/test'

/**
 * Measuring text centred by its cap height, not its line box (packages/host/vscode-ui/README.md): in pixels at 2× on a
 * screenshot, a probe "E" replaces a label's text, and its ink is where the screenshot departs from the container's
 * background by half its peak contrast. Shared by cap-height.spec.ts and stage-notice.spec.ts.
 */
export interface Gaps {
  top: number
  bottom: number
  left: number
}

/**
 * The gaps around a capital "E" in place of `label`'s text, inside `container`'s border box (a strip's hairline is its
 * edge, as a pill's transparent border is). `left` is the inset from the container's left edge; for a label after an
 * icon (`afterIcon`) only the ink right of the label's start is scanned, and `left` is not meaningful.
 */
export async function capGaps(page: Page, container: Locator, label: Locator, afterIcon = false): Promise<Gaps> {
  await label.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent?.trim()) {
        node.textContent = 'E'
        return
      }
    }
  })
  const box = await container.evaluate(
    (element, labelElement) => {
      const rect = element.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(labelElement as Element)
      const text = range.getBoundingClientRect()
      const style = getComputedStyle(element)
      const border = (side: string) => parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0
      return {
        ...{
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          textLeft: text.left,
          textRight: text.right,
        },
        borders: {
          left: border('left'),
          top: border('top'),
          bottom: border('bottom'),
        },
      }
    },
    await label.elementHandle(),
  )
  const clip = {
    x: Math.floor(box.left),
    y: Math.floor(box.top),
    width: Math.ceil(box.right) - Math.floor(box.left),
    height: Math.ceil(box.bottom) - Math.floor(box.top),
  }
  const shot = await page.screenshot({
    clip,
    scale: 'device',
    animations: 'disabled',
    caret: 'hide',
  })
  return page.evaluate(
    async ([url, shotClip, measured, pastIcon]) => {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', {willReadFrequently: true})!
      context.drawImage(image, 0, 0)
      const {data, width} = context.getImageData(0, 0, canvas.width, canvas.height)
      const scale = canvas.width / shotClip.width
      const px = (x: number) => Math.round((x - shotClip.x) * scale)
      const py = (y: number) => Math.round((y - shotClip.y) * scale)
      const [x0, y0, y1] = [px(measured.left), py(measured.top), py(measured.bottom)]
      // Inside any drawn border, which is the container's edge, not ink.
      const [from, to] = [
        px(pastIcon ? measured.textLeft - 0.5 : measured.left + measured.borders.left),
        Math.min(canvas.width, px(measured.textRight + 1)),
      ]
      const [above, below] = [py(measured.top + measured.borders.top), py(measured.bottom - measured.borders.bottom)]
      const at = (x: number, y: number) => (y * width + x) * 4
      // The background: the container's own color just inside its left edge, halfway down.
      const ground = at(px(measured.left + measured.borders.left) + 1, Math.round((y0 + y1) / 2))
      const contrast = (x: number, y: number) =>
        [0, 1, 2].reduce((sum, channel) => sum + Math.abs(data[at(x, y) + channel]! - data[ground + channel]!), 0)
      let peak = 0
      for (let y = above; y < below; y++) for (let x = from; x < to; x++) peak = Math.max(peak, contrast(x, y))
      let [top, bottom, left] = [Infinity, -Infinity, Infinity]
      for (let y = above; y < below; y++) {
        for (let x = from; x < to; x++) {
          if (contrast(x, y) >= peak / 2) {
            top = Math.min(top, y)
            bottom = Math.max(bottom, y + 1)
            left = Math.min(left, x)
          }
        }
      }
      return {
        top: (top - y0) / scale,
        bottom: (y1 - bottom) / scale,
        left: (left - x0) / scale,
      }
    },
    [`data:image/png;base64,${shot.toString('base64')}`, clip, box, afterIcon] as const,
  )
}

/** Top and bottom within a pixel of each other, and unless the label follows an icon, the left inset within a pixel of each. */
export function expectCentred(gaps: Gaps, what: string, afterIcon = false) {
  const measured = `${what} ${JSON.stringify(gaps)}`
  test.info().annotations.push({type: 'gaps', description: measured})
  expect.soft(Math.abs(gaps.top - gaps.bottom), measured).toBeLessThanOrEqual(1)
  if (afterIcon) return
  expect.soft(Math.abs(gaps.left - gaps.top), measured).toBeLessThanOrEqual(1)
  expect.soft(Math.abs(gaps.left - gaps.bottom), measured).toBeLessThanOrEqual(1)
}

/**
 * The page as an engine without `text-box` draws it: no trimming, and the rules of every `@supports not (text-box: …)`
 * block applied.
 */
export const withoutTextBox = (page: Page) =>
  page.evaluate(() => {
    const fallbacks: string[] = []
    const visit = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSSupportsRule && /not\s*\(\s*text-box/u.test(rule.conditionText)) {
          fallbacks.push(...[...rule.cssRules].map(inner => inner.cssText))
        } else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules)
      }
    }
    for (const sheet of document.styleSheets) visit(sheet.cssRules)
    const style = document.createElement('style')
    style.textContent = `* { text-box: normal !important; } ${fallbacks.join(' ')}`
    document.head.append(style)
    return fallbacks.length
  })

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
export const toolbarInsets = (toolbar: Locator, options: {wrappers: string; secondRow?: string; rows?: string}) =>
  toolbar.evaluate((element, {wrappers, secondRow, rows}) => {
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
    const text = (node: Element) => [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())
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
    const second = secondRow ? element.querySelector<HTMLElement>(`:scope > ${secondRow}`) : null
    const two = element.getAttribute('data-rows') === '2' && second
    const main = row(controls(element, two ? second : null), {
      ...inner,
      bottom: two ? second.getBoundingClientRect().top : inner.bottom,
    })
    if (!two) return {main}
    const top = second.getBoundingClientRect().top + (parseFloat(getComputedStyle(second).borderTopWidth) || 0)
    return {main, playback: row(controls(second, null), {...inner, top})}
  }, options)

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
