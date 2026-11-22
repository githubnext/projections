import {expect, test, type Page} from '@playwright/test'
import {checkScenario, openStage} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

/**
 * A renderer frame is a sandboxed, out-of-process document, so the host's resize reaches it only some time after the
 * host applies it, and on a loaded machine later than the renderer waits before acknowledging its paint. The checks
 * must then measure the frame once it has its height, not the paint placed for the height before: a graph opened
 * scrolled in its short loading frame would otherwise seem to move with change status. Here every height the host
 * gives a renderer frame takes effect late: 1.5 s, and 10 s, well past the 5 s a measurement once waited before it measured
 * the frame at its old height anyway.
 */
async function delayResizes(page: Page, delay: number): Promise<void> {
  await page.addInitScript(lateMs => {
    const style = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style')!
    const proxies = new WeakMap<CSSStyleDeclaration, CSSStyleDeclaration>()
    Object.defineProperty(HTMLElement.prototype, 'style', {
      ...style,
      get(this: HTMLElement) {
        const real = style.get!.call(this) as CSSStyleDeclaration
        if (!(this instanceof HTMLIFrameElement)) return real
        let proxy = proxies.get(real)
        if (!proxy) {
          proxy = new Proxy(real, {
            get: (target, key): unknown => {
              const value: unknown = Reflect.get(target, key, target)
              return typeof value === 'function' ? value.bind(target) : value
            },
            set: (target, key, value) => {
              if (key === 'height' && /^\d+px$/u.test(String(value))) {
                setTimeout(() => {
                  Reflect.set(target, key, value, target)
                }, lateMs)
              } else Reflect.set(target, key, value, target)
              return true
            },
          })
          proxies.set(real, proxy)
        }
        return proxy
      },
    })
  }, delay)
}

for (const delay of [1500, 10_000]) {
  test(`checks measure a frame at its height even when the resize reaches the renderer ${delay / 1000} s late`, async ({page}, info) => {
    test.skip(info.project.name !== 'chromium-desktop', 'One host timing case, in desktop Chromium.')
    test.slow()
    await delayResizes(page, delay)
    const [result] = await checkScenario(page, harnessInspector(), 'graph/npm-react-update', {checks: ['stable-layout']})
    expect(result!.details).toEqual([])
    expect(result!.status).toBe('pass')
  })
}

/**
 * A renderer frame that is slow to reach a rendering opportunity (a loaded machine) observes resizes late, while its
 * paint acknowledgement falls back to a timer (see `afterPaint`). Here every `ResizeObserver` callback in the renderer's
 * frame comes `delay` ms late.
 */
async function delayResizeObservations(page: Page, delay: number): Promise<void> {
  await page.addInitScript(lateMs => {
    if (window === window.top) return
    const Observer = window.ResizeObserver
    window.ResizeObserver = class extends Observer {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          setTimeout(() => callback(entries, observer), lateMs)
        })
      }
    }
  }, delay)
}

test('a content-sized renderer asks for its height before it acknowledges its first paint, however late it observes resizes', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'One host timing case, in desktop Chromium.')
  await delayResizeObservations(page, 5000)
  const stage = await openStage(page, harnessInspector(), {scenario: 'graph/npm-react-update', comparisonMode: 'diff'})
  // A load resolves at the first acknowledged paint: the height must be known by then, or a check measures the frame
  // at the height it has before the renderer asks for one (and `Stage.arrived` has nothing to wait for).
  const {height} = await stage.state()
  expect(height).toBeGreaterThan(0)
  await stage.measure('settle')
  const {height: inner} = await stage.measure<{height: number}>('viewport')
  expect(Math.abs(inner - height!)).toBeLessThanOrEqual(1)
})

test('a measurement waits for the frame to arrive at its height however late, never measuring it at the height before', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'One host timing case, in desktop Chromium.')
  test.slow()
  await delayResizes(page, 10_000)
  const stage = await openStage(page, harnessInspector(), {scenario: 'graph/npm-react-update', comparisonMode: 'diff'})
  await stage.measure('settle')
  const [{height: inner}, {height: asked}] = await Promise.all([stage.measure<{height: number}>('viewport'), stage.state()])
  expect(asked).toBeGreaterThan(0)
  expect(Math.abs(inner - asked!)).toBeLessThanOrEqual(1)
})
