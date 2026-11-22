import {test, expect, type Locator, type Page} from '@playwright/test'
import {explorer} from './harness.js'

/**
 * The default UI's chrome stacks the surface scale it shares with renderers (`--pj-surface-*`, `--pj-divider`), and
 * every tinted region has a same-hue edge, never a fill alone (docs/guides/host.md, "Theme").
 */
const changeKinds = ['added', 'removed', 'modified', 'moved'] as const
const regionSelectors = '.ph-table-view, .ph-text-view, .ph-detail-card, .ph-legend, .ph-notice, .ph-error'

async function open(page: Page, scheme: 'light' | 'dark', query: string) {
  await page.emulateMedia({colorScheme: scheme})
  await page.goto(explorer(query))
  await expect(page.locator('.ph-explorer')).toBeVisible()
  await expect(page.locator('.ph')).toHaveClass(scheme === 'dark' ? /pj-dark/u : /^(?!.*pj-dark)/u)
}

/** A color as sRGB channels and alpha (0–255), resolved by painting it: any CSS color syntax compares equal. */
function installColorProbe(page: Page) {
  return page.evaluate(() => {
    const context = document.createElement('canvas').getContext('2d', {willReadFrequently: true})!
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = '#00000000'
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    }
    const root = document.querySelector('.ph')!
    const token = (name: string) => {
      const probe = document.createElement('span')
      probe.style.color = `var(--pj-${name})`
      root.append(probe)
      const value = getComputedStyle(probe).color
      probe.remove()
      return rgba(value)
    }
    Object.assign(window, {__pj: {rgba, token}})
  })
}

/** Background and edge colors of an element, each as sRGB channels and alpha. */
async function paint(locator: Locator) {
  return locator.evaluate(element => {
    const {rgba} = (window as unknown as {__pj: {rgba: (color: string) => number[]}}).__pj
    const style = getComputedStyle(element)
    const side = (name: 'top' | 'right' | 'bottom' | 'left') =>
      parseFloat(style.getPropertyValue(`border-${name}-width`)) > 0 ? rgba(style.getPropertyValue(`border-${name}-color`)) : null
    return {background: rgba(style.backgroundColor), top: side('top'), bottom: side('bottom'), left: side('left')}
  })
}

const tokenValue = (page: Page, name: string) =>
  page.evaluate(value => (window as unknown as {__pj: {token: (name: string) => number[]}}).__pj.token(value), name)

/**
 * Every element in the chrome's views, detail card, legend and notices whose fill is a change `-muted` color (its
 * background color, or a background image over the raised surface) or the lens's muted selection, with the edge
 * colors it draws: its borders, outline and box shadows.
 */
