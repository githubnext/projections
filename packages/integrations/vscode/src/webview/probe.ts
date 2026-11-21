// What the page drew, for tests (the `probe` control): from its first paint, whether the web Inspector's empty state
// ever showed and the loading indicators drawn; since the last reset, each distinct state it drew and its renderer
// frames' messages.

/**
 * From the page's first paint: whether the web Inspector's empty state ("No extraction loaded") ever showed, and the
 * loading indicators drawn (the most at once, the tallest, and how many samples saw one).
 */
const probe = {
  empty: false,
  most: 0,
  tallest: 0,
  seen: 0,
  firstPaint: undefined as number | undefined,
  skeleton: false,
  // The skeleton's toolbar strip: its height, and the most elements it ever held (none: no stand-ins for controls).
  strip: {height: undefined as number | undefined, elements: 0},
  // A page loaded hidden (its window occluded or minimized) paints nothing and samples nothing until shown.
  visibility: document.visibilityState,
}

/**
 * Since the last reset: each distinct state the page drew (sampled once a frame after anything changed), and the
 * renderer frames' messages by type (`ready` is a frame that loaded, `rendered` a render it acknowledged).
 */
interface Frame {
  t: number
  skeleton: boolean
  empty: boolean
  loading: number
  mode: string | null
  status: string | null
  comparison: string | null
  bar: string
}
const frames: Frame[] = []
const rendererMessages = new Map<string, number>()

/** What the page drew so far; `reset` starts its frames and renderer messages again. */
export function probeReport(reset: boolean) {
  const result = {...probe, frames: [...frames], renderer: Object.fromEntries(rendererMessages)}
  if (reset) {
    frames.length = 0
    rendererMessages.clear()
  }
  return result
}

/** The state the page draws now, with `loading` indicators shown. */
function drawn(loading: number): Frame {
  const view = document.querySelector('.phv-root')
  return {
    t: Math.round(performance.now()),
    skeleton: Boolean(document.querySelector('[data-skeleton]')),
    empty: Boolean(document.querySelector('#root .pi-empty, #root .ph-computing')),
    loading,
    mode: view?.getAttribute('data-mode') ?? null,
    status: view?.getAttribute('data-renderer-status') ?? null,
    comparison: view?.getAttribute('data-comparison-mode') ?? null,
    bar: (document.querySelector('[data-summary-bar]')?.textContent ?? '').trim().slice(0, 120),
  }
}

/** The loading indicators drawn now: visible, with a box. */
function shownIndicators(): Element[] {
  return [...document.querySelectorAll('[data-loading-indicator], vscode-progress-ring, .ph-loading-indicator')].filter(element => {
    const box = element.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && getComputedStyle(element).opacity !== '0'
  })
}

/** The first paint, the empty state and the skeleton and its toolbar strip, as drawn now. */
function sampleFirstStates() {
  if (!probe.empty && document.body?.textContent?.includes('No extraction loaded')) probe.empty = true
  probe.firstPaint ??= performance.getEntriesByName('first-contentful-paint')[0]?.startTime
  if (document.querySelector('[data-skeleton]')) probe.skeleton = true
  const strip = document.querySelector('[data-skeleton] .pj-skeleton-toolbar')
  if (strip) {
    probe.strip.height ??= strip.getBoundingClientRect().height
    probe.strip.elements = Math.max(probe.strip.elements, strip.querySelectorAll('*').length)
  }
}

/** Counts the renderer frames' messages, which they post to this window from their opaque origin. */
function countRendererMessages() {
  addEventListener('message', event => {
    const data = event.data as {projections?: unknown; type?: unknown} | null
    if (event.origin === 'null' && data?.projections !== undefined && typeof data.type === 'string') {
      rendererMessages.set(data.type, (rendererMessages.get(data.type) ?? 0) + 1)
    }
  })
}

/** Starts watching the page: once a frame after anything changed (and, for a while, every 100 ms). */
export function watchPage() {
  countRendererMessages()
  let pending = false
  let last = ''
  const record = (loading: number) => {
    const frame = drawn(loading)
    const key = JSON.stringify({...frame, t: 0})
    if (key === last) return
    last = key
    if (frames.length < 2000) frames.push(frame)
  }
  const sample = () => {
    pending = false
    sampleFirstStates()
    const shown = shownIndicators()
    record(shown.length)
    if (!shown.length) return
    probe.seen++
    probe.most = Math.max(probe.most, shown.length)
    probe.tallest = Math.max(probe.tallest, ...shown.map(element => element.getBoundingClientRect().height))
  }
  const schedule = () => {
    if (pending) return
    pending = true
    requestAnimationFrame(sample)
  }
  new MutationObserver(schedule).observe(document.documentElement, {subtree: true, childList: true, characterData: true, attributes: true})
  // The static page's bar appears by a CSS delay, not a mutation.
  const tick = setInterval(schedule, 100)
  setTimeout(() => clearInterval(tick), 30_000)
  schedule()
}
