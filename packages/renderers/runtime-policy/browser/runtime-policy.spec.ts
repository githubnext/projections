import {readFileSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import type {Page} from '@playwright/test'
import type {Comparison, Extraction} from '@githubnext/projections-schemas'
import {compare, compareWithComparator, openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import type {RendererHandle} from '@githubnext/projections-renderer-harness/playwright'

const fixture = (name: string): Extraction =>
  JSON.parse(readFileSync(new URL(`../../../extractors/tetragon-policies/tests/fixtures/${name}`, import.meta.url), 'utf8'))
const before = fixture('credentials/before.expected.json')
const after = fixture('credentials/after.expected.json')
const monitor = fixture('credentials/monitor.expected.json')
const library = fixture('library/expected.json')
const comparator = new URL('../../../comparators/runtime-policy/runtime-policy.comparator.yaml', import.meta.url)
const guard = 'selector:tetragon:TracingPolicy:protect-credentials/kprobe:security_file_permission/token-read-by-downloader'
const curl = 'subject:binary:exact:%2Fusr%2Fbin%2Fcurl'

/** Every unit's box, checked for overlap and sideways overflow. */
async function layout(renderer: RendererHandle) {
  const read = await renderer.frame.locator('.rp-view').evaluate(view => ({
    units: [...view.querySelectorAll<HTMLElement>('.rp-row')].map(unit => {
      const box = unit.getBoundingClientRect()
      return {id: unit.dataset.entityId ?? unit.className, top: box.top, bottom: box.bottom, left: box.left, right: box.right}
    }),
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
  }))
  const sorted = [...read.units].sort((a, b) => a.top - b.top)
  for (let index = 1; index < sorted.length; index++) {
    expect(sorted[index]!.top, `${sorted[index]!.id} overlaps ${sorted[index - 1]!.id}`).toBeGreaterThanOrEqual(
      sorted[index - 1]!.bottom - 0.5,
    )
  }
  expect(read.overflow, 'horizontal overflow').toBe(false)
  return read
}

/**
 * The first character of every line the status column and meta lines draw, as laid out: a separator must sit between
 * items, never lead a wrapped or stacked line.
 */
async function lineStarts(renderer: RendererHandle) {
  return renderer.frame.locator('.rp-view').evaluate(view => {
    const starts: string[] = []
    for (const block of view.querySelectorAll<HTMLElement>('.rp-status-text > *, .rp-meta, .rp-hook > .rp-select')) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
      let bottom: number | undefined
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest('.sr-only')) continue
        const text = node.textContent ?? ''
        for (let index = 0; index < text.length; index++) {
          if (!text[index]!.trim()) continue
          const range = document.createRange()
          range.setStart(node, index)
          range.setEnd(node, index + 1)
          const box = range.getClientRects()[0]
          if (!box || !box.width) continue
          // A character on a new line sits wholly below the one before it; characters of one line overlap.
          if (bottom === undefined || box.top >= bottom - 0.5) starts.push(`${text[index]}${text.slice(index + 1, index + 12)}`)
          bottom = box.bottom
        }
      }
    }
    return starts
  })
}

/** The facts the renderer sends the host's summary bar, as the bar words them, with their changes. */
async function facts(renderer: RendererHandle) {
  const sent = (await renderer.state()).summary ?? []
  return sent.flatMap(item =>
    item.type === 'fact'
      ? [
          `${item.count} ${item.count === 1 ? item.noun.singular : item.noun.plural}${item.added ? ` +${item.added}` : ''}${item.removed ? ` −${item.removed}` : ''}`,
        ]
      : [],
  )
}

async function open(
  page: Page,
  request: {before: Extraction; after: Extraction; comparison: Comparison; mode: 'diff' | 'before' | 'after'},
) {
  return openRenderer(page, {
    renderer: 'runtime-policy',
    before: request.before,
    after: request.after,
    comparison: request.comparison,
    ...(request.mode === 'diff'
      ? {comparisonMode: 'diff' as const}
      : {comparisonMode: 'side-by-side' as const, progress: request.mode === 'before' ? 0 : 1}),
  })
}

