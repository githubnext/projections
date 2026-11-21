import {test as base, expect} from '@playwright/test'
import {execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startHarness, type Harness} from './harness.js'

/**
 * The sweep's thumbnails, served here rather than drawn: the runner draws each in a headless browser it launches, one
 * after another, which on a busy two-core CI runner took most of a minute for the first. These tests are about the
 * Inspector, which loads them as cells scroll into view and shows them larger on hover; cli/test/serve.test.mjs draws
 * real ones.
 */
const thumbnail = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFCAIAAAD38zoCAAAAEUlEQVR42mO4++QNVsRABwkAIR9rCczd5uYAAAAASUVORK5CYII=',
  'base64',
)

/** A repository with a Prisma schema and two merged pull requests, only the first of which changes the schema. */
const test = base.extend<{explore: {url: string; repo: string}}>({
  explore: async ({browserName, context, page}, use) => {
    const repo = await mkdtemp(join(tmpdir(), `projections-explore-${browserName}-`))
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
        cwd: repo,
        stdio: 'pipe',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Explore fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
          GIT_COMMITTER_NAME: 'Explore fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        },
      })
    const merge = async (branch: string, number: number, title: string, change: () => Promise<void>) => {
      git('checkout', '--quiet', '-b', branch)
      await change()
      git('add', '-A')
      git('commit', '--quiet', '-m', title)
      git('checkout', '--quiet', '-')
      git('merge', '--quiet', '--no-ff', branch, '-m', `Merge pull request #${number} from acme/${branch}`, '-m', title)
    }
    let server: Harness | undefined
    try {
      git('init', '--quiet', '--template=')
      await mkdir(join(repo, 'prisma'))
      const schema = 'model User {\n  id Int @id\n}\n'
      await writeFile(join(repo, 'prisma/schema.prisma'), schema)
      git('add', '-A')
      git('commit', '--quiet', '-m', 'Start')
      await merge('posts', 7, 'Add posts', () => writeFile(join(repo, 'prisma/schema.prisma'), `${schema}model Post {\n  id Int @id\n}\n`))
      await merge('docs', 8, 'Write docs', () => writeFile(join(repo, 'README.md'), '# Docs\n'))
      server = await startHarness(context, ['-C', repo])
      await page.route(
        url => url.pathname === '/api/sweep/thumbnail',
        route => route.fulfill({status: 200, contentType: 'image/png', body: thumbnail}),
      )
      await use({url: server.url, repo})
    } finally {
      await server?.close()
      await rm(repo, {recursive: true, force: true})
    }
  },
})

test('explore proposes projections, sweeps recent merges and opens a change in the Inspector', async ({page, explore}) => {
  await page.goto(explore.url)
  await expect(page.getByRole('heading', {name: 'Explore this repository'})).toBeVisible()
  const prisma = page.locator('[data-candidate="prisma-schema"]')
  await expect(prisma).toContainText('prisma/schema.prisma')

  // The session sweeps on open: one row per change, one column per projection.
  const grid = page.getByRole('table', {name: 'Projections on recent changes'})
  await expect(grid.getByRole('columnheader', {name: /Prisma schema/})).toBeVisible()
  const posts = grid.getByRole('row').filter({hasText: 'Add posts'})
  const docs = grid.getByRole('row').filter({hasText: 'Write docs'})
  await expect(posts.getByRole('rowheader')).toContainText('#7')
  const changed = posts.locator('[data-projection="prisma-schema"]')
  await expect(changed).toHaveAttribute('data-status', 'changed', {timeout: 30_000})
  await expect(changed).toContainText(/\d+ changes?, \d+ steps?/)
  // Unchanged cells say so in words, not only by fading.
  await expect(docs.locator('[data-projection="prisma-schema"]')).toHaveText('No change')
  await expect(page.getByRole('button', {name: 'Sweep again'})).toBeEnabled()

  await changed.getByRole('link').click()
  await expect(page).toHaveURL(/view=inspect&projection=prisma-schema&before=[0-9a-f]{40}&after=[0-9a-f]{40}/)
  // The repository defines nothing yet, so the Inspector offers both ways in.
  const setup = page.getByRole('region', {name: 'Make a projection'})
  await expect(setup.getByRole('link', {name: 'explore this repository'})).toHaveAttribute('href', '?view=explore')
})

