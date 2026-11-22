import {test, expect, type Locator, type Page} from '@playwright/test'
import {projectorPalette as shadcnPalette, projectorSurfaces} from '../src/ui/lib/tokens.js'
import {closeMenus, inToolbar, openFilter, showAs, story} from './harness.js'

/**
 * dist/ui.css inside a page with hostile global styles (the tools/storybook/harness/host/embed.tsx story): neither side may restyle the other.
 * The page loads its CSS after ui.css, sets html to 10px and defines `--background`, `spin` and `enter` itself.
 */
const url = () => story('harness-default-ui--hostile-embedding')
type Mode = 'light' | 'dark'

const css = (locator: Locator, property: string, pseudo?: string) =>
  locator.evaluate((element, [name, pseudoElement]) => getComputedStyle(element, pseudoElement).getPropertyValue(name!), [
    property,
    pseudo,
  ] as const)

/** The browser's own serialization of a CSS color, for comparing against computed values. */
const resolveColor = (page: Page, color: string) =>
  page.evaluate(value => {
    const probe = document.createElement('i')
    probe.style.color = value
    document.body.append(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    return resolved
  }, color)

const channels = (name: keyof typeof shadcnPalette, mode: Mode) => shadcnPalette[name][mode === 'dark' ? 1 : 0]
const root = (page: Page, mode: Mode) => page.getByTestId(`${mode}-root`)
const serif = /(^|,)\s*"?serif"?\s*(,|$)/

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url())
  await expect(root(page, 'light').getByTestId('button')).toBeVisible()
  await expect(root(page, 'dark').getByTestId('button')).toBeVisible()
  // WebKit can mount before the stylesheet applies; `transition-colors` then animates from the browser defaults.
  await expect.poll(() => css(root(page, 'light'), 'font-size')).toBe('14px')
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(animation => animation instanceof CSSTransition)
        .map(animation => animation.finished.catch(() => undefined)),
    ),
  )
  return errors
}

test('the embedding page keeps its own styles', async ({page}) => {
  const errors = await open(page)
  const button = page.locator('#page-button')
  expect(await css(button, 'background-color')).toBe('rgb(255, 105, 180)')
  expect(await css(button, 'font-family')).toBe('serif')
  expect(await css(button, 'border-top-style')).toBe('dotted')
  expect(await css(button, 'margin-top')).toBe('7px')
  expect(await css(button, 'box-sizing')).toBe('content-box')
  expect(await css(page.locator('#page-table'), 'border-top-width')).toBe('3px')
  expect(await css(page.locator('#page-table td').first(), 'border-top-color')).toBe('rgb(0, 0, 255)')
  expect(await css(page.locator('#page-heading'), 'text-transform')).toBe('uppercase')
  expect(await css(page.locator('body'), 'font-size')).toBe('22px')
  expect(await css(page.locator('body'), 'color')).toBe('rgb(128, 0, 128)')
  expect(await css(page.locator('html'), 'font-size')).toBe('10px')
  expect((await css(page.locator('html'), '--background')).trim()).toBe('300 100% 50%')

  const spinner = page.locator('#page-spinner')
  expect(await css(spinner, 'animation-name')).toBe('spin')
  expect(
    await spinner.evaluate(element =>
      element.getAnimations().map(animation => [(animation as CSSAnimation).animationName, animation.playState]),
    ),
  ).toEqual([['spin', 'running']])

  // No token or other --pj- variable reaches the document.
  const leaked = await page.evaluate(
    names =>
      [document.documentElement, document.body].flatMap(element => {
        const style = getComputedStyle(element)
        return [...names.map(name => `--pj-${name}`), ...Array.from(style)].filter(
          name => name.startsWith('--pj-') && style.getPropertyValue(name) !== '',
        )
      }),
    Object.keys(shadcnPalette),
  )
  expect(leaked).toEqual([])

  // Only the page's own keyframes are unprefixed (Storybook's preview keeps its own `sb-` ones).
  const keyframes = await page.evaluate(() =>
    Array.from(document.styleSheets)
      .flatMap(sheet => Array.from(sheet.cssRules))
      .filter((rule): rule is CSSKeyframesRule => rule instanceof CSSKeyframesRule)
      .map(rule => rule.name),
  )
  expect(keyframes.filter(name => !name.startsWith('pj-') && !name.startsWith('sb-')).sort()).toEqual(['enter', 'spin'])
  expect(errors).toEqual([])
})

