import {readFileSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import type {Page} from '@playwright/test'
import {ringGeometry, ringPixelReport} from '@githubnext/projections-renderer-testing/playwright'

/**
 * The SDK's item rings on a deliberately adversarial third-party document
 * (`fixtures/rings.html`). Rings are styling on each item's own element, so
 * on a well-formed item (it owns its visible edge) the ring is that edge, in
 * pixels, in every state, through transforms. Ill-formed items (a bare
 * wrapper around the card, an edge drawn outside the box, rows that don't
 * take their group's inner radius, an SVG item with no marked edge) are
 * author errors the `rings` check names, with the element to mark.
 */
const origin = 'http://rings.test'
const fixture = readFileSync(new URL('./fixtures/rings.html', import.meta.url), 'utf8')
const sdk = (name: string) => readFileSync(new URL(`../../sdk/dist/${name}`, import.meta.url), 'utf8')
const probe = () => readFileSync(new URL('../../testing/dist/probe.js', import.meta.url), 'utf8')

async function open(page: Page, query: string) {
  await page.route(`${origin}/**`, route => {
    const {pathname} = new URL(route.request().url())
    if (pathname.startsWith('/sdk/')) return route.fulfill({contentType: 'text/javascript', body: sdk(pathname.slice(5))})
    if (pathname === '/probe.js') return route.fulfill({contentType: 'text/javascript', body: probe()})
    return route.fulfill({contentType: 'text/html', body: fixture})
  })
  await page.goto(`${origin}/?${query}`)
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true')
}

declare global {
  interface Window {
    ring: (id: string | null, state?: 'hover' | 'selected' | 'focus') => Promise<void>
    probe: <T = unknown>(call: string, args?: unknown) => Promise<T>
  }
}

const wellFormed = [
  'plain',
  'transform',
  'per-corner',
  'border-0',
  'border-2',
  'row-middle',
  'rounded-first',
  'rounded-last',
  'svg-rect',
  'svg-circle',
  'svg-scaled',
]
const states = ['hover', 'selected', 'focus'] as const

for (const color of ['light', 'dark'] as const) {
  test(`rings are each well-formed item's own edge, in pixels (${color})`, async ({page}) => {
    await open(page, `approach=sdk&color=${color}`)
    const failures: string[] = []
    for (const state of states) {
      for (const id of wellFormed) {
        await page.evaluate(([id, state]) => window.ring(id, state), [id, state] as const)
        const [geometry] = await ringGeometry(page.mainFrame(), id)
        if (!geometry) {
          failures.push(`${id} (${state}): no unit`)
          continue
        }
        const report = await ringPixelReport(page, page.mainFrame(), geometry, {
          label: `${id} (${state})`,
          ring: () => page.evaluate(([id, state]) => window.ring(id, state), [id, state] as const),
          clear: () => page.evaluate(() => window.ring(null)),
        })
        failures.push(...report.failures)
      }
    }
    expect(failures).toEqual([])
  })
}

/** The `rings` check's failures for `id`, selected. */
async function check(page: Page, id: string): Promise<string[]> {
  await page.evaluate(() => window.ring(null))
  await page.evaluate(id => window.probe('ringNeutral', id), id)
  await page.evaluate(id => window.ring(id, 'selected'), id)
  return page.evaluate(id => window.probe<string[]>('rings', {id, state: 'selected'}), id)
}

test('the rings check passes well-formed items and names the fix for ill-formed ones', async ({page}) => {
  await open(page, 'approach=sdk')
  for (const id of [...wellFormed, 'svg-edge']) expect(await check(page, id), id).toEqual([])
  const explained: [string, RegExp][] = [
    [
      'wrapper',
      /visible edge of "wrapper" is drawn by div\.card, [\d.]+ px inside it.*put data-entity-id \(or data-projections-unit\) on div\.card instead/,
    ],
    ['spread', /"spread" draws its edge 1 px outside its box.*draw the edge as a border/],
    ['overflow', /div is positioned \(absolute\) and paints its background over the top of "overflow"'s ring.*Keep it in normal flow/],
    ['row-first', /"row-first" fills the top-left corner of ul\.group with a 0 px radius, but that corner's inner radius is 9 px/],
    ['row-last', /"row-last" fills the bottom-left corner of ul\.group with a 0 px radius/],
    [
      'svg-covered',
      /"svg-covered"'s visible edge is rect\.change-edge, drawn over its marked edge.*add data-projections-edge to rect\.change-edge/,
    ],
    ['svg-unmarked', /"svg-unmarked" marks no edge shape.*add data-projections-edge to rect\.card-surface/],
  ]
  for (const [id, pattern] of explained) {
    const failures = await check(page, id)
    expect(failures.join('\n'), id).toMatch(pattern)
  }
})

test('a ring is styling on the item: it moves, scales and scrolls with it in the same frame', async ({page}) => {
  await open(page, 'approach=sdk')
  await page.evaluate(() => window.ring('plain', 'selected'))
  const samples = await page.evaluate(
    () =>
      new Promise<{outline: string; offset: string}[]>(resolve => {
        const item = document.querySelector<HTMLElement>('[data-entity-id="plain"]')!
        const seen: {outline: string; offset: string}[] = []
        let frames = 0
        const sample = () => {
          const style = getComputedStyle(item)
          seen.push({outline: `${style.outlineStyle} ${style.outlineWidth}`, offset: style.outlineOffset})
          if (++frames < 20) requestAnimationFrame(sample)
          else resolve(seen)
        }
        item.style.transition = 'transform 300ms linear'
        item.style.transform = 'translate(40px, 12px) scale(1.4)'
        scrollBy(0, 30)
        requestAnimationFrame(sample)
      }),
  )
  for (const sample of samples) expect(sample).toEqual({outline: 'solid 3px', offset: '-3px'})
})

/**
 * The pixel check still names a misplaced ring after discounting what it can't measure (neighbors, labels drawn over
 * an edge, sub-pixel borders, dashes): one inside the item's edge, or one outside it (where the item's ring belongs,
 * there is none).
 */
test('the pixel check names a ring inside or outside its item', async ({page}) => {
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width"><style>
    body { margin: 0; background: #fff; }
    .card { position: absolute; left: 80px; top: 80px; width: 120px; height: 60px; border: 1px solid #888; border-radius: 6px; background: #f6f6f6; box-sizing: border-box; }
  </style><div class="card" data-entity-id="card"></div>`)
  // An outline is drawn outward from its offset: 3 px wide at -5 px ends 2 px inside the box; at 4 px, starts 7 px out.
  const cases = {inside: '-5px', outside: '4px'}
  const reports: Record<string, string[]> = {}
  for (const [name, offset] of Object.entries(cases)) {
    const set = (on: boolean) =>
      page.evaluate(
        ([on, offset]) => {
          const card = document.querySelector<HTMLElement>('.card')!
          card.style.outline = on ? '3px solid #0969da' : ''
          card.style.outlineOffset = on ? offset : ''
          return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        },
        [on, offset] as const,
      )
    await set(true)
    const [geometry] = await ringGeometry(page.mainFrame(), 'card')
    const report = await ringPixelReport(page, page.mainFrame(), geometry!, {label: name, ring: () => set(true), clear: () => set(false)})
    reports[name] = report.failures
  }
  expect(
    reports.inside!.some(failure => /starts .* inside the item's edge/.test(failure)),
    reports.inside!.join('\n'),
  ).toBe(true)
  expect(
    reports.outside!.some(failure => /outside the item's edge|no ring is painted/.test(failure)),
    reports.outside!.join('\n'),
  ).toBe(true)
})
