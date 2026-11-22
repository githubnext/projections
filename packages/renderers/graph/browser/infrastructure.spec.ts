import {readFileSync} from 'node:fs'
import {expect, test} from '@playwright/test'
import type {Extraction} from '@githubnext/projections-schemas'
import {openRenderer} from '@githubnext/projections-renderer-harness/playwright'
import type {FixturePair} from '../../kit/browser/fixtures.js'
import {scrubSuite, selectionSuite} from '../../kit/browser/suite.js'

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8')) as Extraction
const pair = (name: string, prefix: string): FixturePair => ({
  name,
  renderer: 'infrastructure',
  before: fixture(`${prefix}-before`),
  after: fixture(`${prefix}-after`),
})
const terraform = pair('terraform infrastructure', 'terraform')
const azure = pair('azure infrastructure', 'azure')
const database = 'module.database.aws_db_instance.main'

scrubSuite([terraform, azure])
selectionSuite(terraform, database)

/** Each card's footer status text, by entity ID. */
async function statuses(renderer: Awaited<ReturnType<typeof openRenderer>>) {
  return renderer.frame
    .locator('.pk')
    .evaluate(root =>
      Object.fromEntries(
        [...root.querySelectorAll<SVGGElement>('svg.graph .graph-node[data-entity-id]')]
          .map(node => [
            node.dataset.entityId!,
            [...node.querySelectorAll('.pk-svg-status .pk-status-part')]
              .map(part => `${part.querySelector('[data-icon]')?.getAttribute('data-icon') ?? '?'} ${part.textContent}`)
              .join(' '),
          ])
          .filter(([, text]) => text),
      ),
    )
}

test('changes are worded as planned actions: Replace and Destroy differ in icon and word, not only color', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'infrastructure', before: terraform.before, after: terraform.after, progress: 0})
  const seen: Record<string, string> = {}
  // Every change states itself while it is emphasized; removals only while they fade.
  for (let index = 1; index < 50; index++) {
    await renderer.seek(index / 50, {highlighting: 1})
    Object.assign(seen, await statuses(renderer))
  }
  // Each part is an icon (its kit name) and a word.
  expect(seen[database]).toBe('replace Replace')
  expect(seen['aws_instance.bastion']).toBe('removed Destroy')
  expect(seen['aws_secretsmanager_secret.database']).toBe('added Create')
  expect(seen['module.database.aws_db_instance.replica']).toBe('modified Update in place')
  expect(seen['aws_route53_record.database']).toMatch(/moved Moved.*modified Update in place/)
  // Highlighting never moves a card, and neither endpoint shows any status.
  for (const progress of [0, 1]) {
    await renderer.seek(progress, {highlighting: 'auto'})
    await expect(renderer.frame.locator('.pk-svg-status')).toHaveCount(0)
  }
  // The plan is the host's summary bar's: how many resources each planned action touches, each filtering to them.
  await expect
    .poll(async () =>
      ((await renderer.state()).summary ?? []).flatMap(item => (item.type === 'fact' ? [`${item.count} ${item.noun.plural}`] : [])),
    )
    .toEqual(['2 to add', '3 to change', '1 to replace', '1 to destroy', '1 to move'])
  // The accessible name keeps the comparison's own word.
  await renderer.seek(0.5, {highlighting: 1})
  await expect(renderer.frame.locator(`[data-entity-id="${database}"]`).first()).toHaveAttribute('aria-label', /Modified, Replace/)
})

test('resource types are the monospace kind line; modules and virtual networks are boundaries', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'infrastructure', before: terraform.before, after: terraform.after, progress: 1})
  const card = renderer.frame.locator(`.graph-node[data-entity-id="${database}"]`)
  await expect(card.locator('.node-kind tspan[data-projections-identifier]')).toHaveText('aws_db_instance')
  await expect(card.locator('.node-label')).toHaveText('main')
  await expect(renderer.frame.locator('.graph-group[data-entity-id="module.database"]')).toHaveCount(1)
  await expect(renderer.frame.locator('.graph-link[data-from="module.database"]')).toHaveCount(0)
  const measured = await renderer.measure<{proportional: string[]}>('identifiers')
  expect(measured.proportional).toEqual([])

  const arm = await openRenderer(page, {renderer: 'infrastructure', before: azure.before, after: azure.after, progress: 1})
  const vnet = azure.after.entities.find(entity => entity.label === 'vnet-shop')!.id
  const group = azure.after.entities.find(entity => entity.kind === 'resource-group')!.id
  await expect(arm.frame.locator(`.graph-group[data-entity-id="${vnet}"]`)).toHaveCount(1)
  await expect(arm.frame.locator(`.graph-group[data-entity-id="${group}"]`)).toHaveCount(1)
  // The provider namespace is left out.
  const subnet = azure.after.entities.find(entity => entity.label === 'private-endpoints')!.id
  await expect(arm.frame.locator(`.graph-node[data-entity-id="${subnet}"] .node-kind tspan`).first()).toHaveText('virtualNetworks/subnets')
})

test('selecting a resource brings forward what depends on it, unless the control is off', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'infrastructure', before: terraform.before, after: terraform.after, progress: 1})
  await expect.poll(async () => (await renderer.state()).controls.map(control => control.id)).toContain('dependents')
  await renderer.select(database)
  await expect(renderer.frame.getByRole('status').filter({hasText: '6 resources depend on main'})).toHaveCount(1)
  const forward = await renderer.frame
    .locator('.graph-node:not(.graph-group):not(.receded)')
    .evaluateAll(nodes => nodes.map(node => (node as SVGGElement).dataset.entityId).sort())
  expect(forward).toEqual(
    [
      database,
      'aws_cloudwatch_metric_alarm.database_cpu',
      'aws_iam_role_policy.read_config',
      'aws_route53_record.database',
      'aws_secretsmanager_secret_version.database',
      'aws_ssm_parameter.database_url',
      'module.database.aws_db_instance.replica',
    ].sort(),
  )
  await expect(renderer.frame.locator('.graph-link.receded').first()).toBeAttached()
  await renderer.setOptions({dependents: false})
  await expect(renderer.frame.locator('.receded')).toHaveCount(0)
})

test('one revision shows each pending action beside its type', async ({page}) => {
  const renderer = await openRenderer(page, {renderer: 'infrastructure', extraction: terraform.after})
  await expect(renderer.frame.locator(`.graph-node[data-entity-id="${database}"] .node-kind`)).toHaveText('aws_db_instance · Replace')
  await expect(renderer.frame.locator('.pk-svg-status')).toHaveCount(0)
})
