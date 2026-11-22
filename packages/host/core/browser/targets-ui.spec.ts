import {test, expect, type Page} from '@playwright/test'
import {explorer, showAs} from './harness.js'

const view = (page: Page) => page.locator('.ph')
/** An output's JSON value (key order aside), or its text while it shows none. */
async function json(page: Page, label: string): Promise<unknown> {
  const text = (await page.getByLabel(label, {exact: true}).textContent()) ?? ''
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
const annotations = JSON.stringify([
  {target: {kind: 'entity', id: 'payments', side: 'after'}, count: 2, label: '2 comments', tone: 'attention'},
  {target: {kind: 'entity', id: 'payments', side: 'after', path: '/retries'}, count: 1},
  {target: {kind: 'relationship', id: 'audit-payments', side: 'after'}},
  {target: {kind: 'entity', id: 'vanished', side: 'before'}, count: 5},
])

async function open(page: Page, query: string) {
  await page.goto(explorer(`renderer=minimal&${query}`))
  await expect(page.locator('.ph-explorer')).toBeVisible()
  await expect(view(page)).toHaveAttribute('data-mode', 'comparison')
}

test('table annotation markers report activations and select the row', async ({page}) => {
  await open(page, `before=v1&after=v3&view=table&annotations=${encodeURIComponent(annotations)}`)
  const table = page.locator('.ph-table-view')
  // Two annotations land on the payments row (the entity and one of its properties): one marker, counts summed.
  const marker = table.getByRole('button', {name: '3 annotations on Payments'})
  await expect(marker).toHaveAttribute('data-annotation-id', 'payments')
  await expect(marker).toHaveAttribute('data-tone', 'attention')
  await expect(marker).toHaveText('3')
  // Unlabeled markers are named by their count, or as an annotation.
  await expect(table.locator('.ph-annotation[data-annotation-id="audit-payments"]')).toHaveAccessibleName(
    'Annotation on Payments → Audit log (calls)',
  )
  await expect(table.locator('.ph-annotation[data-annotation-id="vanished"]')).toHaveCount(0)
  await marker.click()
  await expect(page.getByLabel('Annotation activations')).toHaveText('payments')
  await expect(page.getByLabel('Host selection', {exact: true})).toHaveText('payments')
  await expect(page.locator('[data-detail-card]')).toContainText('Payments')
  // The detail card repeats the row's marker.
  await page.locator('[data-detail-card] .ph-annotation').click()
  await expect(page.getByLabel('Annotation activations')).toHaveText('payments, payments')
})

test('text view markers and relationships are selectable', async ({page}) => {
  await open(page, `before=v1&after=v3&view=text&annotations=${encodeURIComponent(annotations)}`)
  const text = page.locator('.ph-text-view')
  await text.locator('.ph-annotation[data-annotation-id="audit-payments"]').click()
  await expect(page.getByLabel('Annotation activations')).toHaveText('audit-payments')
  await expect(page.getByLabel('Host selection targets')).toHaveText(
    JSON.stringify([{kind: 'relationship', id: 'audit-payments', side: 'after'}]),
  )
  // The detail card overlays the view (on a phone, a sheet); close it before using what it covers.
  await page.keyboard.press('Escape')
  await showAs(page, 'Table')
  // A relationship row is named by its endpoints, with a unicode arrow.
  await page
    .locator('table[data-collection="relationships"] tr[data-row-id="reserve"]')
    .getByRole('button', {name: /^.+ → .+ \(calls\)$/u})
    .click()
  await expect(page.getByLabel('Host selection targets')).toContainText('"kind":"relationship"')
})

test('changed fields in the detail card are selectable targets with paths, and the consumer slot renders', async ({page}) => {
  await open(page, `before=v1&after=v3&view=table&annotations=${encodeURIComponent(annotations)}`)
  await page.locator('.ph-table-view').getByRole('button', {name: 'Payments', exact: true}).click()
  const details = page.locator('[data-detail-card]')
  const property = details.locator('[data-property-path="/retries"][data-side="after"]')
  await expect(property).toHaveAttribute('aria-pressed', 'false')
  // The property's own annotation is marked.
  await expect(property.locator('.ph-property-annotation')).toContainText('1')
  await property.click()
  await expect(property).toHaveAttribute('aria-pressed', 'true')
  await expect(property).toHaveAttribute('data-selected', 'true')
  await expect.poll(() => json(page, 'Host selected target')).toEqual({kind: 'entity', id: 'payments', side: 'after', path: '/retries'})
  await expect(page.getByLabel('Host selection', {exact: true})).toHaveText('payments')
  const slot = details.locator('.ph-details-slot')
  await expect(slot.getByLabel('Selection targets')).toHaveText('entity.before.payments entity.after.payments')
  await expect(slot.getByLabel('Selection anchor')).toHaveText('none')
  // Activating the selected property again selects the whole item.
  await property.click()
  await expect(property).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => json(page, 'Host selected target')).toEqual({kind: 'entity', id: 'payments', side: 'after'})
  await details.getByRole('button', {name: 'Close details'}).click()
  await expect(details).toHaveCount(0)
})

test('the anchor follows a selection the renderer draws', async ({page}) => {
  // At natural height the selected item stays in view on narrow screens too.
  await page.goto(explorer('before=v1&after=v3&fill=false'))
  await expect(view(page)).toHaveAttribute('data-renderer-status', 'ready')
  await page.getByLabel('Target to select').fill('entity.after.payments')
  await page.getByRole('button', {name: 'Select target'}).click()
  // Browsers pause offscreen frames, and the anchor is clipped to what is visible.
  await page.locator('iframe.ph-frame').scrollIntoViewIfNeeded()
  await expect(page.locator('.ph-details-slot').getByLabel('Selection anchor')).toHaveText(
    /^\{"x":-?\d+,"y":-?\d+,"width":\d+,"height":\d+,"side":"after"\}$/u,
  )
})

test('selecting a target reports present, absent and property-absent resolutions', async ({page}) => {
  await open(page, 'before=v1&after=v3&view=table')
  const select = async (text: string) => {
    await page.getByLabel('Target to select').fill(text)
    await page.getByRole('button', {name: 'Select target'}).click()
  }
  await select('entity.after.payments')
  await expect(page.getByLabel('Target resolution')).toHaveText(JSON.stringify({status: 'present', rowId: 'payments'}))
  await expect(page.getByLabel('Host selection', {exact: true})).toHaveText('payments')
  await expect(page.locator('[data-detail-card]')).toContainText('Payments')
  await select('entity.after.payments.%2Fretries')
  await expect(page.getByLabel('Target resolution')).toHaveText(JSON.stringify({status: 'present', rowId: 'payments'}))
  await expect(page.locator('[data-detail-card] [data-property-path="/retries"]')).toHaveAttribute('aria-pressed', 'true')
  await select('entity.after.nowhere')
  await expect(page.getByLabel('Target resolution')).toHaveText(JSON.stringify({status: 'absent', reason: 'item'}))
  // An absent target leaves the selection unchanged.
  await expect(page.getByLabel('Host selection', {exact: true})).toHaveText('payments')
  await select('entity.after.checkout.%2Fowner')
  await expect(page.getByLabel('Target resolution')).toHaveText(JSON.stringify({status: 'absent', reason: 'property', rowId: 'checkout'}))
  await expect(page.getByLabel('Host selection', {exact: true})).toHaveText('checkout')
  await expect.poll(() => json(page, 'Host selected target')).toEqual({kind: 'entity', id: 'checkout', side: 'after'})
  await select('not a target')
  await expect(page.getByLabel('Target resolution')).toHaveText('"invalid"')
})
