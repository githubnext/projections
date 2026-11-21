import {readFileSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import type {Locator} from '@playwright/test'
import {compareWithComparator, extraction, openRenderer} from '@githubnext/projections-renderer-harness/playwright'

const declaration = (id: string, signature: string, kind = 'function') => ({id, kind, label: id, data: {signature}})
const before = extraction('api/v0', [
  declaration('hello', 'hello(): string'),
  declaration('parse', 'parse(text: string): Node'),
  declaration('legacy', 'legacy(): void'),
  declaration('stable', 'stable(): void'),
])
const after = extraction('api/v0', [
  declaration('hello', 'hello(name: string): string'),
  declaration('parse', 'tokenize(input: Buffer): Token[]'),
  declaration(
    'added',
    'added(options: {readonly verbose: boolean; readonly retries: number; readonly timeoutMilliseconds: number}): Promise<void>',
  ),
  declaration('stable', 'stable(): void'),
])
const signatures = (document: typeof before) =>
  document.entities.map(entity => [entity.id, String(entity.data!.signature)] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

/** Each row as a sighted reader sees it: the status in its footer and its signature lines, with the runs marked in them. */
function rows(root: Locator) {
  return root.evaluate(element =>
    [...element.querySelectorAll<HTMLElement>('[data-entity-id]')].map(row => ({
      id: row.dataset.entityId!,
      status: [...row.querySelectorAll('.api-declaration-footer .pk-status-part')].map(part => part.textContent),
      lines: [...row.querySelectorAll<HTMLElement>('pre')].map(
        pre => `${pre.className.replace('api-signature', '').trim() || 'plain'}:${pre.textContent.replace(/^[−+]/, '')}`,
      ),
      runs: [...row.querySelectorAll('del, ins, mark')].map(run => `${run.localName}:${run.textContent}`),
    })),
  )
}

const overflow = (root: Locator) => root.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const paint = (row: Locator) =>
  row.evaluate(element =>
    [element, ...element.querySelectorAll('*')]
      .map(node => {
        const style = getComputedStyle(node)
        return `${node.localName}:${style.color}|${style.backgroundColor}|${style.textDecorationLine}`
      })
      .join(';'),
  )

test('the diff lists every declaration once, with its status as text and inline signature changes', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'api', before, after, comparisonMode: 'diff'})
  const state = await renderer.state()
  expect(state.capabilities?.comparisonModes).toEqual(['side-by-side', 'diff'])
  expect(state.steps).toEqual([])
  const view = renderer.frame.locator('.api-view')
  expect(await rows(view)).toEqual([
    {id: 'added', status: ['Added'], lines: [`added:${after.entities[2]!.data!.signature}`], runs: []},
    {id: 'hello', status: ['Modified'], lines: ['plain:hello(name: string): string'], runs: ['ins:name: string']},
    {id: 'legacy', status: ['Removed'], lines: ['removed:legacy(): void'], runs: []},
    {id: 'parse', status: ['Modified'], lines: ['removed:parse(text: string): Node', 'added:tokenize(input: Buffer): Token[]'], runs: []},
    {id: 'stable', status: [], lines: ['plain:stable(): void'], runs: []},
  ])
  expect(await overflow(view)).toBeLessThanOrEqual(0)
  // Every row, unchanged ones too, reserves a footer of one height.
  const footers = await view
    .locator('.api-declaration-footer')
    .evaluateAll(nodes => [...new Set(nodes.map(node => node.getBoundingClientRect().height))])
  expect(footers).toHaveLength(1)
  await expect(view.locator('.api-declaration-footer')).toHaveCount(5)
  // The changed signature reads as both revisions to assistive technology.
  await expect(renderer.frame.locator('[data-entity-id="hello"] .sr-only')).toHaveText(
    'Signature changed from “hello(): string” to “hello(name: string): string”.',
  )
  // Change emphasis is tinted; an unchanged declaration is painted exactly as in an unchanged comparison.
  const tint = await renderer.frame.locator('[data-entity-id="legacy"] pre').evaluate(element => getComputedStyle(element).backgroundColor)
  expect(tint).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/)
  const stable = await paint(renderer.frame.locator('[data-entity-id="stable"]'))
  await openRenderer(page, {renderer: 'api', before: after, after, comparisonMode: 'diff'})
  expect(await paint(page.frameLocator('iframe').first().locator('[data-entity-id="stable"]'))).toBe(stable)
})

