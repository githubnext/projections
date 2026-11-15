import {test as base, expect} from '@playwright/test'
import {execFileSync} from 'node:child_process'
import {copyFile, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {startHarness} from './harness.js'

/** The template renderer's bundle, as `projections init --renderer custom` builds one. */
const minimal = resolve('../../../examples/renderers/minimal/dist')

interface Repository {
  url: string
  /** HEAD's full commit SHA. */
  head: string
}

/**
 * A repository whose committed projection draws with a custom renderer bundle committed beside it, with an
 * uncommitted change: the VS Code extension's Uncommitted choice on a projection with no edits.
 */
const test = base.extend<{repository: Repository}>({
  repository: async ({browserName, context}, use) => {
    const repo = await mkdtemp(join(tmpdir(), `projections-custom-renderer-${browserName}-`))
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
        cwd: repo,
        stdio: 'pipe',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Inspector fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
          GIT_COMMITTER_NAME: 'Inspector fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        },
      })
        .toString()
        .trim()
    try {
      git('init', '--quiet')
      const bundle = join(repo, '.github/projections/cards/dist')
      await mkdir(bundle, {recursive: true})
      await copyFile(join(minimal, 'index.html'), join(bundle, 'index.html'))
      await copyFile(join(minimal, 'renderer.json'), join(bundle, 'renderer.json'))
      await writeFile(
        join(repo, '.github/projections/cards.json'),
        JSON.stringify({
          id: 'cards',
          title: 'Package cards',
          extractor: 'repository-map',
          renderer: {bundle: '.github/projections/cards/dist'},
        }),
      )
      await writeFile(join(repo, 'README.md'), '# Cards\n')
      git('add', '.')
      git('commit', '--quiet', '-m', 'Package cards')
      await writeFile(join(repo, 'NOTES.md'), 'Uncommitted\n')
      const server = await startHarness(context, ['-C', repo])
      try {
        await use({url: server.url, head: git('rev-parse', 'HEAD')})
      } finally {
        await server.close()
      }
    } finally {
      await rm(repo, {recursive: true, force: true})
    }
  },
})

test('a custom renderer becomes ready with the committed definition (definitionRevision HEAD), named by its projection', async ({
  page,
  repository,
}) => {
  const query = '?projection=cards&before=HEAD&after=working-tree&definitionRevision=HEAD'
  await page.goto(repository.url.replace('#', `${query}#`))
  await expect(page.locator('.ph[data-mode="comparison"][data-renderer-status="ready"]')).toBeVisible()
  // The bundle is read from the commit HEAD names: a symbolic revision isn't a stable renderer URL.
  const frame = page.locator('iframe.ph-frame').first()
  await expect(frame).toHaveAttribute('src', new RegExp(`/custom-renderers/[0-9a-f]+/${repository.head}/cards/index\\.html#`))
  await expect(frame).toHaveAttribute('aria-label', /Package cards/)
  await expect(page.getByText(/did not become ready/)).toHaveCount(0)
  await expect(page.frameLocator('iframe.ph-frame').first().locator('[data-entity-id]').first()).toBeAttached()
})
