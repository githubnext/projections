import {expect, test} from '@playwright/test'
import type {Page} from '@playwright/test'

/**
 * Watches every renderer frame on every animation frame: a frame that is
 * visible before the host revealed it (its first themed paint) is a
 * violation. Also counts the frames the host creates.
 */
export async function watchFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = {violations: [] as string[], created: 0, samples: 0}
    const seen = new WeakSet<Element>()
    ;(window as unknown as {__frames: typeof state}).__frames = state
    const tick = () => {
      state.samples++
      for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe.ph-frame')) {
        if (!seen.has(frame)) {
          seen.add(frame)
          state.created++
        }
        const style = getComputedStyle(frame)
        const visible = style.visibility !== 'hidden' && Number(style.opacity) > 0 && frame.getBoundingClientRect().height > 0
        if (visible && frame.dataset.revealed !== 'true') {
          state.violations.push(`${frame.getAttribute('aria-label')} visible before it painted`)
        }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

export async function frameReport(page: Page): Promise<{violations: string[]; created: number; samples: number}> {
  return page.evaluate(() => (window as unknown as {__frames: {violations: string[]; created: number; samples: number}}).__frames)
}

/** Resets the created-frame count, for example before one mode switch. */
export async function resetCreated(page: Page): Promise<void> {
  await page.evaluate(() => {
    ;(window as unknown as {__frames: {created: number}}).__frames.created = 0
  })
}

/**
 * Screenshots the page and returns, for each visible renderer frame, the
 * share of its pixels that are light (relative luminance above 0.8). The
 * image is decoded in a blank page, since renderer pixels aren't readable
 * from the host page.
 */
export interface LightSample {
  share: number
  frame: string
  box: {x: number; y: number; width: number; height: number}
  image: Buffer
  phase?: string
}

export async function lightShares(page: Page, analyzer: Page): Promise<LightSample[]> {
  const boxes = await page.locator('iframe.ph-frame').evaluateAll(frames =>
    frames
      .filter(frame => Number(getComputedStyle(frame).opacity) > 0)
      .map(frame => {
        const box = frame.getBoundingClientRect()
        return {
          frame: `${frame.getAttribute('aria-label')} (revealed ${frame.dataset.revealed})`,
          x: Math.max(0, box.left),
          y: Math.max(0, box.top),
          width: Math.min(box.width, innerWidth - box.left),
          height: Math.min(box.height, innerHeight - box.top),
        }
      })
      .filter(box => box.width > 20 && box.height > 20),
  )
  if (!boxes.length) return []
  // JPEG keeps hundreds of samples small; luminance survives compression.
  const buffer = await page.screenshot({animations: 'allow', caret: 'initial', type: 'jpeg', quality: 60})
  const image = buffer.toString('base64')
  const scale = await page.evaluate(() => devicePixelRatio)
  const shares = await analyzer.evaluate(
    async ({image, boxes, scale}) => {
      const element = new Image()
      element.src = `data:image/jpeg;base64,${image}`
      await element.decode()
      const canvas = document.createElement('canvas')
      canvas.width = element.naturalWidth
      canvas.height = element.naturalHeight
      const context = canvas.getContext('2d')!
      context.drawImage(element, 0, 0)
      const luminance = (data: Uint8ClampedArray, index: number) =>
        (0.2126 * data[index]! + 0.7152 * data[index + 1]! + 0.0722 * data[index + 2]!) / 255
      return boxes.map(box => {
        const left = Math.round(box.x * scale),
          top = Math.round(box.y * scale)
        const width = Math.max(1, Math.round(box.width * scale)),
          height = Math.max(1, Math.round(box.height * scale))
        const data = context.getImageData(left, top, width, height).data
        // A strip of the host page beside the frame. Rows where it is light too weren't painted yet when the screenshot
        // was taken (slow software compositing leaves whole bands blank); a flash is confined to the frame.
        const stripLeft = left >= 8 * scale ? left - Math.round(6 * scale) : left + width + Math.round(2 * scale)
        const stripWidth = Math.round(4 * scale)
        const strip =
          stripLeft >= 0 && stripLeft + stripWidth <= canvas.width
            ? context.getImageData(stripLeft, top, stripWidth, height).data
            : undefined
        let light = 0,
          counted = 0
        for (let row = 0; row < height; row++) {
          if (strip) {
            let reference = 0
            for (let column = 0; column < stripWidth; column++) reference += luminance(strip, (row * stripWidth + column) * 4)
            if (reference / stripWidth > 0.5) continue
          }
          for (let column = 0; column < width; column++) {
            counted++
            if (luminance(data, (row * width + column) * 4) > 0.8) light++
          }
        }
        return counted ? light / counted : 0
      })
    },
    {image, boxes, scale},
  )
  return shares.map((share, index) => {
    const {frame, ...box} = boxes[index]!
    return {share, frame, box, image: buffer}
  })
}

/**
 * Runs `steps` while sampling: the frame watcher checks every animation
 * frame, and screenshots taken throughout must show no predominantly light
 * renderer frame in dark mode.
 */
export async function expectNoFlash(page: Page, steps: () => Promise<void>): Promise<void> {
  const analyzer = await page.context().newPage()
  try {
    // Frames must be on screen to be sampled (and painted).
    await page.locator('.ph-stage').first().scrollIntoViewIfNeeded()
    let running = true
    const shares: LightSample[] = []
    const sampling = (async () => {
      while (running) {
        const phase = await page.evaluate(() => document.querySelector('.ph')?.getAttribute('data-comparison-mode') ?? '').catch(() => '')
        shares.push(...(await lightShares(page, analyzer).catch(() => [])).map(sample => ({...sample, phase})))
        // Let the page render between screenshots, so slow engines still reach the stable frames actions wait for.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))).catch(() => {})
      }
    })()
    try {
      await steps()
    } finally {
      running = false
      await sampling
    }
    await page.locator('.ph-stage').first().scrollIntoViewIfNeeded()
    shares.push(...(await lightShares(page, analyzer)))
    expect(shares.length).toBeGreaterThan(0)
    const worst = shares.reduce((a, b) => (b.share > a.share ? b : a))
    if (worst.share >= 0.5) {
      const {writeFile} = await import('node:fs/promises')
      await writeFile(test.info().outputPath('light-frame.jpeg'), worst.image)
      await writeFile(
        test.info().outputPath('light-frame.json'),
        JSON.stringify(
          {
            frame: worst.frame,
            box: worst.box,
            share: worst.share,
            phase: worst.phase,
            heights: await page
              .locator('iframe.ph-frame')
              .evaluateAll(frames => frames.map(frame => `${frame.getAttribute('aria-label')}: ${frame.style.height}`)),
          },
          null,
          2,
        ),
      )
    }
    expect(
      worst.share,
      `a renderer frame showed a light background in dark mode: ${worst.frame} at ${JSON.stringify(worst.box)}`,
    ).toBeLessThan(0.5)
    const report = await frameReport(page)
    expect(report.samples).toBeGreaterThan(10)
    expect(report.violations).toEqual([])
  } finally {
    await analyzer.close()
  }
}