test('without highlighting the diff keeps its content and layout and drops only the change tint and status words', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'api', before, after, comparisonMode: 'diff', highlighting: 'off'})
  const view = renderer.frame.locator('.api-view')
  /** Background tints of signature lines and runs, status colors, and every row's and footer's box. */
  const tints = () =>
    view.evaluate(element => ({
      backgrounds: [...element.querySelectorAll('pre, del, ins, mark')]
        .map(node => getComputedStyle(node).backgroundColor)
        .filter(color => !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(color)),
      status: [...new Set([...element.querySelectorAll('.pk-status-part')].map(part => getComputedStyle(part).color))],
      boxes: [...element.querySelectorAll('[data-entity-id], .api-declaration-footer')].map(node => {
        const box = node.getBoundingClientRect()
        return [box.x, box.y, box.width, box.height].join()
      }),
    }))
  await expect(view).toHaveAttribute('data-highlighting', 'off')
  const quiet = await rows(view)
  expect(quiet.map(row => row.status)).toEqual([[], [], [], [], []])
  const off = await tints()
  expect(off).toMatchObject({backgrounds: [], status: []})
  // Changed runs keep a non-color cue either way: added runs underlined, removed runs struck.
  expect(
    await renderer.frame
      .locator('ins')
      .first()
      .evaluate(element => getComputedStyle(element).textDecorationLine),
  ).toBe('underline')

  await renderer.seek(1, {highlighting: 1})
  await expect(view).toHaveAttribute('data-highlighting', 'on')
  expect((await rows(view)).map(row => ({...row, status: []}))).toEqual(quiet)
  expect((await rows(view)).map(row => row.status)).toEqual([['Added'], ['Modified'], ['Removed'], ['Modified'], []])
  const emphasized = await tints()
  expect(emphasized.backgrounds.length).toBeGreaterThan(0)
  expect(emphasized.status.length).toBe(3)
  expect(emphasized.boxes, 'status words appear without moving anything').toEqual(off.boxes)
  expect(
    await renderer.frame
      .locator('ins')
      .first()
      .evaluate(element => getComputedStyle(element).textDecorationLine),
  ).toBe('underline')

  await renderer.seek(1, {highlighting: 'off'})
  await expect(view).toHaveAttribute('data-highlighting', 'off')
  expect((await tints()).backgrounds).toEqual([])
})

test('side-by-side panes list each revision; with highlighting each marks its own side', async ({page}) => {
  for (const [progress, document] of [
    [0, before],
    [1, after],
  ] as const) {
    const renderer = await openRenderer(page, {
      renderer: 'api',
      before,
      after,
      comparisonMode: 'side-by-side',
      progress,
      highlighting: 'off',
    })
    const view = renderer.frame.locator('.api-view')
    expect(await rows(view)).toEqual(
      signatures(document).map(([id, signature]) => ({id, status: [], lines: [`plain:${signature}`], runs: []})),
    )
    expect(await overflow(view)).toBeLessThanOrEqual(0)
  }
  const start = await openRenderer(page, {renderer: 'api', before, after, comparisonMode: 'side-by-side', progress: 0, highlighting: 1})
  expect(await rows(start.frame.locator('.api-view'))).toEqual([
    {id: 'hello', status: ['Modified'], lines: ['removed:hello(): string'], runs: []},
    {id: 'legacy', status: ['Removed'], lines: ['removed:legacy(): void'], runs: []},
    {id: 'parse', status: ['Modified'], lines: ['removed:parse(text: string): Node'], runs: []},
    {id: 'stable', status: [], lines: ['plain:stable(): void'], runs: []},
  ])
  const end = await openRenderer(page, {renderer: 'api', before, after, comparisonMode: 'side-by-side', progress: 1, highlighting: 1})
  const hello = (await rows(end.frame.locator('.api-view'))).find(row => row.id === 'hello')
  expect(hello).toEqual({id: 'hello', status: ['Modified'], lines: ['added:hello(name: string): string'], runs: ['mark:name: string']})
})

test('selecting a declaration reports it and reflects the host selection', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'api', before, after, comparisonMode: 'diff'})
  const button = renderer.frame.getByRole('button', {name: 'parse'})
  await button.click()
  await expect.poll(async () => (await renderer.state()).selections.at(-1)).toBe('parse')
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await renderer.select('legacy')
  await expect(renderer.frame.getByRole('button', {name: 'legacy'})).toHaveAttribute('aria-pressed', 'true')
  await expect(button).toHaveAttribute('aria-pressed', 'false')
})

