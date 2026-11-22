import {expect, test} from '@playwright/test'
import type {FrameLocator} from '@playwright/test'
import {openRenderer, samples} from '@githubnext/projections-renderer-harness/playwright'
import {readFileSync} from 'node:fs'
import {after, before, indexes} from '../test/fixtures.mjs'
import {arrowContacts, contactIssues} from '../../kit/browser/invariants/contacts.js'
import {paintedScales, recordPaintedScales} from '../../kit/browser/painted-scales.js'

interface Box {
  id: string
  x: number
  y: number
  width: number
  height: number
  opacity: number
}

/** Cards and links as drawn, in canvas coordinates, with the opacity a viewer sees. */
async function geometry(frame: FrameLocator) {
  return frame.locator('.database-view').evaluate(view => {
    const canvas = view.querySelector('.database-canvas')
    const origin = canvas?.getBoundingClientRect() ?? {x: 0, y: 0, width: 0, height: 0}
    const tables = [...view.querySelectorAll<HTMLElement>('.database-table')].map(element => {
      const box = element.getBoundingClientRect()
      return {
        id: element.dataset.entityId!,
        x: box.x - origin.x,
        y: box.y - origin.y,
        width: box.width,
        height: box.height,
        opacity: Number(getComputedStyle(element).opacity),
      }
    })
    const links = [...view.querySelectorAll<SVGGElement>('[data-link-key]')].map(group => {
      const [x, y] = (
        group
          .querySelector('path.database-link')!
          .getAttribute('d')!
          .match(/-?[\d.]+/gu) ?? []
      )
        .slice(0, 2)
        .map(Number)
      return {key: group.dataset.linkKey!, x: x!, y: y!, opacity: Number(group.getAttribute('opacity'))}
    })
    const tags = [...view.querySelectorAll<HTMLElement>('.database-tags > .database-tag-slot')].map(element => {
      const box = element.getBoundingClientRect()
      return {
        id: element.querySelector<HTMLElement>('[data-entity-id]')!.dataset.entityId!,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        opacity: Number(getComputedStyle(element).opacity),
      }
    })
    return {
      tables,
      links,
      tags,
      width: origin.width,
      height: origin.height,
      badges: view.querySelectorAll('.pk-status-text').length,
      tinted: [...view.querySelectorAll<HTMLElement>('.database-tag')].filter(tag => Number(tag.style.getPropertyValue('--emphasis')) > 0)
        .length,
    }
  })
}
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5
const tableIds = (extraction: typeof before) =>
  extraction.entities
    .filter(entity => entity.kind === 'table')
    .map(entity => entity.id)
    .sort()

test('in a frame sized to its content, the schema paints at one scale from its first paint while the host grows the frame', async ({
  page,
}) => {
  await recordPaintedScales(page, '.database-content')
  // At phone width the schema is taller than the frame before the host answers its height: fitting that would open it
  // at the text floor, then jump to the width's fit once the frame grows.
  const renderer = await openRenderer(page, {renderer: 'database', before, after, progress: 0, width: 390})
  const {height, scales} = await paintedScales(page, renderer.frame)
  expect(height).toBeGreaterThan(480)
  expect(scales).toEqual(['1'])
})

