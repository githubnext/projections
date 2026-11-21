import {test as base, expect} from '@playwright/test'
import type {Page} from '@playwright/test'
import {badgeIconNames, iconNames} from '@githubnext/projections-renderer-sdk/protocol'
import type {IconName} from '@githubnext/projections-renderer-sdk/protocol'
import {categories, findingLabels} from '../../../packages/renderers/runtime-policy/src/model.js'
import type {Theme} from './smoke.spec.js'

const test = base.extend<{theme: Theme}>({theme: ['light', {option: true}]})

const outlineIconNames = iconNames.filter(name => !badgeIconNames.includes(name))
/** Each story, and the icons each of its panels shows: every SDK icon, or the icons of each renderer group. */
const stories = ['default-ui', 'vs-code-ui'].flatMap(ui => [
  {id: `${ui}-icons--badges`, names: badgeIconNames},
  {id: `${ui}-icons--other-icons`, names: outlineIconNames},
  {
    id: `${ui}-icons--in-renderers`,
    groups: {
      'Subjects (runtime policy renderer)': categories.map(category => category.icon),
      'Findings (runtime policy renderer)': findingLabels.map(finding => finding.icon),
    },
  },
])

interface Drawn {
  name: string
  /** Where the icon is drawn: a size cell, the card footer, the SVG card or the summary bar. */
  where: string
  /** The image layers it is masked with: the glyph, and a badge's disc. */
  layers: number
  /** Whether the kit draws it in its status color (the text color for `unchanged`); the summary bar has its own tones. */
  colored: boolean
}

/**
 * The icon stories show every icon the SDK defines in every panel, each drawn from its theme token: by the kit's `Icon`
 * (a CSS mask) at each size and in a card footer, by its `SvgIcon` (an SVG mask) on an SVG card, and by the host's
 * summary bar. A badge is its disc with the glyph cut out (two mask layers), any other icon its glyph alone, and the
 * kit draws each in its status color from the panel's tokens.
 */