test('a thumbnail arriving while its cell is pressed never takes the click', async ({page, explore}) => {
  // Thumbnails wait until the cell is pressed, on its loading spinner.
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  await page.route(
    url => url.pathname === '/api/sweep/thumbnail',
    async route => {
      await held
      await route.fallback()
    },
  )
  await page.goto(explore.url)
  const grid = page.getByRole('table', {name: 'Projections on recent changes'})
  const changed = grid.getByRole('row').filter({hasText: 'Add posts'}).locator('[data-projection="prisma-schema"]')
  await expect(changed).toHaveAttribute('data-status', 'changed', {timeout: 30_000})
  await expect(page.getByRole('button', {name: 'Sweep again'})).toBeEnabled()
  const link = changed.getByRole('link')
  await link.scrollIntoViewIfNeeded()
  const spinner = (await link.locator('.pi-sweep-thumbnail svg').boundingBox())!
  await page.mouse.move(spinner.x + spinner.width / 2, spinner.y + spinner.height / 2)
  await page.mouse.down()
  release()
  await expect(link.locator('img')).toBeVisible()
  await page.mouse.up()
  await expect(page).toHaveURL(/view=inspect&projection=prisma-schema&before=[0-9a-f]{40}&after=[0-9a-f]{40}/)
})

test('the sweep summarizes each projection, adopting writes previewed files, and Add to CI writes nothing', async ({page, explore}) => {
  await page.goto(explore.url)
  const grid = page.getByRole('table', {name: 'Projections on recent changes'})
  const prisma = grid.locator('th[data-projection="prisma-schema"]')
  await expect(prisma).toContainText('Changed in 1 of 2 changes · median', {timeout: 30_000})
  // Columns sort by signal as the other projections finish, which can move this one out of view after scrolling to it.
  await expect(page.getByRole('button', {name: 'Sweep again'})).toBeEnabled({timeout: 30_000})
  // Filtering to changes where something changed keeps the changes the file map saw too.
  await page.getByLabel('Only changes where something changed').check()
  await expect(grid.getByRole('row').filter({hasText: 'Add posts'})).toBeVisible()
  // Hovering a thumbnail shows it larger.
  const changed = grid.getByRole('row').filter({hasText: 'Add posts'}).locator('[data-projection="prisma-schema"] a')
  // Thumbnails load as they scroll into view, after the cells above them.
  await changed.scrollIntoViewIfNeeded()
  await expect(changed.locator('img')).toBeVisible()
  await changed.hover()
  await expect(page.getByRole('img', {name: /The Diff of Prisma schema on #7/})).toBeVisible()

  // Adopt from the column header: preview first, then write.
  await prisma.getByRole('checkbox', {name: 'Adopt'}).check()
  await page.getByRole('button', {name: 'Preview adopting Prisma schema'}).click()
  const adopt = page.getByRole('region', {name: 'Adopt'})
  await expect(adopt).toContainText('.github/projections/prisma-schema.json')
  await expect(adopt).toContainText('prisma-schema-pr-7')
  await adopt.getByRole('button', {name: /^Write/}).click()
  await expect(adopt).toContainText('Adopted prisma-schema')
  await expect(prisma.getByText('Adopted')).toBeVisible()
  const definition = JSON.parse(await readFile(join(explore.repo, '.github/projections/prisma-schema.json'), 'utf8'))
  expect(definition.extractor).toBe('prisma-schema')

  // Where the CI step goes is the person's and their agent's decision: the page offers the prompt and the guide.
  const ci = page.getByRole('region', {name: 'Add to CI'})
  await expect(ci.getByLabel('Prompt')).toContainText('projections help agents ci')
  await expect(ci.getByRole('link', {name: 'Read the guide'})).toHaveAttribute('href', /docs\/setup\/ci\.md$/)
  await expect(ci.getByRole('button', {name: 'Ask your coding agent'})).toHaveCount(0)
  expect(existsSync(join(explore.repo, '.github/workflows'))).toBe(false)
})