test('scrubbing a new table forward and back keeps cards apart, links attached and endpoints neutral', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'database', before, after, progress: 0})
  const first = await geometry(renderer.frame)
  // Dense around the middle, where the default order makes room and brings the table in.
  const progresses = [...new Set([...samples(40), ...samples(100).filter(value => value > 0.3 && value < 0.8)])].sort((a, b) => a - b)
  for (const sequence of [progresses, [...progresses].reverse()]) {
    await renderer.scrub(sequence, async progress => {
      const frame = await geometry(renderer.frame)
      expect(frame.width, 'framing is stable').toBeCloseTo(first.width, 0)
      expect(frame.height, 'framing is stable').toBeCloseTo(first.height, 0)
      const visible = frame.tables.filter(table => table.opacity > 0.01)
      for (const [index, a] of visible.entries()) {
        for (const b of visible.slice(index + 1)) {
          expect(overlaps(a, b), `${a.id} overlaps ${b.id} at ${progress}`).toBe(false)
        }
      }
      for (const link of frame.links) {
        const dependent = `table:${link.key.replace(/^column:/u, '').split('.')[0]}`
        const card = frame.tables.find(table => table.id === dependent)!
        expect(card, `link ${link.key} has its card at ${progress}`).toBeTruthy()
        expect(
          Math.min(Math.abs(link.x - card.x), Math.abs(link.x - card.x - card.width)),
          `link ${link.key} leaves its card at ${progress}`,
        ).toBeLessThan(1.5)
        expect(link.y).toBeGreaterThan(card.y)
        expect(link.y).toBeLessThan(card.y + card.height)
        expect(link.opacity).toBeLessThanOrEqual(card.opacity + 1e-6)
      }
      if (progress === 0 || progress === 1) {
        expect(frame.badges, `no status text at ${progress}`).toBe(0)
        expect(frame.tinted, `no tag tints at ${progress}`).toBe(0)
        expect(visible.map(table => table.id).sort()).toEqual(tableIds(progress === 0 ? before : after))
        expect(frame.tables.every(table => table.opacity === 1)).toBe(true)
      }
    })
  }
  await renderer.seek(0.5)
  expect((await geometry(renderer.frame)).badges, 'changes are stated mid-transition').toBeGreaterThan(0)
  const state = await renderer.state()
  expect(state.capabilities).toMatchObject({changeHighlighting: 'supported'})
  expect(state.controls.map(control => [control.id, control.type])).toEqual([
    ['zoom-out', 'action'],
    ['zoom-fit', 'action'],
    ['zoom-in', 'action'],
    ['showRelationships', 'toggle'],
  ])
  expect(state.steps.length).toBeGreaterThan(0)
})

test('relationships can be hidden by the host, and selection flows both ways', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'database', extraction: after})
  await expect(renderer.frame.locator('.database-link')).toHaveCount(5)
  await renderer.setOptions({showRelationships: false})
  await expect(renderer.frame.locator('.database-link')).toHaveCount(0)
  await expect(renderer.frame.locator('.database-table')).toHaveCount(5)
  await renderer.setOptions({showRelationships: true})
  await expect(renderer.frame.locator('.database-link')).toHaveCount(5)

  await renderer.frame.locator('[data-entity-id="column:Invoices.CustomerId"]').click()
  await expect.poll(async () => (await renderer.state()).selections.at(-1)).toBe('column:Invoices.CustomerId')
  await expect(renderer.frame.locator('[data-entity-id="column:Invoices.CustomerId"]')).toHaveClass(/selected/u)
  await expect(renderer.frame.locator('.database-link.selected')).toHaveCount(1)
  await renderer.select('table:Users')
  await expect(renderer.frame.locator('section[data-entity-id="table:Users"]')).toHaveClass(/selected/u)
  // An index is a row of its table: its button selects it from the keyboard.
  await renderer.frame.locator('[data-entity-id="index:IX_Users_Email"] button').press('Enter')
  await expect.poll(async () => (await renderer.state()).selections.at(-1)).toBe('index:IX_Users_Email')
  await expect(renderer.frame.locator('[data-entity-id="index:IX_Users_Email"]')).toHaveClass(/selected/u)
  await renderer.frame.locator('[data-entity-id="index:IX_Users_Email"]').press('Escape')
  await expect.poll(async () => (await renderer.state()).selections.at(-1)).toBe(null)
})

test('the legacy schema renderer name resolves to this bundle and narrow frames stack the cards', async ({page}, testInfo) => {
  const renderer = await openRenderer(page, {renderer: 'schema', before, after, progress: 1})
  expect((await renderer.state()).bundle).toBe('database')
  const narrow = (page.viewportSize()?.width ?? 1000) < 600
  await expect(renderer.frame.locator('.database-view')).toHaveAttribute('data-layout', narrow ? 'stack' : 'columns')
  const overflow = await renderer.frame.locator('body').evaluate(body => body.scrollWidth - body.clientWidth)
  expect(overflow, `no page-level horizontal overflow on ${testInfo.project.name}`).toBeLessThanOrEqual(0)
})

