import {test as base, expect} from '@playwright/test'
import type {Frame, Locator, Page} from '@playwright/test'
import type {Theme} from './smoke.spec.js'

const test = base.extend<{theme: Theme}>({theme: ['light', {option: true}]})

/**
 * Rings are styling on the item itself, so they stay on it however the stage is zoomed and scrolled. In the
 * infrastructure story (graph renderer, diff mode, opening fitted with the whole plan in view), the
 * selected card's own edge shape takes the ring: in pixels, along lines across its left, top, right and bottom edges,
 * the ring's color starts where the card's edge does, at the opening scale, after scrolling the stage and after
 * zooming in and out. Its status band shows each status with its badge (a disc with the glyph cut out), not the word
 * alone.
 */
const story = (id: string) => new URL(`iframe.html?id=${id}&viewMode=story`, process.env.PROJECTIONS_STORYBOOK_URL!).href

/** Waits for a zoom to finish: the card's box the same on two reads a frame apart. */
async function settled(card: Locator) {
  let previous = ''
  await expect
    .poll(async () => {
      const box = await card.evaluate(
        element =>
          new Promise<string>(resolve =>
            requestAnimationFrame(() => {
              const {x, y, width, height} = element.getBoundingClientRect()
              resolve([x, y, width, height].map(value => value.toFixed(1)).join(','))
            }),
          ),
      )
      const same = box === previous
      previous = box
      return same
    })
    .toBe(true)
}

async function rendererFrame(page: Page): Promise<Frame> {
  const iframe = page.locator('iframe.ph-frame').first()
  await expect(iframe).toBeVisible()
  const frame = (await (await iframe.elementHandle())!.contentFrame())!
  await expect(frame.locator('.graph-node[data-entity-id]').first()).toBeVisible()
  return frame
}

/** The selected card's ring, measured in the frame: the card's edge geometry and whether its edge shape carries the ring. */
async function ringOnCard(frame: Frame, id: string) {
  return frame.evaluate(id => {
    const card = document.querySelector(`.graph-node[data-entity-id="${CSS.escape(id)}"]`)!
    const surface = card.querySelector<SVGGraphicsElement>('.node-surface')!
    const edges = [...card.querySelectorAll<SVGGraphicsElement>('[data-projections-edge]')]
    const box = surface.getBoundingClientRect()
    return {
      selected: card.hasAttribute('data-projections-ring-selected'),
      strokes: edges.map(edge => getComputedStyle(edge).stroke),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--projections-color-accent').trim(),
      box: {left: box.left, top: box.top, right: box.right, bottom: box.bottom},
    }
  }, id)
}

/** In the page's pixels: along a line from outside the card inwards, where the ring color first appears. */
async function ringStarts(page: Page, frame: Frame, box: {left: number; top: number; right: number; bottom: number}, stroke: string) {
  const offset = (await page.locator('iframe.ph-frame').first().boundingBox())!
  const shot = await page.screenshot({scale: 'device'})
  return page.evaluate(
    async ([url, box, offset, stroke]) => {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', {willReadFrequently: true})!
      context.drawImage(image, 0, 0)
      const scale = canvas.width / innerWidth
      const [sr = 0, sg = 0, sb = 0] = (stroke.match(/[\d.]+/g) ?? []).map(Number)
      // The ring's own color, give or take antialiasing against what is under its edge.
      const blue = (x: number, y: number) => {
        const [r, g, b] = context.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data
        return Math.abs(r! - sr) + Math.abs(g! - sg) + Math.abs(b! - sb) < 90
      }
      const mid = {x: (box.left + box.right) / 2 + offset.x, y: (box.top + box.bottom) / 2 + offset.y}
      const along = (x0: number, y0: number, dx: number, dy: number) => {
        for (let t = 0; t <= 16; t += 0.25) if (blue(x0 + dx * t, y0 + dy * t)) return t - 8
        return null
      }
      // Only sides the frame shows (the stage may crop the card at its edge).
      const shown = (x: number, y: number) =>
        x >= offset.x + 2 && x <= offset.x + offset.width - 2 && y >= offset.y + 2 && y <= offset.y + offset.height - 2
      const sides: [string, number, number, number, number][] = [
        ['left', box.left + offset.x - 8, mid.y, 1, 0],
        ['right', box.right + offset.x + 8, mid.y, -1, 0],
        ['top', mid.x, box.top + offset.y - 8, 0, 1],
        ['bottom', mid.x, box.bottom + offset.y + 8, 0, -1],
      ]
      return Object.fromEntries(
        sides
          .filter(([, x, y, dx, dy]) => shown(x, y) && shown(x + dx * 16, y + dy * 16) && shown(mid.x, mid.y))
          .map(([side, x, y, dx, dy]) => [side, along(x, y, dx, dy)]),
      )
    },
    [`data:image/png;base64,${shot.toString('base64')}`, box, offset, stroke] as const,
  )
}