test('components inside .pj-root ignore the page styles', async ({page}) => {
  await open(page)
  const light = root(page, 'light')
  expect(await css(light, 'font-size')).toBe('14px')
  expect(await css(light, 'line-height')).toBe('21px')
  expect(await css(light, 'letter-spacing')).toBe('normal')
  expect(await css(light, 'color')).toBe(await resolveColor(page, channels('foreground', 'light')))
  expect(await css(light, 'font-family')).not.toMatch(serif)

  const button = light.getByTestId('button')
  expect(await css(button, 'background-color')).toBe(await resolveColor(page, channels('primary', 'light')))
  expect(await css(button, 'color')).toBe(await resolveColor(page, channels('primary-foreground', 'light')))
  expect(await css(button, 'margin-top')).toBe('0px')
  expect(await css(button, 'box-sizing')).toBe('border-box')
  // shadcn's button has a transparent 1px border; the page's 4px dotted border doesn't reach it.
  expect(await css(button, 'border-top-width')).toBe('1px')
  expect(await css(button, 'border-top-style')).toBe('solid')
  expect(await css(button, 'font-family')).not.toMatch(serif)
  expect(await css(button, 'font-size')).toBe('14px')
  // rem is compiled to px, so the page's 10px html font size does not shrink the UI.
  expect(await css(button, 'height')).toBe('36px')
  expect(await css(button, 'padding-left')).toBe('10px')
  expect(await css(button, 'border-top-left-radius')).toBe('8px')
  expect(await css(button, 'content', '::before')).not.toContain('»')

  const heading = light.getByTestId('heading')
  expect(await css(heading, 'text-transform')).toBe('none')
  expect(await css(heading, 'margin-top')).toBe('0px')
  expect(await css(heading, 'text-align')).toMatch(/^(start|left)$/)

  expect(await css(light.getByTestId('table'), 'border-top-width')).toBe('0px')
  const cell = light.getByTestId('cell')
  expect(await css(cell, 'border-left-width')).toBe('0px')
  expect(await css(cell, 'padding-left')).toBe('8px')
  // The card's own spacing, not the page's `div { padding: 3px }`.
  expect(await css(light.getByTestId('card'), 'padding-top')).toBe('24px')
  // Ring and shadow utilities compose `--tw-*` variables; the build's scoped defaults keep them valid.
  expect(await css(light.getByTestId('card'), 'box-shadow')).toMatch(/0px 0px 0px 1px/)
  expect(await css(light.getByTestId('badge'), 'font-size')).toBe('12px')

  const input = light.getByTestId('input')
  expect(['14px', '16px']).toContain(await css(input, 'font-size'))
  expect(await css(input, 'height')).toBe('36px')
  expect(await css(input, 'margin-top')).toBe('0px')

  // Page `svg { fill }` does not fill outline icons.
  expect(await css(light.getByTestId('checkbox').locator('svg'), 'fill')).toBe('none')
})

test('the dark root uses the dark tokens, and both match tokens.ts', async ({page}) => {
  await open(page)
  for (const mode of ['light', 'dark'] as const) {
    const scope = root(page, mode)
    expect(await css(scope.getByTestId('surface'), 'background-color')).toBe(await resolveColor(page, channels('background', mode)))
    expect(await css(scope.getByTestId('button'), 'background-color')).toBe(await resolveColor(page, channels('primary', mode)))
    const resolved = await scope.evaluate(
      (element, palette) =>
        Object.entries(palette).map(([name, values]) => {
          const token = document.createElement('span')
          const reference = document.createElement('span')
          token.style.color = `var(--pj-${name})`
          reference.style.color = values[element.classList.contains('pj-dark') ? 1 : 0]!
          element.append(token, reference)
          const result = [name, getComputedStyle(token).color, getComputedStyle(reference).color]
          token.remove()
          reference.remove()
          return result
        }),
      {...shadcnPalette, ...projectorSurfaces} as unknown as Record<string, readonly [string, string]>,
    )
    for (const [name, token, reference] of resolved) expect(token, `${mode} --pj-${name}`).toBe(reference)
  }
  // The `dark:` variant applies only under .pj-dark: the select trigger's `dark:bg-input/30`.
  const trigger = (mode: Mode) => css(root(page, mode).getByTestId('select-trigger'), 'background-color')
  expect(await trigger('dark')).toBe(
    await root(page, 'dark').evaluate(element => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'color-mix(in oklab, var(--pj-input) 30%, transparent)'
      element.append(probe)
      const value = getComputedStyle(probe).backgroundColor
      probe.remove()
      return value
    }),
  )
  expect(await trigger('light')).toBe('rgba(0, 0, 0, 0)')
})