test('tags make room, rename and arrive without overlapping', async ({page}) => {
  const a = indexes([
    ['index:IX_Old', 'IX_Old'],
    ['index:IX_B', 'IX_B'],
  ])
  const b = indexes([
    ['index:IX_New', 'IX_NewLongerName', 'index:IX_Old'],
    ['index:IX_B', 'IX_B'],
    ['index:IX_C', 'IX_C'],
  ])
  const renderer = await openRenderer(page, {renderer: 'database', before: a, after: b, progress: 0})
  await renderer.scrub(samples(50, {roundTrip: true}), async progress => {
    const {tags} = await geometry(renderer.frame)
    const visible = tags.filter(tag => tag.opacity > 0.01)
    for (const [index, x] of visible.entries()) {
      for (const y of visible.slice(index + 1)) {
        expect(overlaps(x, y), `${x.id} overlaps ${y.id} at ${progress}`).toBe(false)
      }
    }
    if (progress === 0) expect(visible.map(tag => tag.id).sort()).toEqual(['index:IX_B', 'index:IX_New'])
    if (progress === 1) expect(visible.map(tag => tag.id).sort()).toEqual(['index:IX_B', 'index:IX_C', 'index:IX_New'])
  })
  await renderer.seek(1)
  await expect(renderer.frame.getByRole('button', {name: 'IX_NewLongerName'})).toBeVisible()
})

test('keys and indexes are rows of their own tables, single-column keys are column markers, and an enum is a card of its values', async ({
  page,
}) => {
  const {readFile} = await import('node:fs/promises')
  const load = async (name: string) => JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
  const renderer = await openRenderer(page, {
    renderer: 'database',
    before: await load('prisma-shop-before'),
    after: await load('prisma-shop-after'),
    progress: 0,
  })
  const read = () =>
    renderer.frame.locator('.database-view').evaluate(view => ({
      tags: view.querySelectorAll('.database-tags .database-tag-slot').length,
      cards: [...view.querySelectorAll<HTMLElement>('.database-table')].map(card => ({
        id: card.dataset.entityId!,
        keys: [...card.querySelectorAll<HTMLElement>('.database-keyrow')].map(
          row => `${row.querySelector('.database-key [aria-hidden]')?.textContent} ${row.querySelector('button')?.textContent}`,
        ),
        markers: [...card.querySelectorAll<HTMLElement>('.database-marker')].map(marker => marker.dataset.entityId!),
        values: [...card.querySelectorAll<HTMLElement>('.database-value-name')].map(value => value.textContent),
        box: (() => {
          const box = card.getBoundingClientRect()
          return {left: box.left, right: box.right, top: box.top, bottom: box.bottom}
        })(),
        rows: [...card.querySelectorAll<HTMLElement>('.database-column')].map(row => {
          const box = row.getBoundingClientRect()
          // Arriving rows fade in as their card opens (the card clips them); settled rows always fit.
          return {top: box.top, bottom: box.bottom, visible: Number(getComputedStyle(row).opacity) > 0.99}
        }),
      })),
    }))
  for (const progress of samples(24, {roundTrip: true})) {
    await renderer.seek(progress)
    const {tags, cards} = await read()
    expect(tags, `nothing floats free of its table at ${progress}`).toBe(0)
    for (const card of cards) {
      for (const row of card.rows.filter(settled => settled.visible)) {
        expect(
          row.top >= card.box.top - 0.5 && row.bottom <= card.box.bottom + 0.5,
          `${card.id}'s settled rows stay inside it at ${progress}`,
        ).toBe(true)
      }
    }
  }
  await renderer.seek(1)
  const {cards} = await read()
  const card = (id: string) => cards.find(item => item.id === id)!
  expect(card('table:/OrderLine').keys).toContain('PK orderId, productId')
  expect(card('table:/Order').keys).toContain('IX customerId, status')
  expect(card('table:/Customer').keys).toContain('UK email')
  // The single-column primary keys and foreign keys are their columns' markers.
  expect(card('table:/Customer').markers.some(id => id.includes('primary-key'))).toBe(true)
  expect(card('table:/OrderLine').markers.filter(id => id.includes('foreign-key'))).toHaveLength(2)
  expect(card('enum:OrderStatus').values).toEqual(['PENDING', 'PAID', 'SHIPPED', 'CANCELLED', 'REFUNDED'])
  await expect(renderer.frame.locator('section[data-entity-id="enum:OrderStatus"] .database-kind')).toHaveText('enum')
  // A marker selects the constraint it stands for.
  const marker = renderer.frame.locator('section[data-entity-id="table:/Customer"] .database-marker').first()
  const id = await marker.getAttribute('data-entity-id')
  await marker.click()
  await expect.poll(async () => (await renderer.state()).selections.at(-1)).toBe(id)
  await expect(marker).toHaveClass(/selected/u)
})

