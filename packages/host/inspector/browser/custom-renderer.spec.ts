import {test as base, expect, type BrowserContext} from '@playwright/test'
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

type Commit = (repo: string) => Promise<void>

/** A temporary repository with what `commit` writes committed and an uncommitted note, served by the Inspector. */
async function served(browserName: string, context: BrowserContext, commit: Commit, use: (repository: Repository) => Promise<void>) {
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
    await commit(repo)
    await writeFile(join(repo, 'README.md'), '# Cards\n')
    git('add', '.')
    git('commit', '--quiet', '-m', 'Package cards')
    // The commit is the default branch, as a clone's origin/HEAD names it: its renderer runs without --trust.
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
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
}

/** Commits a projection named `cards` drawn by the renderer bundle `files` writes. */
const cards =
  (files: (bundle: string) => Promise<void>): Commit =>
  async repo => {
    const bundle = join(repo, '.github/projections/cards/dist')
    await mkdir(bundle, {recursive: true})
    await files(bundle)
    await writeFile(
      join(repo, '.github/projections/cards.json'),
      JSON.stringify({
        id: 'cards',
        title: 'Package cards',
        extractor: 'repository-map',
        renderer: {bundle: '.github/projections/cards/dist'},
      }),
    )
  }

/**
 * A custom renderer that asks the host for renderer documents by name and reports, as its `error`, what it got: the
 * built-in `graph`, itself (custom) and a name no renderer has.
 */
const documentsProbe = `<!doctype html>
<html lang="en"><body><script>
  const params = new URLSearchParams(location.hash.slice(1))
  const channel = params.get('channel')
  const post = message => parent.postMessage({projections: 0, channel, ...message}, '*')
  const names = ['graph', 'cards', 'no-such-renderer']
  const answers = {}
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.channel !== channel) return
    if (event.data.type === 'init') post({type: 'rendered', progress: 1})
    if (event.data.type !== 'document') return
    const {renderer, html, error} = event.data
    answers[renderer] = html !== undefined ? (/^<!doctype html>/i.test(html) ? 'html' : 'other') : \`refused (\${error})\`
    if (Object.keys(answers).length === names.length)
      post({type: 'error', message: \`documents \${names.map(name => \`\${name}=\${answers[name]}\`).join('; ')}\`})
  })
  post({type: 'ready', capabilities: {changeHighlighting: 'none', drawsRelationships: false}})
  for (const renderer of names) post({type: 'document-request', renderer})
</script></body></html>
`

/**
 * A repository whose committed projection draws with a custom renderer bundle committed beside it, with an
 * uncommitted change: the VS Code extension's Uncommitted choice on a projection with no edits.
 */
const test = base.extend<{repository: Repository; probe: Repository}>({
  repository: async ({browserName, context}, use) => {
    const template: Commit = cards(async bundle => {
      await copyFile(join(minimal, 'index.html'), join(bundle, 'index.html'))
      await copyFile(join(minimal, 'renderer.json'), join(bundle, 'renderer.json'))
    })
    await served(browserName, context, template, use)
  },
  probe: async ({browserName, context}, use) => {
    const probe: Commit = cards(async bundle => {
      await writeFile(join(bundle, 'index.html'), documentsProbe)
      await writeFile(
        join(bundle, 'renderer.json'),
        JSON.stringify({format: 'projections.renderer', version: 0, name: 'cards', title: 'Documents probe', handles: []}),
      )
    })
    await served(browserName, context, probe, use)
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

test('the Inspector supplies built-in renderer documents by name, and refuses custom and unknown names', async ({page, probe}) => {
  await page.goto(probe.url.replace('#', '?projection=cards&before=HEAD&after=working-tree&definitionRevision=HEAD#'))
  // Side by side, each pane's renderer asks and reports.
  await expect(page.getByRole('alert').first()).toContainText(
    'documents graph=html; cards=refused (cards is not a built-in renderer); no-such-renderer=refused (no-such-renderer is not a built-in renderer)',
  )
})
