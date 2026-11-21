import type {Frame, Page} from '@playwright/test'

/**
 * The renderer frames a stage page starts before WebKit gets a fresh one. Every load that doesn't reuse its frame
 * starts a new one, and WebKit keeps each frame the page has removed, with its document and its script heap, until
 * the page itself navigates: a few megabytes for a small renderer, tens for a large graph. A spec that loads scenario
 * after scenario in one page grows the web process (which also runs the sandboxed frames) by that much per load until
 * it stalls collecting garbage or the system kills it, which shows as a stage that reports ready and then a page whose
 * event loop never runs again, and then a closed target (githubnext/projections#151).
 */
export const framesPerStagePage = 8

/** The page events `framesSinceNavigation` follows, and what it reads from the page. */
export type FramePage = Pick<Page, 'on' | 'mainFrame' | 'context'>

const counts = new WeakMap<FramePage, {frames: number}>()

/** The frames attached in `page` since its main frame last navigated, counted from the first call for that page. */
export function framesSinceNavigation(page: FramePage): number {
  let count = counts.get(page)
  if (!count) {
    const counted = {frames: 0}
    page.on('frameattached', () => {
      counted.frames++
    })
    page.on('framenavigated', (frame: Frame) => {
      if (frame === page.mainFrame()) counted.frames = 0
    })
    counts.set(page, counted)
    count = counted
  }
  return count.frames
}

/** Whether `page`'s engine keeps the frames it removed until the page navigates (WebKit's does). */
export function keepsRemovedFrames(page: FramePage): boolean {
  return page.context().browser()?.browserType().name() === 'webkit'
}

/** Whether the stage in `page` should start over in a fresh document before it starts another renderer frame. */
export function stageNeedsFreshPage(page: FramePage): boolean {
  return framesSinceNavigation(page) >= framesPerStagePage && keepsRemovedFrames(page)
}