test('keys of no table wrap centered and balanced, with no holes', async ({page}) => {
  const tags = Array.from(
    {length: 11},
    (_, index) => [`index:IX_${index}`, `IX_Loose_${'x'.repeat(index % 4)}${index}`] as [string, string],
  )
  const renderer = await openRenderer(page, {renderer: 'database', before: indexes(tags.slice(0, 7)), after: indexes(tags), progress: 0})
  for (const progress of samples(20, {roundTrip: true})) {
    await renderer.seek(progress)
    const lines = await renderer.frame.locator('.database-tags').evaluate(room => {
      const gap = parseFloat(getComputedStyle(room).columnGap)
      const origin = room.getBoundingClientRect()
      const slots = [...room.querySelectorAll<HTMLElement>(':scope > .database-tag-slot')]
        .filter(slot => getComputedStyle(slot).visibility !== 'hidden')
        .map(slot => {
          const box = slot.getBoundingClientRect()
          return {x: box.x - origin.x, y: Math.round(box.y - origin.y), width: box.width}
        })
      const rows = [...new Set(slots.map(slot => slot.y))].sort((a, b) => a - b)
      return {
        width: origin.width,
        gap,
        lines: rows.map(y =>
          slots
            .filter(slot => slot.y === y)
            .sort((a, b) => a.x - b.x)
            .map(slot => [slot.x, slot.width]),
        ),
      }
    })
    for (const line of lines.lines) {
      // No holes: neighbours sit one gap apart; the line is centered in the room.
      for (let index = 1; index < line.length; index++) {
        expect(line[index]![0]! - (line[index - 1]![0]! + line[index - 1]![1]!), `no hole at ${progress}`).toBeCloseTo(lines.gap, 0)
      }
      const left = line[0]![0]!,
        right = lines.width - (line.at(-1)![0]! + line.at(-1)![1]!)
      expect(Math.abs(left - right), `centered at ${progress}`).toBeLessThan(2)
    }
  }
})

test('table, column, type and key names are monospace; status stays whole in its reserved cell', async ({page}) => {
  const ledger = 'ReconciliationLedgerEntriesArchivedForQuarterlySettlement'
  const reference = 'ExternalSettlementReferenceIdentifierFromUpstreamClearingHouse'
  const schema = (columns: {id: string; label: string; type: string; previousIds?: string[]}[]) => ({
    protocolVersion: 0 as const,
    schema: 'database/v0' as const,
    entities: [
      {id: 'table:Ledger', kind: 'table', label: ledger},
      ...columns.map(({id, label, type, previousIds}) => ({
        id,
        kind: 'column',
        label,
        data: {type, nullable: false},
        ...(previousIds ? {previousIds} : {}),
      })),
      {id: 'index:IX_Ledger_Reference', kind: 'index', label: 'IX_Ledger_Reference'},
    ],
    relationships: columns.map(({id}) => ({id: `contains:${id}`, kind: 'contains', from: 'table:Ledger', to: id})),
  })
  const ledgerBefore = schema([
    {id: 'column:Ledger.Id', label: 'Id', type: 'uuid'},
    {id: 'column:Ledger.Reference', label: reference, type: 'character varying(64)'},
    {id: 'column:Ledger.Amount', label: 'Amount', type: 'numeric(12,2)'},
  ])
  const ledgerAfter = schema([
    {id: 'column:Ledger.Id', label: 'Id', type: 'uuid'},
    {id: 'column:Ledger.Reference', label: reference, type: 'character varying(128)'},
    {
      id: 'column:Ledger.AmountMinor',
      label: 'AmountInMinorCurrencyUnitsForSettlement',
      type: 'bigint',
      previousIds: ['column:Ledger.Amount'],
    },
  ])
  const renderer = await openRenderer(page, {renderer: 'database', before: ledgerBefore, after: ledgerAfter, progress: 0})
  let stated = 0
  await renderer.scrub(samples(20), async progress => {
    const rows = await renderer.frame.locator('.database-table').evaluate(table => {
      const card = table.getBoundingClientRect()
      return [...table.querySelectorAll<HTMLElement>('.database-row')].flatMap(row => {
        const name = row.querySelector<HTMLElement>('.entity-link')!
        const line = name.getBoundingClientRect()
        return [...row.querySelectorAll<HTMLElement>('.pk-status-text')]
          .filter(text => Number(text.style.opacity) > 0.05)
          .map(text => {
            const box = text.getBoundingClientRect()
            return {
              name: name.textContent,
              inside: box.left >= card.left - 0.5 && box.right <= card.right + 0.5 && text.scrollWidth <= text.clientWidth + 0.5,
              // A long name wraps: its status sits on the name's first line.
              sameLine: Math.abs((box.top + box.bottom) / 2 - (line.top + Math.min(line.height, 16) / 2)) < 4,
            }
          })
      })
    })
    stated += rows.length
    for (const row of rows) {
      expect(row.inside, `${row.name}'s status is whole inside its card at ${progress}`).toBe(true)
      expect(row.sameLine, `${row.name}'s status is on its line at ${progress}`).toBe(true)
    }
  })
  expect(stated, 'the transition states changes').toBeGreaterThan(0)
  await renderer.seek(0.5)
  const measured = await renderer.measure<{count: number; proportional: string[]}>('identifiers')
  expect(measured.count).toBeGreaterThanOrEqual(5)
  expect(measured.proportional).toEqual([])
  for (const text of [ledger, reference]) {
    // Data is shown whole: a name too long for the card wraps at its case boundaries; it never ellipsizes.
    const name = renderer.frame.locator('.entity-link[data-projections-identifier]', {hasText: text})
    await expect(name).toHaveText(text)
    const shape = await name.evaluate(element => ({
      fits: element.scrollWidth <= element.clientWidth + 1,
      ellipsis: getComputedStyle(element).textOverflow === 'ellipsis',
      lines: Math.round(element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight)),
    }))
    expect(shape.fits && !shape.ellipsis, `${text} is whole`).toBe(true)
    expect(shape.lines, `${text} wraps`).toBeGreaterThan(1)
  }
  await expect(renderer.frame.locator('.database-column code[data-projections-identifier]', {hasText: 'uuid'})).toBeVisible()
  await expect(renderer.frame.getByRole('button', {name: 'IX_Ledger_Reference'}).locator('.database-tag-name')).toHaveAttribute(
    'data-projections-identifier',
    '',
  )
  await expect(
    renderer.frame.locator('.database-kind[data-projections-identifier], .database-key [data-projections-identifier]'),
  ).toHaveCount(0)
})

