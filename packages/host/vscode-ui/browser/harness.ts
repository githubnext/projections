import type {Locator, Page} from '@playwright/test'

/**
 * The pages this suite drives are the Storybook "VS Code UI" stories, served from the static build by
 * tools/storybook/scripts/serve.mjs with a production-like page policy and the renderer policy on renderer bundles.
 */
const base = () => process.env.PROJECTIONS_STORYBOOK_URL!

/** The captured VS Code themes (packages/host/vscode-ui/fixtures/themes), in the Storybook theme switcher's order. */
export const themes = ['dark-modern', 'light-modern', 'dark-high-contrast', 'light-high-contrast', 'solarized-dark', 'dark-2026'] as const
export type ThemeId = (typeof themes)[number]

/** A VS Code UI story (`vs-code-ui-<group>--<story>`) in a VS Code theme, with Storybook args (`key:value;…`). */
export const story = (id: string, theme: ThemeId = 'dark-modern', args = '') =>
  new URL(`iframe.html?id=vs-code-ui-${id}&viewMode=story&globals=vscodeTheme:${theme}${args ? `&args=${args}` : ''}`, base()).href

/** Waits until the view's renderer is ready and the toolbar keeps one layout step for a moment. */
export async function ready(page: Page) {
  await page.locator('.phv-root[data-renderer-status="ready"]').first().waitFor()
  let previous: string | null = null
  for (let round = 0, stable = 0; round < 40 && stable < 3; round++) {
    const step = await page.locator('.phv-toolbar').first().getAttribute('data-step')
    stable = step === previous ? stable + 1 : 0
    previous = step
    await page.waitForTimeout(50)
  }
}

/** The deepest focused element through open shadow roots: its tag, its role and its accessible label. */
export const focused = (page: Page) =>
  page.evaluate(() => {
    let active = document.activeElement
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
    const host = (active?.getRootNode() as ShadowRoot | Document) instanceof ShadowRoot ? (active!.getRootNode() as ShadowRoot).host : null
    return {
      tag: active?.tagName.toLowerCase(),
      host: host?.tagName.toLowerCase(),
      role: active?.getAttribute('role'),
      label: active?.getAttribute('aria-label') ?? active?.textContent.trim(),
      outline: active ? getComputedStyle(active).outlineColor : undefined,
      outlineWidth: active ? getComputedStyle(active).outlineWidth : undefined,
      focusId: host?.getAttribute('data-focus-id') ?? active?.getAttribute('data-focus-id'),
    }
  })

/** The WCAG contrast of two computed CSS colors (`rgb()`/`rgba()`, `background` composited on `base`). */
export function contrast(foreground: string, background: string, base = 'rgb(255, 255, 255)'): number {
  const parse = (value: string) => {
    const parts = value.match(/[\d.]+/g)!.map(Number)
    return {r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1}
  }
  const over = (top: ReturnType<typeof parse>, bottom: ReturnType<typeof parse>) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  })
  const back = over(parse(background), parse(base))
  const front = over(parse(foreground), back)
  const luminance = (color: {r: number; g: number; b: number}) =>
    [color.r, color.g, color.b]
      .map(channel => channel / 255)
      .map(value => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0)
  const [high, low] = [luminance(front), luminance(back)].sort((a, b) => b - a) as [number, number]
  return (high + 0.05) / (low + 0.05)
}

/** An element's color, and the background behind it: every translucent layer out to the first opaque one, composited. */
export const colors = (locator: Locator) =>
  locator.evaluate(element => {
    const parse = (value: string) => {
      const parts = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]
      return {r: parts[0]!, g: parts[1]!, b: parts[2]!, a: value.startsWith('rgba') ? parts[3]! : 1}
    }
    const layers: ReturnType<typeof parse>[] = []
    for (let node: Element | null = element; node; node = node.parentElement ?? (node.getRootNode() as Partial<ShadowRoot>).host ?? null) {
      const layer = parse(getComputedStyle(node).backgroundColor)
      if (layer.a > 0) layers.push(layer)
      if (layer.a >= 1) break
    }
    let base = {r: 255, g: 255, b: 255}
    for (const layer of layers.reverse()) {
      base = {
        r: layer.r * layer.a + base.r * (1 - layer.a),
        g: layer.g * layer.a + base.g * (1 - layer.a),
        b: layer.b * layer.a + base.b * (1 - layer.a),
      }
    }
    return {color: getComputedStyle(element).color, background: `rgb(${base.r}, ${base.g}, ${base.b})`}
  })