test('the diff draws each rule once, with interpretations, without overlap or overflow', async ({page}) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const comparison = await compareWithComparator(before, after, comparator)
  const renderer = await open(page, {before, after, comparison, mode: 'diff'})
  const state = await renderer.state()
  expect(state.bundle).toBe('runtime-policy')
  expect(state.capabilities?.comparisonModes).toEqual(['side-by-side', 'diff'])
  const view = await layout(renderer)
  expect(view.units.filter(unit => unit.id === guard)).toHaveLength(1)
  // The security summary is the host's summary bar's: the view draws none.
  await expect(renderer.frame.locator('.pk-diff-summary')).toHaveCount(0)
  await expect
    .poll(() => facts(renderer))
    .toEqual(['1 enforcing rule +1', '1 newly enforced', '1 scope broadened', '1 hook no longer covered'])
  const rule = renderer.frame.locator(`[data-entity-id="${guard}"]`)
  // Status is a stack of icon-led lines, each with its own icon, read as one sentence.
  await expect(rule.locator('.rp-status-text > *')).toHaveText(['Added', 'Newly enforced'])
  await expect(rule.locator('.rp-status-text > * > [data-icon]:first-child')).toHaveCount(2)
  await expect(rule.locator('.rp-status .sr-only')).toHaveText('Added, newly enforced')
  await expect(rule.locator('.rp-effect')).toHaveText('Kill (Sigkill)')
  const removed = renderer.frame.locator('[data-entity-id="hook:kprobe:security_mmap_file"]')
  await expect(removed.locator('> .rp-hook > .rp-status .rp-status-text > *')).toHaveText(['Removed', 'No longer covered'])
  // The removed lane's rows inherit its mark, so its status column shows no heading; a lane with its own changes does.
  await expect(removed.locator('> .rp-head > .rp-status > span')).toHaveCSS('visibility', 'hidden')
  await expect(renderer.frame.locator('[data-entity-id="hook:kprobe:security_file_permission"] > .rp-head > .rp-status > span')).toHaveCSS(
    'visibility',
    'visible',
  )
  const starts = await lineStarts(renderer)
  expect(starts.length).toBeGreaterThan(0)
  expect(
    starts.filter(start => /^[·•|,;—–]/.test(start)),
    'a line starts with a separator',
  ).toEqual([])
  await renderer.iframe.screenshot({path: test.info().outputPath('diff.png')})
  expect(errors).toEqual([])
})

test('the default comparator still marks every change, with old and new values', async ({page}) => {
  const comparison = await compare(after, monitor)
  const renderer = await open(page, {before: after, after: monitor, comparison, mode: 'diff'})
  await layout(renderer)
  // Without the runtime policy comparator there are no findings: only the enforcing rules, one fewer.
  await expect.poll(() => facts(renderer)).toEqual(['0 enforcing rules −1'])
  const rule = renderer.frame.locator(`[data-entity-id="${guard}"]`)
  await expect(rule.locator('del.rp-old')).toHaveText('Kill (Sigkill)')
  await expect(rule.locator('ins.rp-new')).toHaveText('Kill (Sigkill) (elided in monitor mode)')
  await expect(rule.locator('.rp-status-text > *')).toHaveText(['Modified'])
  await expect(rule.locator('.rp-interpretation')).toHaveCount(0)
})

test('side-by-side panes each draw one revision, without change marks at the endpoints', async ({page}) => {
  const comparison = await compareWithComparator(before, after, comparator)
  const left = await open(page, {before, after, comparison, mode: 'before'})
  await layout(left)
  await expect(left.frame.locator('[data-entity-id="hook:kprobe:security_mmap_file"]')).toHaveCount(1)
  await expect(left.frame.locator(`[data-entity-id="${guard}"]`)).toHaveCount(0)
  await expect(left.frame.locator('.rp-sign')).toHaveCount(0)
  await expect(left.frame.locator('.pk-status-text:visible')).toHaveCount(0)
  const right = await open(page, {before, after, comparison, mode: 'after'})
  await layout(right)
  await expect(right.frame.locator('[data-entity-id="hook:kprobe:security_mmap_file"]')).toHaveCount(0)
  await expect(right.frame.locator(`[data-entity-id="${guard}"]`)).toHaveCount(1)
})

test('rules and subjects are separate selection buttons for click and keyboard', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'runtime-policy', extraction: after})
  const rule = renderer.frame.locator(`[data-entity-id="${guard}"] > button.rp-select`)
  await rule.click()
  await expect.poll(async () => (await renderer.state()).selections.at(-1)).toBe(guard)
  await expect(rule).toHaveAttribute('aria-pressed', 'true')
  const chip = renderer.frame.locator(`button[data-entity-id="${curl}"]`)
  await chip.focus()
  await chip.press('Enter')
  await expect.poll(async () => (await renderer.state()).selections.at(-1)).toBe(curl)
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect(rule).toHaveAttribute('aria-pressed', 'false')
  await expect(renderer.frame.locator('.pk-change-footer')).toHaveCount(0)
})