for (const mode of ['light', 'dark'] as const) {
  test(`an open ${mode} select renders inside its scoped root with its styles`, async ({page}) => {
    await open(page)
    const scope = root(page, mode)
    const trigger = scope.getByTestId('select-trigger')
    await trigger.click()
    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()
    expect(await listbox.evaluate(element => element.closest('.pj-root')?.getAttribute('data-testid'))).toBe(`${mode}-root`)
    const content = page.getByTestId('select-content')
    expect(await content.evaluate(element => element.closest('[data-pj-portal]') !== null)).toBe(true)
    expect(await css(content, 'background-color')).toBe(await resolveColor(page, channels('popover', mode)))
    expect(await css(content, 'border-top-left-radius')).toBe('8px')
    expect(await css(content, 'font-family')).not.toMatch(serif)
    // Never the page's own `enter` keyframes (shadcn's item-aligned select doesn't animate).
    expect(await css(content, 'animation-name')).toMatch(/^(none|pj-.+)$/)
    const option = page.getByRole('option', {name: 'Table'})
    expect(await css(option, 'font-size')).toBe('14px')
    // Every item's text sits past the selected item's lens dot, which is on the left.
    expect(await css(option, 'padding-left')).toBe('28px')
    const selected = page.getByRole('option', {name: 'Graph'})
    expect(await css(selected.locator('span').first(), 'left')).toBe('8px')
    expect(await css(selected.locator('span').first(), 'background-color', '::before')).toBe(
      await resolveColor(page, channels('lens', mode)),
    )
    expect(await css(option, 'margin-top')).toBe('0px')
    await option.click()
    await expect(listbox).toBeHidden()
    await expect(trigger).toHaveText('Table')
  })
}

test('a toggle group spaces its items by its spacing', async ({page}) => {
  await open(page)
  for (const mode of ['light', 'dark'] as const) {
    // The default spacing, 2, is twice the 4px spacing unit (and px, not the page's 10px rem).
    const group = root(page, mode).locator('[data-slot="toggle-group"]')
    expect(await css(group, 'column-gap')).toBe('8px')
    const [first, second] = await group
      .locator('[data-slot="toggle-group-item"]')
      .evaluateAll(items => items.map(item => item.getBoundingClientRect()))
    expect(second!.left - first!.right).toBeCloseTo(8, 1)
  }
})

test('a tooltip renders inside its scoped root', async ({page}) => {
  await open(page)
  const scope = root(page, 'light')
  await scope.getByTestId('tooltip-trigger').focus()
  const tooltip = page.getByTestId('tooltip')
  await expect(tooltip).toBeVisible()
  expect(await tooltip.evaluate(element => element.closest('.pj-root')?.getAttribute('data-testid'))).toBe('light-root')
  expect(await css(tooltip, 'background-color')).toBe(await resolveColor(page, channels('foreground', 'light')))
  expect(await css(tooltip, 'font-size')).toBe('12px')
})

test('the default ProjectionView keeps its styles inside the page and leaks none', async ({page}) => {
  await open(page)
  const view = page.locator('.ph')
  await expect(view).toHaveAttribute('data-view', 'table')
  expect(await view.evaluate(element => element.classList.contains('pj-root'))).toBe(true)
  const settings = await inToolbar(view, scope => scope.getByRole('button', {name: 'Settings', exact: true}))
  expect(await css(settings, 'font-family')).not.toMatch(serif)
  expect(await css(settings, 'border-top-style')).not.toBe('dotted')
  expect(await css(settings, 'background-color')).not.toBe('rgb(255, 105, 180)')
  expect(await css(view.locator('.ph-show-as-chip'), 'font-family')).not.toMatch(serif)
  const search = await openFilter(view)
  await expect(search).toBeVisible()
  // On narrow toolbars the field opens in a popover that may remount it once; read the settled field.
  await expect.poll(() => css(search, 'font-size')).toMatch(/^1[46]px$/)
  await expect.poll(() => css(search, 'height')).toBe('32px')
  const cell = view.locator('tr[data-row-id="checkout"] td').first()
  expect(await css(cell, 'border-left-width')).toBe('0px')
  expect(await css(view.getByRole('heading', {name: 'Embedded projection'}), 'text-transform')).toBe('none')
  // The filter's popover (on a phone) closes first, so the next Escape is the card's.
  await closeMenus(view)
  await view.getByRole('button', {name: 'Payments', exact: true}).click()
  // The detail card names the selected entity, and closes with Escape.
  await expect(view.locator('[data-detail-card]')).toContainText('Payments')
  await page.keyboard.press('Escape')
  await expect(view.locator('[data-detail-card]')).toHaveCount(0)
  await showAs(view, 'Text')
  await expect(view.locator('.ph-text-view')).toContainText('2 entities')
  // The page's own elements are untouched after the UI has rendered and been used.
  expect(await css(page.locator('#page-button'), 'background-color')).toBe('rgb(255, 105, 180)')
  expect(await css(page.locator('#page-heading'), 'text-transform')).toBe('uppercase')
})