test('status appears in reserved space: nothing moves with highlighting, and every emphasized change names itself', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'database', before, after, progress: 0})
  const boxes = () =>
    renderer.frame.locator('.database-view').evaluate(view =>
      [
        ...view.querySelectorAll<HTMLElement>(
          '[data-entity-id], .entity-link, .database-column code, .database-tags > .database-tag-slot .database-tag-name',
        ),
      ].map(element => {
        const box = element.getBoundingClientRect()
        return `${element.dataset.entityId ?? element.className}:${box.x},${box.y},${box.width},${box.height}`
      }),
    )
  const statuses = () =>
    renderer.frame.locator('.database-view').evaluate(view =>
      [
        ...view.querySelectorAll<HTMLElement>(
          '.database-tags > .database-tag-slot > .database-tag, .database-column, .database-table > header',
        ),
      ].map(element => ({
        id: element.dataset.entityId ?? element.parentElement!.dataset.entityId!,
        // Tags state status in the tab hanging off the pill; headers and rows in their reserved cell.
        text: element.querySelector('.pk-status-tab, .pk-status-text')?.textContent ?? '',
        tinted: Number(element.style.getPropertyValue('--emphasis') || 0) > 0.5,
      })),
    )
  for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
    await renderer.seek(progress, {highlighting: 1})
    const on = await boxes()
    const shown = await statuses()
    await renderer.seek(progress, {highlighting: 0})
    expect(await boxes(), `nothing moves with highlighting at ${progress}`).toEqual(on)
    if (progress === 0 || progress === 1) {
      await renderer.seek(progress, {highlighting: 'auto'})
      expect(
        (await statuses()).filter(item => item.text),
        `no status text at ${progress}`,
      ).toEqual([])
    }
    // A tinted tag always says why.
    for (const tag of shown.filter(item => item.tinted)) {
      expect(tag.text, `${tag.id} states its status at ${progress}`).toMatch(/Added|Removed|Modified|Renamed/u)
    }
  }
  const state = await renderer.state()
  let named = 0
  for (const end of state.steps.filter(value => value > 0 && value < 1)) {
    await renderer.seek(end, {highlighting: 1})
    named += (await statuses()).filter(item => /^(?:Added|Removed|Modified|Renamed)/u.test(item.text)).length
  }
  expect(named, 'steps state their changes as icon and word').toBeGreaterThan(0)
})