test('a policy library is a coverage map grouped by what each hook observes', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'runtime-policy', extraction: library})
  await layout(renderer)
  await expect(renderer.frame.locator('.pk-group-title')).toHaveText([
    'Policies',
    'Credentials',
    'Network',
    'Kernel modules',
    'User space',
    'Other',
  ])
  await expect(renderer.frame.locator('.rp-effect', {hasText: 'elided in monitor mode'})).toHaveCount(2)
  await renderer.iframe.screenshot({path: test.info().outputPath('library.png')})
})

test('deployment facts: agent, kernels, warnings and the policies covering each workload', async ({page}) => {
  const deployment = (name: string) => fixture(`deployment/${name}.expected.json`)
  const [before, after] = [deployment('before'), deployment('after')]
  const comparison = await compareWithComparator(before, after, comparator)
  const renderer = await open(page, {before, after, comparison, mode: 'diff'})
  await layout(renderer)
  const frame = renderer.frame
  await expect(frame.locator('.pk-group-title')).toContainText(['Agent and kernels', 'Policies', 'Workloads'])
  await expect(frame.locator('.pk-group-icon > [data-icon]').first()).toHaveAttribute('data-icon', 'host')
  await expect(frame.locator('.pk-group-icon > [data-icon]').nth(2)).toHaveAttribute('data-icon', 'workload')
  const agent = frame.locator('[data-entity-id="agent:tetragon"]')
  await expect(agent.locator('del.rp-old')).toHaveText('policy filter on')
  await expect(agent.locator('ins.rp-new')).toHaveText('policy filter off')
  await expect(agent.locator('.rp-status')).toContainText('Configuration changed')
  const guard = frame.locator('[data-entity-id="policy:tetragon:TracingPolicyNamespaced:payments:shell-guard"]')
  await expect(guard.locator('.rp-warning').first()).toContainText("The repository's CRD rejects this policy")
  await expect(frame.locator('[data-entity-id="hook:kprobe:tcp_connect"] .rp-warning')).toHaveText(
    /Unavailable on general: tcp_connect is not a kernel symbol there\./,
  )
  const web = frame.locator('[data-entity-id="workload:StatefulSet:checkout:checkout-web"]')
  await expect(web.locator('.rp-chip.added.filled')).toContainText('protect-credentials')
  await expect(web.locator('.rp-chip.unchanged')).toContainText('egress-audit')
  await expect.poll(() => facts(renderer)).toContain('1 agent configuration changed')
  await renderer.iframe.screenshot({path: test.info().outputPath('deployment.png')})
})

test('panels clip their rows to their corners, rows are divided, and a removed lane is marked once', async ({page}) => {
  const comparison = await compareWithComparator(before, after, comparator)
  const renderer = await open(page, {before, after, comparison, mode: 'diff'})
  const read = await renderer.frame.locator('.rp-view').evaluate(view => {
    const style = (selector: string) => getComputedStyle(view.querySelector(selector)!)
    const lane = view.querySelector<HTMLElement>('[data-entity-id="hook:kprobe:security_mmap_file"]')!
    const transparent = (value: string) => value === 'rgba(0, 0, 0, 0)' || value === 'transparent'
    return {
      // The kit's group clips to its outer edge, so a change region at its edge draws over its border: with
      // `overflow: clip` and its border as the margin where the browser has that margin, else a clip path.
      group: [
        style('.pk-group').clipPath.startsWith('inset(') ||
          (style('.pk-group').overflow === 'clip' && style('.pk-group').getPropertyValue('overflow-clip-margin') !== '0px'),
        style('.pk-group').borderTopLeftRadius,
      ],
      // The line between two rows is the upper one's.
      divided: [...view.querySelectorAll<HTMLElement>('.rp-rules > .rp-row:has(+ .rp-row)')].every(
        row => getComputedStyle(row).borderBottomWidth !== '0px',
      ),
      lane: [lane.dataset.change, transparent(getComputedStyle(lane).backgroundColor)],
      inherited: [...lane.querySelectorAll<HTMLElement>('.rp-row[data-entity-id]')].map(row => [
        row.dataset.change ?? '',
        transparent(getComputedStyle(row).backgroundColor),
      ]),
      code: [...view.querySelectorAll('.rp-condition .pk-code')].map(code => code.textContent),
    }
  })
  expect(read.group).toEqual([true, '8px'])
  expect(read.divided).toBe(true)
  expect(read.lane).toEqual(['removed', false])
  expect(read.inherited).toEqual([
    ['', true],
    ['', true],
  ])
  for (const code of ['arg0', 'file', '/root/.ssh', '/home', '/var/run/secrets/kubernetes.io/serviceaccount', '10.0.0.0/8', '127.0.0.1']) {
    expect(read.code).toContain(code)
  }
})

