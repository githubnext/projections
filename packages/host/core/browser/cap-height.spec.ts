import {test, expect, type Locator, type Page} from '@playwright/test'
import {story} from './harness.js'

/**
 * Text in the chrome is centred by its cap height, not its line box: a capital "E" in the summary bar, in a figure's
 * pill and in a toolbar text button has the same space above, below and to its left (docs/guides/host-ui.md, "The summary
 * bar"). Measured in pixels at 2× on a screenshot: the probe "E" replaces the label's text, and its ink is where the
 * screenshot departs from the container's background by half its peak contrast.
 */
interface Gaps {
  top: number
  bottom: number
  left: number
}

/**
 * The gaps around a capital "E" in place of `label`'s text, inside `container`'s border box (a strip's hairline is its
 * edge, as a pill's transparent border is). `left` is the inset from the container's left edge; for a label after an
 * icon (`afterIcon`) only the ink right of the label's start is scanned, and `left` is not meaningful.
 */
async function capGaps(page: Page, container: Locator, label: Locator, afterIcon = false): Promise<Gaps> {
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
    (element, label) => {
      const rect = element.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(label as Element)
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
    async ([url, clip, box, afterIcon]) => {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', {willReadFrequently: true})!
      context.drawImage(image, 0, 0)
      const {data, width} = context.getImageData(0, 0, canvas.width, canvas.height)
      const scale = canvas.width / clip.width
      const px = (x: number) => Math.round((x - clip.x) * scale)
      const py = (y: number) => Math.round((y - clip.y) * scale)
      const [y0, y1] = [py(box.top), py(box.bottom)]
      // Inside any drawn border, which is the container's edge, not ink.
      const [from, to] = [px(afterIcon ? box.textLeft - 0.5 : box.left + box.borders.left), Math.min(canvas.width, px(box.textRight + 1))]
      const [above, below] = [py(box.top + box.borders.top), py(box.bottom - box.borders.bottom)]
      const at = (x: number, y: number) => (y * width + x) * 4
      // The background: the container's own color just inside its left edge, halfway down.
      const ground = at(px(box.left + box.borders.left) + 1, Math.round((y0 + y1) / 2))
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
      // Measured from inside the container's borders: a strip's hairline is its edge.
      return {
        top: (top - above) / scale,
        bottom: (below - bottom) / scale,
        left: (left - px(box.left + box.borders.left)) / scale,
      }
    },
    [`data:image/png;base64,${shot.toString('base64')}`, clip, box, afterIcon] as const,
  )
}

/** Top and bottom within a pixel of each other, and unless the label follows an icon, the left inset within a pixel of each. */
function expectCentred(gaps: Gaps, what: string, afterIcon = false) {
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
const withoutTextBox = (page: Page) =>
  page.evaluate(() => {
    const fallbacks: string[] = []
    const visit = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSSupportsRule && /not\s*\(\s*text-box/.test(rule.conditionText)) {
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

const bar = (page: Page) => page.getByRole('group', {name: 'Summary'})

async function open(page: Page, id: string) {
  await page.goto(story(id))
  await expect(page.locator('[data-renderer-status="ready"]').first()).toBeAttached({timeout: 30_000})
}

test.use({viewport: {width: 1280, height: 800}, deviceScaleFactor: 2})

for (const fallback of [false, true]) {
  test(`a capital E sits optically centred in the summary bar and in a hovered figure's pill${fallback ? ', without text-box' : ''}`, async ({
    page,
  }) => {
    await open(page, 'default-ui-projection-view--summary-bar')
    if (fallback) expect(await withoutTextBox(page)).toBeGreaterThan(0)
    await page.mouse.move(0, 0)
    const total = bar(page).locator('.ph-summary-figures [data-summary-total]').first()
    // The figures sit centred in the bar, so only the E's top and bottom gaps meet; its left gap is the centring's.
    expectCentred(await capGaps(page, bar(page), total), 'bar', true)
    const centres = await bar(page).evaluate(element => {
      const box = element.getBoundingClientRect()
      // The figures (and, when some don't fit, their "…") and what the bar keeps at its end: the bar, as wide as they
      // need in the stage's foot, sits evenly around them.
      const figures = element.querySelector('.ph-summary-centre')!.getBoundingClientRect()
      const ends = [...element.querySelectorAll('.ph-summary-trail > *')].map(item => item.getBoundingClientRect().right)
      const end = Math.max(figures.right, ...ends)
      return {start: figures.left - box.left, end: box.right - end}
    })
    expect(Math.abs(centres.start - centres.end), JSON.stringify(centres)).toBeLessThanOrEqual(1)
    // The pill is drawn on hover.
    await total.hover()
    expectCentred(await capGaps(page, total, total), 'pill')
  })
}

test("a capital E sits optically centred in the toolbar's text buttons", async ({page}) => {
  // The comparison mode's segments, each a label after its icon.
  await page.goto(story('default-ui-building-blocks--mode-switch-block'))
  const mode = page.locator('.ph-mode [data-mode]').nth(1)
  await expect(mode.locator('.ph-mode-label')).toBeVisible()
  await mode.hover()
  expectCentred(await capGaps(page, mode, mode.locator('.ph-mode-label'), true), 'mode', true)
})

test("a notice's icon is centred on the row it explains: its text and, without changes, the Show all button", async ({page}) => {
  for (const [id, notice] of [
    ['default-ui-projection-view--no-changes', '.ph-no-changes'],
    ['default-ui-projection-view--without-renderer', '.ph-notice'],
  ] as const) {
    // A story without a renderer never reports one ready: it is open once its notice shows.
    await page.goto(story(id))
    const alert = page.locator(notice).first()
    await expect(alert).toBeVisible()
    const rects = await alert.evaluate(element => {
      const icon = element.querySelector(':scope > svg')!.getBoundingClientRect()
      const description = element.querySelector('[data-slot="alert-description"]')!
      // The row the icon labels: the button where there is one (the tallest thing on it), else the first text line.
      const button = description.querySelector('button')?.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(description)
      const line = range.getClientRects()[0]!
      const row = button ?? line
      return {icon: icon.top + icon.height / 2, row: row.top + row.height / 2, top: icon.top, height: icon.height}
    })
    expect(Math.abs(rects.icon - rects.row), `${notice}: ${JSON.stringify(rects)}`).toBeLessThanOrEqual(0.5)
    // On whole pixels.
    expect(rects.top % 1, `${notice}: icon top`).toBe(0)
  }
})
