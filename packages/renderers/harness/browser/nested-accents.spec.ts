import {expect, test} from '@playwright/test'
import {openStage, type EntitySample, type NestedAccent} from '@githubnext/projections-renderer-testing/playwright'
import {harnessInspector} from '@githubnext/projections-renderer-harness/playwright'

/**
 * No nested change colors: a changed item that shows changes inside it is drawn neutral, so only the innermost changes
 * carry a hue. The renderer checks hold every scenario to it (`nested-accents`); these cases show the probe finds the
 * nesting it guards against, by painting the container in its change hue again, as before the rule.
 */
const cases = [
  {
    key: 'graph/npm-react-update',
    what: 'a modified card around its old and new values',
    restore: '.pk .graph-node .node-emphasis.modified { fill: var(--amber-soft) !important }',
  },
  {
    key: 'agentic-workflows/docs-bot',
    what: 'a modified card around its added and removed pills',
    restore: '.pk .pk-region[data-change="modified"] { background-color: var(--amber-soft) !important }',
  },
  {
    key: 'file-packing/sample-app',
    what: 'a changed folder around changed files',
    restore:
      '.pk .fp-emphasis.added { stroke: var(--green-border) !important } .pk .fp-emphasis.removed { stroke: var(--red-border) !important }',
  },
]

const crossing = (nestings: NestedAccent[]) =>
  nestings.filter(({outer, inner}) => inner.family !== outer.family || (inner.entity !== undefined && inner.entity !== outer.entity))

for (const {key, what, restore} of cases) {
  test(`${key}: the diff draws ${what} neutral, and the probe finds the nesting when it isn't`, async ({page}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'The probe reads computed styles, the same in every engine.')
    const stage = await openStage(page, harnessInspector(), {scenario: key, progress: 1, comparisonMode: 'diff'})
    await stage.measure('settle')
    expect(crossing(await stage.measure<NestedAccent[]>('accents'))).toEqual([])
    await stage.frame.locator('head').evaluate((head, css) => {
      const style = document.createElement('style')
      style.textContent = css
      head.append(style)
    }, restore)
    await stage.measure('settle')
    expect(crossing(await stage.measure<NestedAccent[]>('accents')).length).toBeGreaterThan(0)
  })
}

test('the probe measures a closed outline, a straight line in it and what a categorical part holds', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'The probe reads computed styles, the same in every engine.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'graph/npm-react-update', progress: 1, comparisonMode: 'diff'})
  await stage.frame.locator('.pk').evaluate(root => {
    const probe = document.createElement('div')
    probe.innerHTML = `
      <svg width="300" height="120" class="nesting-probe">
        <path d="M 10 10 H 290 V 110 H 10 Z" style="fill: none; stroke: var(--projections-color-modified); stroke-width: 2px" />
        <line x1="40" y1="60" x2="200" y2="60" style="stroke: var(--projections-color-removed); stroke-width: 2px" />
      </svg>
      <div class="nesting-probe-card" style="background: var(--projections-color-modified-muted)">
        <span data-projections-category="probe" style="background: var(--projections-chart-1)">
          <span class="nesting-probe-gain" style="background: var(--projections-color-added-muted)">+</span>
        </span>
      </div>`
    root.prepend(probe)
  })
  const found = crossing(await stage.measure<NestedAccent[]>('accents')).map(({outer, inner}) => `${inner.element} in ${outer.element}`)
  expect(found).toEqual(expect.arrayContaining(['line in path', 'span.nesting-probe-gain in div.nesting-probe-card']))
})

test('the probe reads what a box draws in its pseudo-elements, its outset shadow and its gradient', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'The probe reads computed styles, the same in every engine.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'graph/npm-react-update', progress: 1, comparisonMode: 'diff'})
  await stage.frame.locator('.pk').evaluate(root => {
    const probe = document.createElement('div')
    probe.innerHTML = `
      <style>
        .nesting-probe-edge { position: relative; }
        .nesting-probe-edge::before { content: ''; position: absolute; inset: 0; box-shadow: 0 0 0 1px var(--projections-color-modified); }
      </style>
      <div class="nesting-probe-edge"><span class="nesting-probe-a" style="background: var(--projections-color-added-muted)">+</span></div>
      <div class="nesting-probe-shadow" style="box-shadow: 0 0 0 1px var(--projections-color-removed)">
        <span class="nesting-probe-b" style="background: var(--projections-color-added-muted)">+</span>
      </div>
      <div class="nesting-probe-gradient" style="background-image: linear-gradient(var(--projections-color-modified-muted), var(--projections-color-modified-muted))">
        <span class="nesting-probe-c" style="background: var(--projections-color-added-muted)">+</span>
      </div>`
    root.prepend(probe)
  })
  const found = crossing(await stage.measure<NestedAccent[]>('accents')).map(({outer, inner}) => `${inner.element} in ${outer.element}`)
  expect(found).toEqual(
    expect.arrayContaining([
      'span.nesting-probe-a in div.nesting-probe-edge::before',
      'span.nesting-probe-b in div.nesting-probe-shadow',
      'span.nesting-probe-c in div.nesting-probe-gradient',
    ]),
  )
})