async function tintedRegions(page: Page) {
  return page.evaluate(
    ({scopes, changes}) => {
      const {rgba, token} = (window as unknown as {__pj: {rgba: (color: string) => number[]; token: (name: string) => number[]}}).__pj
      const same = (x: number[], y: number[]) => x.every((channel, index) => Math.abs(channel - y[index]!) <= 2)
      const fills = [
        ...changes.map(change => ({hue: change, fill: token(`${change}-muted`), edge: token(`${change}-border`)})),
        {hue: 'lens', fill: token('lens-muted'), edge: token('lens')},
      ]
      const colors = (value: string) =>
        [...value.matchAll(/(?:rgba?|oklch|oklab|lab|lch|color)\([^()]*\)|#[\da-f]{3,8}\b/giu)].map(match => rgba(match[0]))
      const regions: {element: string; hue: string; edges: number}[] = []
      const unknown: string[] = []
      for (const element of document.querySelectorAll<HTMLElement>(`:is(${scopes}), :is(${scopes}) *`)) {
        const style = getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        const painted = [rgba(style.backgroundColor), ...colors(style.backgroundImage)].filter(color => color[3]! > 0)
        const match = fills.find(({fill}) => painted.some(color => same(color, fill)))
        const label = `${element.tagName.toLowerCase()}.${[...element.classList].filter(name => name.startsWith('ph-')).join('.')} "${element.textContent.trim().slice(0, 30)}"`
        // A fill whose channels spread is tinted: it must be one of the fills the rule covers.
        const saturated = painted.some(color => Math.max(...color.slice(0, 3)) - Math.min(...color.slice(0, 3)) > 12)
        if (!match) {
          // Legend swatches are the renderer's own marks; only their change fills are held to the rule.
          if (saturated && !element.matches('.ph-legend-swatch')) unknown.push(label)
          continue
        }
        const edges = [
          ...(['top', 'right', 'bottom', 'left'] as const)
            .filter(side => parseFloat(style.getPropertyValue(`border-${side}-width`)) >= 1)
            .map(side => rgba(style.getPropertyValue(`border-${side}-color`))),
          ...(parseFloat(style.outlineWidth) >= 1 && style.outlineStyle !== 'none' ? [rgba(style.outlineColor)] : []),
          ...colors(style.boxShadow),
        ].filter(color => same(color, match.edge)).length
        regions.push({element: label, hue: match.hue, edges})
      }
      return {regions, unknown}
    },
    {scopes: regionSelectors, changes: [...changeKinds]},
  )
}

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: table, detail card and notices stack the shared surfaces, and every change fill has its edge`, async ({page}) => {
    await open(page, scheme, 'renderer=none&before=v1&after=v3')
    await expect(page.locator('.ph-table-view')).toBeVisible()
    await installColorProbe(page)
    const [canvas, raised, header, divider] = await Promise.all(
      ['surface-canvas', 'surface-raised', 'surface-header', 'divider'].map(name => tokenValue(page, name)),
    )
    // The tokens are the renderer token set's own values (test/theme.test.mjs checks theme.css against the SDK).
    expect(new Set([canvas, raised, header].map(String)).size).toBe(3)

    // The views sit on the canvas; each table is a raised card with a divider edge and a header band ruled by it.
    expect((await paint(page.locator('.ph-scroll'))).background).toEqual(canvas)
    const card = await paint(page.locator('.ph-table-scroll').first())
    expect(card.background).toEqual(raised)
    expect(card.top).toEqual(divider)
    expect((await paint(page.locator('.ph-table-scroll caption').first())).background).toEqual(header)
    expect((await paint(page.locator('.ph-table-scroll thead').first())).background).toEqual(header)
    expect((await paint(page.locator('.ph-table-scroll thead tr').first())).bottom).toEqual(divider)

    // The renderer notice is a raised band under the toolbar, ruled off below by a divider hairline.
    const notice = await paint(page.locator('.ph-notice').first())
    expect(notice.background).toEqual(raised)
    expect(notice.top).toBeNull()
    expect(notice.bottom).toEqual(divider)

    // The detail card: a raised card, its header a band.
    await page.locator('.ph-table-view tbody [data-row-id] button').first().click()
    await expect(page.locator('.ph-detail-card')).toBeVisible()
    // Off the selected row, so its fill is the selection's, not a hover's mid-transition.
    await page.mouse.move(0, 0)
    await page.waitForTimeout(300)
    const details = await paint(page.locator('.ph-detail-card'))
    expect(details.background).toEqual(raised)
    expect(details.top).toEqual(divider)
    const band = await paint(page.locator('.ph-detail-card-header'))
    expect(band.background).toEqual(header)
    expect(band.bottom).toEqual(divider)

    // Change chips (and the selected row's lens fill) have a same-hue edge.
    const {regions, unknown} = await tintedRegions(page)
    expect(unknown, 'tinted fills outside the shared fills').toEqual([])
    expect(new Set(regions.map(region => region.hue))).toEqual(new Set(['added', 'removed', 'modified', 'lens']))
    for (const region of regions) expect(region.edges, `${region.element}: ${region.hue} edge`).toBeGreaterThan(0)
  })

  test(`${scheme}: the text view's steps are raised cards with header bands`, async ({page}) => {
    await open(page, scheme, 'renderer=none&before=v1&after=v3&view=text')
    await expect(page.locator('.ph-text-view')).toBeVisible()
    await installColorProbe(page)
    const [canvas, raised, header, divider] = await Promise.all(
      ['surface-canvas', 'surface-raised', 'surface-header', 'divider'].map(name => tokenValue(page, name)),
    )
    expect((await paint(page.locator('.ph-scroll'))).background).toEqual(canvas)
    const step = await paint(page.locator('.ph-steps > li').first())
    expect(step.background).toEqual(raised)
    expect(step.top).toEqual(divider)
    const heading = await paint(page.locator('.ph-step-heading').first())
    expect(heading.background).toEqual(header)
    expect(heading.bottom).toEqual(divider)
    const {regions, unknown} = await tintedRegions(page)
    expect(unknown).toEqual([])
    for (const region of regions) expect(region.edges, `${region.element}: ${region.hue} edge`).toBeGreaterThan(0)
  })

  test(`${scheme}: the legend sits in the stage's foot, and a change fill swatch has its same-hue edge`, async ({page}) => {
    await open(page, scheme, 'renderer=hostile&probe=legend&before=v1&after=v3')
    const legend = page.locator('.ph-legend')
    await expect(legend.locator('.ph-legend-item')).toHaveCount(5)
    await installColorProbe(page)
    const [_header, divider, fill, edge] = await Promise.all(
      ['surface-header', 'divider', 'modified-muted', 'modified-border'].map(name => tokenValue(page, name)),
    )
    // The foot draws the surface and the edge; the legend, its first row, draws neither, and the summary's rule under it.
    await expect(page.locator('.ph-stage-foot > .ph-legend')).toHaveCount(1)
    const box = await paint(legend)
    expect(box.background[3]).toBe(0)
    expect(box.top).toBeNull()
    expect(box.bottom).toBeNull()
    const rule = await paint(page.locator('.ph-stage-foot > .ph-summary-bar'))
    expect(rule.top).toEqual(divider)
    expect((await paint(page.locator('.ph-stage-foot'))).top).toEqual(divider)
    const swatch = await paint(legend.locator('.ph-legend-item', {hasText: 'Changed'}).locator('.ph-legend-swatch'))
    expect(swatch.background).toEqual(fill)
    expect(swatch.top).toEqual(edge)
    const {regions, unknown} = await tintedRegions(page)
    expect(unknown).toEqual([])
    expect(regions.map(region => region.hue)).toContain('modified')
    for (const region of regions) expect(region.edges, `${region.element}: ${region.hue} edge`).toBeGreaterThan(0)
  })
}
