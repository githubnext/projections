import {expect, test} from '@playwright/test'
import {checkScenario} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

/**
 * A renderer frame is a sandboxed, out-of-process document, so the host's resize reaches it only some time after the
 * host applies it, and on a loaded machine later than the renderer waits before acknowledging its paint. The checks
 * must then measure the frame once it has its height, not the paint placed for the height before: a graph opened
 * scrolled in its short loading frame would otherwise seem to move with change status. Here every height the host
 * gives a renderer frame takes effect 1.5 s late.
 */
test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
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
            get: (target, key) => {
              const value = Reflect.get(target, key, target)
              return typeof value === 'function' ? value.bind(target) : value
            },
            set: (target, key, value) => {
              if (key === 'height' && /^\d+px$/.test(String(value))) setTimeout(() => Reflect.set(target, key, value, target), 1500)
              else Reflect.set(target, key, value, target)
              return true
            },
          })
          proxies.set(real, proxy)
        }
        return proxy
      },
    })
  })
})

test('checks measure a frame at its height even when the resize reaches the renderer late', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'One host timing case, in desktop Chromium.')
  test.slow()
  const [result] = await checkScenario(page, harnessInspector(), 'graph/npm-react-update', {checks: ['stable-layout']})
  expect(result!.details).toEqual([])
  expect(result!.status).toBe('pass')
})
