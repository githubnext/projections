// Optical insets: the space between a pill's painted edge and its text's ink, measured from rendered pixels.
import type {Locator, Page} from '@playwright/test'
import {inkBounds, type InkBounds} from './optical/analyze.js'

/** The gaps between a surface's painted edge and the ink inside it, in CSS px (see `opticalInsets`). */
export interface OpticalInsets {
  top: number
  bottom: number
  left: number
  right: number
  /** Device pixels per CSS pixel the pictures were taken at: the gaps are exact to about one of these. */
  scale: number
  /** The painted bounds, in CSS px from the picture's origin: the surface and the ink. */
  surface: InkBounds
  ink: InkBounds
}

/** Paint properties hidden on the surface, for SVG shapes and HTML boxes alike; the text's own color stays. */
type SurfacePaint = 'fill' | 'stroke' | 'background' | 'border-color' | 'box-shadow' | 'outline-color'
const hiddenPaint: Record<SurfacePaint, string> = {
  fill: 'transparent',
  stroke: 'transparent',
  background: 'transparent',
  'border-color': 'transparent',
  'box-shadow': 'none',
  'outline-color': 'transparent',
}

/**
 * Sets inline style properties on every element, or with `null` restores each element's `style` attribute exactly as
 * it was (shorthands such as `background` would otherwise clobber its longhands). `slot` names the saved copy, so the
 * ink's and the surface's restyling never overwrite each other's.
 */
async function restyle(locator: Locator, slot: string, properties: Record<string, string> | null): Promise<void> {
  await locator.evaluateAll(
    (elements, [savedAs, styles]) => {
      for (const element of elements) {
        if (styles) {
          // A JSON string, or `null` for no style attribute at all.
          element.dataset[savedAs] = JSON.stringify(element.getAttribute('style'))
          for (const [name, value] of Object.entries(styles)) element.style.setProperty(name, value, 'important')
        } else {
          const saved = JSON.parse(element.dataset[savedAs] ?? 'null') as string | null
          if (saved === null) element.removeAttribute('style')
          else element.setAttribute('style', saved)
          Reflect.deleteProperty(element.dataset, savedAs)
        }
      }
    },
    [slot, properties] as const,
  )
}

/**
 * How far the ink of `ink` (a label's text) sits from the painted edge of `surface` (the pill or chip behind it), on
 * each side, from rendered pixels rather than box metrics: the picture with the text and without it gives the ink's
 * bounds, and without the text and also without the surface's paint gives the surface's. Antialiased edges count for
 * the part of them that is covered. `surface` may match several elements painted as one (a fill and a tint over it).
 *
 * To align a label optically, measure one that starts with a capital E and ends with a capital H: the four gaps
 * (above the E's top, below its baseline, left of its stem and right of the H's right stem) should be equal. Take it
 * at a device scale of 2 or more for sub-pixel precision.
 */
export async function opticalInsets(page: Page, {surface, ink}: {surface: Locator; ink: Locator}): Promise<OpticalInsets> {
  // The surface's box, in page CSS px: the union of what the locator matches. The ink is measured inside it too (a
  // WebKit SVG text box can be misplaced), so a repaint elsewhere (a ring's antialiasing) is never taken for either.
  const boxes = (await Promise.all((await surface.all()).map(element => element.boundingBox()))).filter(box => box !== null)
  if (!boxes.length) throw new Error('opticalInsets: the surface is not rendered')
  const area: InkBounds = {
    left: Math.min(...boxes.map(box => box.x)),
    top: Math.min(...boxes.map(box => box.y)),
    right: Math.max(...boxes.map(box => box.x + box.width)),
    bottom: Math.max(...boxes.map(box => box.y + box.height)),
  }
  const margin = 2
  const [x, y] = [Math.floor(area.left - margin), Math.floor(area.top - margin)]
  const clip = {x, y, width: Math.ceil(area.right + margin) - x, height: Math.ceil(area.bottom + margin) - y}
  const picture = async () =>
    `data:image/png;base64,${(await page.screenshot({clip, animations: 'disabled', caret: 'hide', scale: 'device'})).toString('base64')}`
  const shown = await picture()
  await restyle(ink, 'opticalInk', {visibility: 'hidden'})
  let withoutInk: string, bare: string
  try {
    withoutInk = await picture()
    await restyle(surface, 'opticalSurface', hiddenPaint)
    try {
      bare = await picture()
    } finally {
      await restyle(surface, 'opticalSurface', null)
    }
  } finally {
    await restyle(ink, 'opticalInk', null)
  }
  const scale = await page.evaluate(() => devicePixelRatio)
  // The surface's box in the picture's device pixels, a device pixel larger each side for its antialiasing.
  const within: InkBounds = {
    left: (area.left - x) * scale - 1,
    top: (area.top - y) * scale - 1,
    right: (area.right - x) * scale + 1,
    bottom: (area.bottom - y) * scale + 1,
  }
  const [inkBox, surfaceBox] = await Promise.all([
    page.evaluate(inkBounds, [shown, withoutInk, within] as [string, string, InkBounds]),
    page.evaluate(inkBounds, [withoutInk, bare, within] as [string, string, InkBounds]),
  ])
  if (!inkBox) throw new Error('opticalInsets: the ink paints nothing')
  if (!surfaceBox) throw new Error('opticalInsets: the surface paints nothing')
  const css = (bounds: InkBounds): InkBounds => ({
    left: bounds.left / scale,
    top: bounds.top / scale,
    right: bounds.right / scale,
    bottom: bounds.bottom / scale,
  })
  const [inkCss, surfaceCss] = [css(inkBox), css(surfaceBox)]
  return {
    top: inkCss.top - surfaceCss.top,
    bottom: surfaceCss.bottom - inkCss.bottom,
    left: inkCss.left - surfaceCss.left,
    right: surfaceCss.right - inkCss.right,
    scale,
    surface: surfaceCss,
    ink: inkCss,
  }
}