for (const story of stories) {
  test(`${story.id} draws each icon from its token in every theme`, async ({page, theme}) => {
    await page.goto(new URL(`iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme}`, process.env.PROJECTIONS_STORYBOOK_URL).href)
    const panels = page.locator('[data-icon-panel]')
    await expect(panels.first()).toBeVisible()
    expect(await panels.count()).toBeGreaterThanOrEqual(2)
    for (const panel of await panels.all()) {
      const shown = (scope: string) =>
        panel.locator(`${scope} [data-gallery-icon]`).evaluateAll(rows => rows.map(row => row.getAttribute('data-gallery-icon')))
      if (story.names) expect((await shown('')).sort()).toEqual([...story.names].sort())
      for (const [group, names] of Object.entries(story.groups ?? {})) expect(await shown(`[data-gallery-group="${group}"]`)).toEqual(names)
    }
    // SvgIcon resolves its layers after mounting.
    await expect(page.locator('.pk-svg-icon:not(:has(rect))')).toHaveCount(0)
    const drawn = await page.locator('[data-gallery-icon]').evaluateAll((rows): Drawn[] => {
      const urls = (value: string) => value.match(/url\(/g)?.length ?? 0
      const probe = document.createElement('span')
      const resolved = (row: Element, value: string) => {
        row.querySelector('th')!.append(probe)
        probe.style.color = value
        const color = getComputedStyle(probe).color
        probe.remove()
        return color
      }
      return rows.flatMap(row => {
        const name = row.getAttribute('data-gallery-icon')!
        const status = row.getAttribute('data-gallery-status')!
        // The kit draws replace neutral, gray beside any status word (its diff.css).
        const token = name === 'replace' ? 'fg-muted' : status === 'unchanged' ? 'fg' : status === 'renamed' ? 'moved' : status
        const expected = resolved(row, `var(--projections-color-${token})`)
        // The summary bar draws each figure twice, once unseen for measuring, and a fact in its own tone. SvgIcon is below.
        const css = [...row.querySelectorAll('[data-icon]')]
          .filter(element => !element.closest('[data-summary-measure]') && !element.matches('.pk-svg-icon'))
          .map(element => {
            const style = getComputedStyle(element)
            const size = element.closest('[data-gallery-size]')?.getAttribute('data-gallery-size')
            const where = element.closest('[data-summary-figure]') ? 'summary bar' : size ? `${size}px` : 'card footer'
            const colored = where === 'summary bar' || style.backgroundColor === expected
            return {name, where, layers: urls(style.maskImage || style.webkitMaskImage), colored}
          })
        const svg = [...row.querySelectorAll('.pk-svg-icon')].map(group => ({
          name,
          where: 'SVG card',
          layers: group.querySelectorAll('mask image').length,
          colored: getComputedStyle(group.querySelector('rect')!).fill === expected,
        }))
        return [...css, ...svg]
      })
    })
    // Four sizes, the card footer, the SVG card and the summary bar, for every row of every panel.
    expect(drawn.length).toBe((await page.locator('[data-gallery-icon]').count()) * 7)
    expect(drawn.filter(icon => icon.layers !== (badgeIconNames.includes(icon.name as IconName) ? 2 : 1))).toEqual([])
    expect(drawn.filter(icon => !icon.colored)).toEqual([])
  })
}

/** Every computed style of the story's page: the document, the body and each element the story rendered. */
const pageStyles = (page: Page) =>
  page.evaluate(() =>
    [document.documentElement, document.body, ...document.querySelectorAll('#storybook-root *')].map(element => {
      const style = getComputedStyle(element)
      return `${element.tagName} ${[...style].map(name => `${name}:${style.getPropertyValue(name)}`).join(';')}`
    }),
  )

/** The document's style rules, in order. */
const pageRules = (page: Page) =>
  page.evaluate(() =>
    [...document.styleSheets].flatMap(sheet => {
      try {
        return [...sheet.cssRules].map(rule => rule.cssText)
      } catch {
        return [`${sheet.href ?? 'inline'} (unreadable)`]
      }
    }),
  )

/** Switches the preview to another story without reloading it, as the Storybook manager does. */
async function showStory(page: Page, storyId: string, rendered: string) {
  await page.evaluate(
    id =>
      (
        window as unknown as {__STORYBOOK_PREVIEW__: {onSetCurrentStory: (selection: object) => Promise<void>}}
      ).__STORYBOOK_PREVIEW__.onSetCurrentStory({storyId: id, viewMode: 'story'}),
    storyId,
  )
  await expect(page.locator(`#storybook-root ${rendered}`).first()).toBeVisible()
}

/**
 * The icon stories' styles (the kit's stylesheet among them) apply only while an icon story is shown: a story shown
 * after one in the same preview, as when browsing Storybook, has the same style rules and renders exactly as it did.
 */
const neighbours = [
  {id: 'default-ui-components--buttons', rendered: 'button', icons: 'default-ui-icons--badges'},
  {id: 'vs-code-ui-building-blocks--menus-and-range', rendered: 'input[type="range"]', icons: 'vs-code-ui-icons--in-renderers'},
]
for (const neighbour of neighbours) {
  test(`${neighbour.id} renders the same after ${neighbour.icons} in the same preview`, async ({page, theme}) => {
    await page.goto(
      new URL(`iframe.html?id=${neighbour.id}&viewMode=story&globals=theme:${theme}`, process.env.PROJECTIONS_STORYBOOK_URL).href,
    )
    await expect(page.locator(`#storybook-root ${neighbour.rendered}`).first()).toBeVisible()
    const [rules, before] = [await pageRules(page), await pageStyles(page)]
    await showStory(page, neighbour.icons, '[data-icon-panel]')
    await expect(page.locator('#storybook-root .pk-change-footer').first()).toHaveCSS('display', 'flex')
    await showStory(page, neighbour.id, neighbour.rendered)
    const after = await pageStyles(page)
    expect((await pageRules(page)).filter(rule => !rules.includes(rule))).toEqual([])
    expect(after.length).toBe(before.length)
    expect(after.filter((style, index) => style !== before[index])).toEqual([])
  })
}