test("a column row's status is a two-character icon cell, so names and types keep nearly all their room", async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'database', before, after, progress: 0})
  const end = (await renderer.state()).steps.filter(value => value > 0 && value < 1)[0]!
  await renderer.seek(end, {highlighting: 1})
  const measured = await renderer.frame.locator('.database-view').evaluate(view =>
    [...view.querySelectorAll<HTMLElement>('.database-column')].map(row => {
      const cell = row.querySelector<HTMLElement>('.database-glyph')!
      const ch = (() => {
        const probe = document.createElement('span')
        probe.textContent = '0'.repeat(10)
        cell.append(probe)
        const width = probe.getBoundingClientRect().width / 10
        probe.remove()
        return width
      })()
      return {
        id: row.dataset.entityId!,
        room: cell.getBoundingClientRect().width + parseFloat(getComputedStyle(row).columnGap),
        ch,
        glyph: [...cell.querySelectorAll('[data-change-status] [data-icon]')].map(icon => icon.getAttribute('data-icon')).join(' '),
        title: cell.title,
        word: cell.querySelector('.sr-only')?.textContent ?? '',
      }
    }),
  )
  expect(measured.length).toBeGreaterThan(0)
  for (const row of measured) {
    // Two characters and the row's gap: all a type gives up for its status.
    expect(row.room, `${row.id}'s glyph cell`).toBeLessThanOrEqual(2 * row.ch + 8.5)
    if (row.glyph) {
      expect([row.glyph, row.title, row.word], `${row.id} shows its icon and keeps the word`).toEqual([
        expect.stringMatching(/^(added|removed|modified|renamed)$/u),
        row.title,
        row.title,
      ])
    }
    if (row.glyph) expect(row.title).toMatch(/Added|Removed|Modified|Renamed/u)
  }
  expect(measured.filter(row => row.glyph).map(row => `${row.glyph} ${row.title}`)).toContain('added Added')
  // Headers keep the visible word: the new table names itself once its step has run.
  const headers: string[] = []
  for (const step of (await renderer.state()).steps.filter(value => value > 0 && value < 1)) {
    await renderer.seek(step, {highlighting: 1})
    headers.push(...(await renderer.frame.locator('.database-table > header .pk-status-text').allTextContents()))
  }
  expect(headers).toContain('Added')
})