test('an extraction lists declarations with no change decoration', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'api', extraction: after})
  const view = renderer.frame.locator('.api-view')
  expect(await rows(view)).toEqual(signatures(after).map(([id, signature]) => ({id, status: [], lines: [`plain:${signature}`], runs: []})))
  await expect(view.locator('.api-declaration-footer')).toHaveCount(0)
  expect(await overflow(view)).toBeLessThanOrEqual(0)
})

const renamedBefore = extraction('api/v0', [
  declaration('ClientOptions.retries', 'retries?: number', 'property'),
  declaration('fetchJson', 'export function fetchJson<T>(url: string): Promise<T>'),
  declaration('RequestConfiguration.maximumRedirectsBeforeFailing', 'maximumRedirectsBeforeFailing?: number', 'property'),
])
const renamedAfter = extraction('api/v0', [
  declaration('ClientOptions.retries', 'retries?: number | RetryPolicy', 'property'),
  {...declaration('getJson', 'export function getJson<T>(url: string, signal?: AbortSignal): Promise<T>'), previousIds: ['fetchJson']},
  declaration('RequestConfiguration.maximumRedirectsBeforeFailing', 'maximumRedirectsBeforeFailing?: number | null', 'property'),
])

/** Each declaration's name line as drawn: its name, whether it shows an ellipsis, and where its status parts sit against the row and the frame. */
function nameLines(root: Locator) {
  return root.evaluate(element =>
    [...element.querySelectorAll<HTMLElement>('.api-declaration')].map(row => {
      const name = row.querySelector<HTMLElement>('.entity-link')!
      const box = name.getBoundingClientRect(),
        frame = row.getBoundingClientRect()
      const footer = row.querySelector<HTMLElement>('.api-declaration-footer')!,
        text = footer.querySelector<HTMLElement>('.pk-status-text')
      return {
        id: row.dataset.entityId!,
        title: name.title,
        ellipsis: name.scrollWidth > name.clientWidth + 0.5,
        status: [...footer.querySelectorAll('.pk-status-part')].map(part => {
          const rect = part.getBoundingClientRect()
          return {
            text: part.textContent,
            belowName: rect.top >= box.bottom - 0.5,
            inside: rect.right <= Math.min(frame.right, document.documentElement.clientWidth) + 0.5 && rect.bottom <= frame.bottom + 0.5,
            whole: !text || text.scrollWidth <= text.clientWidth + 0.5,
          }
        }),
      }
    }),
  )
}

test('declaration names, IDs and signatures are drawn in the code font', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'api', before: renamedBefore, after: renamedAfter, comparisonMode: 'diff'})
  const {count, proportional} = await renderer.measure<{count: number; proportional: string[]}>('identifiers')
  expect(count).toBeGreaterThan(0)
  expect(proportional).toEqual([])
  const fonts = await renderer.frame.locator('[data-entity-id="getJson"]').evaluate(row => ({
    name: getComputedStyle(row.querySelector('.entity-link')!).fontFamily,
    previous: getComputedStyle(row.querySelector('.api-previous-label del')!).fontFamily,
    signature: getComputedStyle(row.querySelector('pre')!).fontFamily,
    status: getComputedStyle(row.querySelector('.pk-status-part')!).fontFamily,
  }))
  expect(fonts.name).toBe(fonts.signature)
  expect(fonts.previous).toBe(fonts.signature)
  expect(fonts.status).not.toBe(fonts.signature)
})

for (const [mode, width] of [
  ['diff', 390],
  ['diff', 480],
  ['side-by-side', 390],
  ['side-by-side', 480],
] as const) {
  test(`in a ${width}px ${mode} frame status stays whole in each row's footer and long names end in an ellipsis only without room`, async ({
    page,
  }) => {
    const renderer = await openRenderer(page, {
      renderer: 'api',
      before: renamedBefore,
      after: renamedAfter,
      comparisonMode: mode,
      progress: 1,
      highlighting: 1,
      width,
    })
    const lines = await nameLines(renderer.frame.locator('.api-view'))
    expect(lines.map(line => line.id).sort()).toEqual([
      'ClientOptions.retries',
      'RequestConfiguration.maximumRedirectsBeforeFailing',
      'getJson',
    ])
    for (const line of lines) {
      expect(line.status.length, line.id).toBeGreaterThan(0)
      for (const part of line.status) {
        expect(part, `${line.id} ${part.text}`).toEqual({text: part.text, belowName: true, inside: true, whole: true})
      }
    }
    expect(lines.find(line => line.id === 'getJson')!.status.map(part => part.text)).toEqual(['Renamed', 'Modified'])
    const long = lines.find(line => line.id === 'RequestConfiguration.maximumRedirectsBeforeFailing')!
    // With status in the footer the name has its line to itself; at 390px it still has no room and truncates.
    expect(long.title).toBe('RequestConfiguration.maximumRedirectsBeforeFailing')
    if (width === 390) expect(long.ellipsis).toBe(true)
    expect(await overflow(renderer.frame.locator('.api-view'))).toBeLessThanOrEqual(0)
  })
}

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8')) as typeof before