test("an entity's paint includes what it draws in its pseudo-elements, so a hue left there at an endpoint shows", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'The probe reads computed styles, the same in every engine.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'agentic-workflows/docs-bot', progress: 1, comparisonMode: 'diff'})
  await stage.measure('settle')
  const paints = async () => Object.fromEntries((await stage.measure<EntitySample[]>('samples')).map(sample => [sample.key, sample.paint]))
  const before = await paints()
  // An HTML entity (SVG elements draw no pseudo-elements): its paint starts with its upper-case tag name.
  const id = Object.keys(before).find(key => /^[A-Z]/u.test(before[key] ?? '')) ?? ''
  await stage.frame.locator('head').evaluate((head, entity) => {
    const style = document.createElement('style')
    style.textContent = `[data-entity-id="${CSS.escape(entity)}"]::after { content: ''; display: block; height: 2px; background: var(--projections-color-added); }`
    head.append(style)
  }, id)
  expect((await paints())[id]).not.toBe(before[id])
})

test('the probe reads every hue of a gradient, and exempts a categorical background however it is drawn', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'The probe reads computed styles, the same in every engine.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'graph/npm-react-update', progress: 1, comparisonMode: 'diff'})
  await stage.frame.locator('.pk').evaluate(root => {
    const probe = document.createElement('div')
    probe.innerHTML = `
      <style>
        .nesting-probe-swatch { position: relative; }
        .nesting-probe-swatch::after { content: ''; position: absolute; inset: 0; background: var(--projections-color-modified-muted); }
      </style>
      <div class="nesting-probe-forward" style="background-image: linear-gradient(var(--projections-color-added-muted), var(--projections-color-removed-muted))">
        <span class="nesting-probe-d" style="background: var(--projections-color-added-muted)">+</span>
      </div>
      <div class="nesting-probe-backward" style="background-image: linear-gradient(var(--projections-color-removed-muted), var(--projections-color-added-muted))">
        <span class="nesting-probe-e" style="background: var(--projections-color-added-muted)">+</span>
      </div>
      <div class="nesting-probe-swatch" data-projections-category="probe-swatch" style="background-image: linear-gradient(var(--projections-color-modified-muted), var(--projections-color-modified-muted))">
        <span class="nesting-probe-f" style="background: var(--projections-color-added-muted)">+</span>
      </div>`
    root.prepend(probe)
  })
  const found = crossing(await stage.measure<NestedAccent[]>('accents')).map(({outer, inner}) => `${inner.element} in ${outer.element}`)
  expect(found).toEqual(
    expect.arrayContaining(['span.nesting-probe-d in div.nesting-probe-forward', 'span.nesting-probe-e in div.nesting-probe-backward']),
  )
  expect(found.filter(line => line.includes('nesting-probe-swatch'))).toEqual([])
})

test("an entity's text and categories include its pseudo-elements: generated text, and a categorical colour drawn there", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'The probe reads computed styles, the same in every engine.')
  const stage = await openStage(page, harnessInspector(), {scenario: 'agentic-workflows/docs-bot', progress: 1, comparisonMode: 'diff'})
  await stage.measure('settle')
  const shown = async () => new Map((await stage.measure<EntitySample[]>('samples')).map(sample => [sample.key, sample]))
  const before = await shown()
  const id = [...before].find(([, sample]) => /^[A-Z]/u.test(sample.paint))?.[0] ?? ''
  const style = await stage.frame.locator('head').evaluateHandle((head, entity) => {
    const element = document.createElement('style')
    const selector = `[data-entity-id="${CSS.escape(entity)}"]`
    element.textContent = `${selector}::after { content: 'Added'; }`
    head.append(element)
    document.querySelector(selector)?.setAttribute('data-projections-category', 'probe')
    return element
  }, id)
  const added = (await shown()).get(id)
  expect(added?.text).toContain('Added')
  await style.evaluate((element: HTMLStyleElement) => {
    element.textContent = element.textContent.replace("'Added'", "'Removed'; background: var(--projections-chart-2)")
  })
  const removed = (await shown()).get(id)
  expect(removed?.text).not.toBe(added?.text)
  expect(removed?.categories['probe::after']).not.toBe(added?.categories['probe::after'])
})