test('every name, type, key and value shows whole in every scenario and mode (animated and diff), at full, narrow-column and phone width: nothing overflows or is clipped', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const {readFile} = await import('node:fs/promises')
  const read = async (path: string) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'))
  const load = async (value: unknown) => (typeof value === 'string' ? read(value) : value)
  const {scenarios} = (await read('scenarios.json')) as {scenarios: {id: string; before?: unknown; after?: unknown; extraction?: unknown}[]}
  let checked = 0
  for (const scenario of scenarios)
  // 1000px is where four ranks of cards sit side by side at their narrowest, which once ellipsized names.
  {
    for (const width of [1440, 1000, 390]) {
      await page.setViewportSize({width: width + 80, height: 1000})
      const subject = scenario.extraction
        ? {extraction: await load(scenario.extraction)}
        : {before: await load(scenario.before), after: await load(scenario.after)}
      // Animated (Before, every step, After) and, for a comparison, the diff: one static union with every change marked.
      for (const comparisonMode of scenario.extraction ? [undefined] : [undefined, 'diff' as const]) {
        const renderer = await openRenderer(page, {
          renderer: 'database',
          ...subject,
          progress: comparisonMode ? 1 : 0,
          width,
          ...(comparisonMode ? {comparisonMode} : {}),
        } as Parameters<typeof openRenderer>[1])
        const {steps} = await renderer.state()
        const progresses = comparisonMode ? [1] : [0, ...steps.filter(end => end > 0 && end < 1), 1]
        for (const progress of progresses) {
          if (comparisonMode) await renderer.measure('settle')
          else await renderer.seek(progress, {highlighting: progress === 0 || progress === 1 ? 'auto' : 1})
          const failures = await renderer.frame.locator('.database-content').evaluate(content => {
            const problems: string[] = []
            const shown = (element: Element) => {
              for (let node: Element | null = element; node && node !== content; node = node.parentElement) {
                const style = getComputedStyle(node)
                if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.99) return false
              }
              return true
            }
            const describe = (element: Element) =>
              `${element.tagName.toLowerCase()}.${element.className} "${element.textContent?.slice(0, 40)}"`
            for (const element of content.querySelectorAll<HTMLElement>('*')) {
              if (element.closest('svg, .sr-only') || !shown(element) || !element.textContent?.trim()) continue
              const style = getComputedStyle(element)
              // Data (identifiers and everything in them) never ellipsizes; status words are labels, not data.
              if (element.closest('[data-projections-identifier]') && style.textOverflow === 'ellipsis' && style.overflow !== 'visible') {
                problems.push(`${describe(element)} can ellipsize`)
              }
              if (element.scrollWidth > element.clientWidth + 1) {
                problems.push(`${describe(element)} overflows: ${element.scrollWidth} > ${element.clientWidth}`)
              }
              // Text a card or row holds stays inside it.
              if (![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())) continue
              const box = element.getBoundingClientRect()
              // A tag's status tab hangs off its pill, in the room its slot reserves below it.
              const tab = element.closest('.pk-status-tab-room')
              for (const holder of [
                element.closest('.database-slot, .database-column, header'),
                tab ? element.closest('.database-tag-slot') : element.closest('.database-table, .database-tag'),
              ]) {
                if (!holder) continue
                const outer = holder.getBoundingClientRect()
                if (
                  box.left < outer.left - 0.5 ||
                  box.right > outer.right + 0.5 ||
                  box.top < outer.top - 0.5 ||
                  box.bottom > outer.bottom + 0.5
                ) {
                  problems.push(`${describe(element)} is clipped by ${holder.className}`)
                }
              }
            }
            return problems
          })
          checked++
          expect(failures, `${scenario.id} at ${width}px, ${comparisonMode ?? 'animated'}, progress ${progress}`).toEqual([])
        }
        if (comparisonMode) {
          expect(await renderer.frame.locator('.database-view[data-diff]').count(), `${scenario.id} draws the diff`).toBe(1)
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(10)
})

test('arrowheads are painted over the tables, so a tip stays whole where it meets a border', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'database', before, after, progress: 1})
  const order = await renderer.frame.locator('.database-canvas').evaluate(canvas => {
    const heads = [...canvas.querySelectorAll('.database-arrowhead')]
    const tables = [...canvas.querySelectorAll('.database-table')]
    return {
      heads: heads.length,
      under: heads.filter(head => tables.some(table => !(table.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING))).length,
      links: canvas.querySelectorAll('.database-link').length,
    }
  })
  expect(order.heads).toBe(order.links)
  expect(order.heads).toBeGreaterThan(0)
  expect(order.under).toBe(0)
})

test('a card is wide enough for its name, kind and status: the OrderStatus enum header is one line, never ellipsized', async ({page}) => {
  const {readFile} = await import('node:fs/promises')
  const load = async (name: string) => JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))
  await page.setViewportSize({width: 1520, height: 1000})
  const renderer = await openRenderer(page, {
    renderer: 'database',
    before: await load('prisma-shop-before'),
    after: await load('prisma-shop-after'),
    progress: 1,
    width: 1440,
  })
  const header = renderer.frame.locator('section[data-entity-id="enum:OrderStatus"] header')
  await expect(header).not.toHaveClass(/wrapped/u)
  await expect(header.locator('.entity-link')).toHaveText('OrderStatus')
  expect(await header.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(38.5)
})

const story = (name: string) =>
  (['before', 'after'] as const).map(side => JSON.parse(readFileSync(new URL(`../fixtures/${name}-${side}.json`, import.meta.url), 'utf8')))

/**
 * Every link as drawn, from the renderer document: whether it leaves and
 * enters its tables' sides between their tops and bottoms, and whether its
 * path ever doubles back against the way it travels (a cusp, hairpin or
 * reversal). Self-contained: it runs in the renderer frame.
 */