test('each section is a titled panel: its title in the UI font in a band inside its edge, then its table', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'runtime-policy', extraction: library})
  await layout(renderer)
  const read = await renderer.frame.locator('.rp-view').evaluate(view => {
    const ui = getComputedStyle(view).fontFamily
    return {
      panels: [...view.querySelectorAll<HTMLElement>(':scope > .pk-group')].map(panel => {
        const box = panel.getBoundingClientRect()
        const header = panel.querySelector<HTMLElement>(':scope > .pk-group-header')!
        const band = header.getBoundingClientRect()
        const title = header.querySelector<HTMLElement>('.pk-group-label')!
        const table = panel.querySelector<HTMLElement>(':scope > .rp-table')!.getBoundingClientRect()
        const border = parseFloat(getComputedStyle(panel).borderTopWidth)
        // The subject's icon leads the title at the band's inset, muted, centred on the title's capitals: the cap
        // height's middle is above the baseline by half the font's E ascent, and the baseline is the text box's top
        // plus the font's ascent.
        const icon = header.querySelector<HTMLElement>('.pk-group-icon > [data-icon]')!
        const glyph = icon.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(title)
        const context = document.createElement('canvas').getContext('2d')!
        context.font = getComputedStyle(title).font
        const metrics = context.measureText('E')
        const baseline = range.getClientRects()[0]!.top + metrics.fontBoundingBoxAscent
        const cap = baseline - metrics.actualBoundingBoxAscent / 2
        // The first shown main cell: phones hide the column headers.
        const cell = [...panel.querySelectorAll<HTMLElement>('.rp-main')].find(main => main.getBoundingClientRect().width > 0)!
        return {
          title: title.textContent,
          icon: [
            icon.dataset.icon,
            icon.getAttribute('aria-hidden'),
            Boolean(icon.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING),
          ],
          muted: getComputedStyle(icon).color === getComputedStyle(view.querySelector('.rp-head > .rp-cell')!).color,
          centred: Math.abs((glyph.top + glyph.bottom) / 2 - cap),
          inset: Math.abs(glyph.left - (cell.getBoundingClientRect().left + parseFloat(getComputedStyle(cell).paddingLeft))),
          // The band is the panel's first row, inside its edge, and the table follows it, reaching the panel's sides.
          banded: Math.abs(band.top - box.top - border) < 0.5 && band.left >= box.left && band.right <= box.right,
          table:
            table.top >= band.bottom - 0.5 &&
            Math.abs(table.left - box.left - border) < 0.5 &&
            Math.abs(box.right - border - table.right) < 0.5,
          font: getComputedStyle(title).fontFamily === ui && !title.hasAttribute('data-projections-identifier'),
        }
      }),
      // Within each hook's lane, its header row comes first, then its column headers (hidden on phones), then its rules.
      lanes: [...view.querySelectorAll<HTMLElement>('.rp-lane')].map(lane => {
        const [hook, head, first] = [...lane.children].map(child => child.getBoundingClientRect())
        const shown = head!.height > 0
        return shown ? hook!.bottom <= head!.top + 0.5 && head!.bottom <= first!.top + 0.5 : hook!.bottom <= first!.top + 0.5
      }),
    }
  })
  expect(read.panels.map(panel => panel.title)).toEqual(['Policies', 'Credentials', 'Network', 'Kernel modules', 'User space', 'Other'])
  expect(read.panels.map(panel => panel.icon[0])).toEqual(['policy', 'credential', 'network', 'module', 'application', 'other'])
  for (const panel of read.panels) {
    expect(panel, panel.title ?? '').toMatchObject({banded: true, table: true, font: true, muted: true})
    expect(panel.icon.slice(1), panel.title ?? '').toEqual(['true', true])
    expect(panel.centred, `${panel.title} icon centred on its capitals`).toBeLessThan(0.75)
    expect(panel.inset, `${panel.title} icon at the band's inset`).toBeLessThan(0.5)
  }
  expect(read.lanes).toHaveLength(9)
  expect(read.lanes.every(Boolean)).toBe(true)
})