for (const [mode, width] of [
  ['diff', 1280],
  ['diff', 1100],
  ['side-by-side', 660],
] as const) {
  test(`in a ${width}px ${mode} frame the name column fits every name in full, status in each row's footer`, async ({page}) => {
    const renderer = await openRenderer(page, {
      renderer: 'api',
      before: fixture('http-client-v1'),
      after: fixture('http-client-v2'),
      comparisonMode: mode,
      progress: 1,
      highlighting: 1,
      width,
    })
    const lines = await nameLines(renderer.frame.locator('.api-view'))
    expect(lines.length).toBeGreaterThan(10)
    expect(lines.filter(line => line.ellipsis).map(line => line.id)).toEqual([])
    for (const line of lines) {
      for (const part of line.status) {
        expect(part, `${line.id} ${part.text}`).toEqual({text: part.text, belowName: true, inside: true, whole: true})
      }
    }
    const previous = await renderer.frame
      .locator('.api-previous-label [data-projections-identifier]')
      .evaluateAll(names => names.map(name => name.scrollWidth > name.clientWidth + 0.5))
    expect(previous).not.toContain(true)
  })
}

const compatibilityRules = new URL('../../../comparators/api-compatibility/api-compatibility.comparator.yaml', import.meta.url)

test('a classified comparison states compatibility as text, lists breaking changes first and filters to them', async ({page}) => {
  const [before, after] = [fixture('dotnet-before'), fixture('dotnet-after')]
  const comparison = await compareWithComparator(before, after, compatibilityRules)
  const renderer = await openRenderer(page, {renderer: 'api', before, after, comparison, comparisonMode: 'diff'})
  const view = renderer.frame.locator('.api-view')
  // The levels are the host's summary bar's facts, each filtering to its changes, with the rules that classified them.
  await expect(view.locator('.api-compatibility-counts, .pk-diff-summary')).toHaveCount(0)
  await expect
    .poll(async () =>
      ((await renderer.state()).summary ?? []).flatMap(item =>
        item.type === 'fact' ? [[item.id, item.count, item.ids?.length, item.description]] : [],
      ),
    )
    .toEqual([
      ['breaking', 8, 8, 'Rules: ApiCompat (default mode), reproduced'],
      ['additive', 8, 8, 'Rules: ApiCompat (default mode), reproduced'],
      ['compatible', 1, 1, 'Rules: ApiCompat (default mode), reproduced'],
    ])
  const levels = () =>
    view
      .locator('[data-entity-id]')
      .evaluateAll(rows => rows.map(row => row.querySelector('.api-compatibility')?.getAttribute('data-compatibility') ?? 'none'))
  const listed = await levels()
  expect(listed.slice(0, 8)).toEqual(Array(8).fill('breaking'))
  expect(listed.slice(8)).not.toContain('breaking')
  const breaking = view.locator('[data-entity-id]').first()
  await expect(breaking.locator('.api-compatibility')).toHaveText('Breaking')
  await expect(breaking.locator('.api-compatibility [data-icon="breaking"]')).toHaveAttribute('aria-hidden', 'true')
  await expect(breaking.locator('.api-compatibility-reason')).toBeVisible()
  // Code in reasons is marked by the comparator and drawn in the code font; prose stays sans.
  const pay = view.locator('[data-entity-id$="Payments.Client.Pay(System.Decimal,System.String)"] .api-compatibility-reason')
  await expect(pay).toHaveText('Source: Parameter currency was renamed to currencyCode, breaking named arguments')
  expect(
    await pay.evaluate(reason => ({
      code: [...reason.querySelectorAll('code[data-projections-identifier]')].map(code => [
        code.textContent,
        getComputedStyle(code).fontFamily,
      ]),
      prose: getComputedStyle(reason).fontFamily,
    })),
  ).toEqual({
    code: [
      ['currency', expect.stringMatching(/mono/i)],
      ['currencyCode', expect.stringMatching(/mono/i)],
    ],
    prose: expect.not.stringMatching(/mono/i),
  })
  expect(await overflow(view)).toBe(0)

  await renderer.setOptions({breakingOnly: true})
  await expect(view.locator('[data-entity-id]')).toHaveCount(8)
  expect(await levels()).toEqual(Array(8).fill('breaking'))
})