function drawnLinks(view: Element) {
  const issues: string[] = []
  for (const group of view.querySelectorAll<SVGGElement>('[data-link-key]')) {
    if (Number(group.getAttribute('opacity')) < 0.05) continue
    const d = group.querySelector('path.database-link')!.getAttribute('d') ?? ''
    const numbers = (d.match(/-?[\d.]+/gu) ?? []).map(Number)
    const points = Array.from({length: numbers.length / 2}, (_, index) => ({x: numbers[2 * index]!, y: numbers[2 * index + 1]!}))
    const key = group.dataset.linkKey!
    const from = view.querySelector<HTMLElement>(`.database-table[data-entity-id="${CSS.escape(group.dataset.from ?? '')}"]`)
    const to = view.querySelector<HTMLElement>(`.database-table[data-entity-id="${CSS.escape(group.dataset.to ?? '')}"]`)
    const sides = (group.dataset.sides ?? '').split('/')
    // In canvas coordinates (as the paths are), to a fraction of a pixel while tables move.
    const canvas = view.querySelector<HTMLElement>('.database-canvas')!
    const origin = canvas.getBoundingClientRect(),
      scale = origin.width / canvas.offsetWidth
    const place = (table: HTMLElement) => {
      const rect = table.getBoundingClientRect()
      return {
        left: (rect.left - origin.left) / scale,
        top: (rect.top - origin.top) / scale,
        width: rect.width / scale,
        height: rect.height / scale,
      }
    }
    const side = (table: HTMLElement | null, point: {x: number; y: number}, which: string) => {
      if (!table) return true
      const {left, top, width, height} = place(table)
      const x = which === 'left' ? left : left + width
      return Math.abs(point.x - x) < 0.05 && point.y > top && point.y < top + height
    }
    if (!side(from, points[0]!, sides[0]!)) issues.push(`${key}: leaves off its table's ${sides[0]} side`)
    // The shaft ends at the arrowhead's base; the head's tip is on the target's side.
    const head = view.querySelector(`path.database-arrowhead[data-head-of-link="${CSS.escape(key)}"]`)
    const tip = (head?.getAttribute('d')?.match(/-?[\d.]+/gu) ?? []).map(Number)
    if (to && tip.length >= 2 && !(tip[1]! > place(to).top && tip[1]! < place(to).top + place(to).height)) {
      issues.push(`${key}: enters off its table's ${sides[1]} side`)
    }
    if (sides[0] === sides[1]) continue
    const along = sides[0] === 'left' ? -1 : 1
    for (let index = 0; index + 3 < points.length; index += 3) {
      const [p0, p1, p2, p3] = points.slice(index, index + 4)
      for (let step = 0; step <= 12; step++) {
        const t = step / 12,
          u = 1 - t
        const dx = 3 * (u * u * (p1!.x - p0!.x) + 2 * u * t * (p2!.x - p1!.x) + t * t * (p3!.x - p2!.x))
        const dy = 3 * (u * u * (p1!.y - p0!.y) + 2 * u * t * (p2!.y - p1!.y) + t * t * (p3!.y - p2!.y))
        if (Math.hypot(dx, dy) > 1e-3 && (dx * along) / Math.hypot(dx, dy) < -0.01) {
          issues.push(`${key}: doubles back`)
          index = points.length
          break
        }
      }
    }
  }
  return issues
}

for (const name of ['prisma-shop', 'django-library']) {
  for (const width of [1440, 390]) {
    test(`${name} at ${width}px: scrubbed both ways in 1% steps, every link leaves and enters its tables' sides, never doubles back, and its head touches the border`, async ({
      page,
    }) => {
      test.setTimeout(240_000)
      await page.setViewportSize({width, height: 900})
      const [a, b] = story(name)
      const renderer = await openRenderer(page, {renderer: 'database', before: a, after: b, progress: 0, comparisonMode: 'animated'})
      const issues = new Set<string>()
      await renderer.scrub(samples(100, {roundTrip: true}), async progress => {
        const view = renderer.frame.locator('.database-view')
        for (const issue of await view.evaluate(drawnLinks)) issues.add(`${issue} at ${progress}`)
        for (const issue of contactIssues(await view.evaluate(arrowContacts))) issues.add(`${issue} at ${progress}`)
      })
      expect([...issues].slice(0, 12)).toEqual([])
    })
  }
}

for (const name of ['prisma-shop', 'django-library']) {
  for (const width of [1440, 390]) {
    test(`${name} at ${width}px in diff mode: the union's links are drafted like a revision's, and every head touches its table's border`, async ({
      page,
    }) => {
      await page.setViewportSize({width, height: 900})
      const [a, b] = story(name)
      const renderer = await openRenderer(page, {renderer: 'database', before: a, after: b, comparisonMode: 'diff'})
      expect((await renderer.state()).comparisonMode).toBe('diff')
      await renderer.measure('settle')
      const view = renderer.frame.locator('.database-view')
      expect(await view.evaluate(drawnLinks)).toEqual([])
      const contacts = await view.evaluate(arrowContacts)
      expect(contacts.length).toBeGreaterThan(0)
      expect(contactIssues(contacts)).toEqual([])
    })
  }
}