async function expectRingOnCard(page: Page, frame: Frame, id: string, where: string) {
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const ring = await ringOnCard(frame, id)
  expect(ring.selected, where).toBe(true)
  const starts = await ringStarts(page, frame, ring.box, ring.strokes[0]!)
  expect(Object.keys(starts).length, `${where}: sides in view`).toBeGreaterThanOrEqual(2)
  // The ring is the card's own edge stroke, centered on its outline: it starts up to half its width (1.5 px) outside
  // the card's geometry, plus a pixel of antialiasing, and never inside it.
  for (const [side, start] of Object.entries(starts)) {
    expect(start, `${where}: ring at the ${side}`).not.toBeNull()
    expect(start!, `${where}: ring at the ${side} starts at the card's edge`).toBeGreaterThanOrEqual(-2.5)
    expect(start!, `${where}: ring at the ${side} starts at the card's edge`).toBeLessThanOrEqual(1)
  }
}

test('infrastructure: the selected card is its own ring at any zoom and scroll, and its status band shows badges', async ({page}) => {
  // Rings and badges are measured from screenshots at six zoom steps: on a Linux WebKit runner that takes about a minute.
  test.setTimeout(120_000)
  await page.setViewportSize({width: 1440, height: 900})
  await page.goto(story('default-ui-renderers--infrastructure'))
  const frame = await rendererFrame(page)
  const id = 'aws_route53_record.database'
  const card = frame.locator(`.graph-node[data-entity-id="${id}"]`)
  await expect(card).toHaveCount(1)
  await card.evaluate(element => element.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'}))
  await card.click()
  await expectRingOnCard(page, frame, id, 'at the opening scale')

  // Scrolled: the stage scrolls under a fixed pointer, and the ring stays on the card.
  await frame.evaluate(() => {
    const scroller = [...document.querySelectorAll<HTMLElement>('*')].find(
      element => element.scrollHeight > element.clientHeight + 20 && getComputedStyle(element).overflowY !== 'visible',
    )
    scroller?.scrollBy({top: 40, behavior: 'instant'})
  })
  await card.evaluate(element => element.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'}))
  await expectRingOnCard(page, frame, id, 'after scrolling')

  // Zoomed in and out with the toolbar.
  for (const name of ['Zoom in', 'Zoom out', 'Zoom out']) {
    const button = page.locator('.ph-toolbar').getByRole('button', {name, exact: true}).first()
    if (!(await button.isVisible()) || !(await button.isEnabled())) continue
    await button.click()
    await settled(card)
    await card.evaluate(element => element.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'}))
    await expectRingOnCard(page, frame, id, `after ${name}`)
    await page.screenshot({path: test.info().outputPath(`after-${name.replace(' ', '-').toLowerCase()}.png`)})
  }

  // The status band: each status word has its badge, painted: a disc in the band's on-emphasis color with the glyph
  // cut out, so both the disc's color and the band's show inside the icon's box. At every zoom where a badge is large
  // enough to tell disc from glyph: fitting the whole plan to the view can shrink one to a few antialiased pixels.
  let measured = 0
  for (const name of ['Zoom in', 'Zoom in', 'Fit to view']) {
    const button = page.locator('.ph-toolbar').getByRole('button', {name, exact: true}).first()
    if ((await button.isVisible()) && (await button.isEnabled())) await button.click()
    await settled(card)
    await card.evaluate(element => element.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'}))
    const icons = card.locator('.node-status .pk-status-part .pk-svg-icon')
    expect(await icons.count(), `${name}: badges`).toBeGreaterThan(0)
    for (const icon of await icons.all()) {
      const box = await icon.boundingBox()
      if (!box || box.width < 1) throw new Error(`${name}: a badge has no box`)
      if (box.width < 8) continue
      measured++
      const shot = await icon.screenshot({scale: 'device'})
      const share = await page.evaluate(
        async url => {
          const image = new Image()
          image.src = url
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.naturalWidth
          canvas.height = image.naturalHeight
          const context = canvas.getContext('2d', {willReadFrequently: true})!
          context.drawImage(image, 0, 0)
          const {data} = context.getImageData(0, 0, canvas.width, canvas.height)
          // The box's corner is outside the disc: the band's color. Painted pixels depart from it.
          const band = [data[0]!, data[1]!, data[2]!]
          let painted = 0
          for (let index = 0; index < data.length; index += 4) {
            if (Math.abs(data[index]! - band[0]!) + Math.abs(data[index + 1]! - band[1]!) + Math.abs(data[index + 2]! - band[2]!) > 150) {
              painted++
            }
          }
          return painted / (data.length / 4)
        },
        `data:image/png;base64,${shot.toString('base64')}`,
      )
      // The disc covers most of the box; the glyph and the corners outside the disc show the band.
      expect(share, `${name}: a badge is painted`).toBeGreaterThan(0.15)
      expect(share, `${name}: a badge's glyph is cut out`).toBeLessThan(0.9)
    }
    await page.screenshot({path: test.info().outputPath(`band-${name.replace(' ', '-').toLowerCase()}.png`)})
  }
  expect(measured, 'badges large enough to measure').toBeGreaterThan(0)
})
