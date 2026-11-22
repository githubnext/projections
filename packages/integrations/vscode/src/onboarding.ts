import * as vscode from 'vscode'
import type {Runner} from './runner.js'
import {byTitle} from './projections/definitions.js'
import {parseWrite, refusal, type ExploreCandidate, type OnboardingArguments, type OnboardingFile, type OnboardingWrite} from './writes.js'

/** The scheme of the preview documents a diff shows: the files' current and proposed contents, read-only. */
export const previewScheme = 'projections-preview'

/** Read-only documents holding a preview's contents, addressed `projections-preview:/<n>/<side>/<path>`. */
export class PreviewDocuments implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>()
  private next = 1
  private readonly changed = new vscode.EventEmitter<vscode.Uri>()
  readonly onDidChange = this.changed.event

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? ''
  }

  /** Documents for one preview's files, as `vscode.changes` takes them: `[file, before, after]`. */
  add(folder: vscode.Uri, files: readonly OnboardingFile[]): [vscode.Uri, vscode.Uri, vscode.Uri][] {
    const preview = this.next++
    // Previews are small; only the latest few are kept.
    for (const key of [...this.contents.keys()].filter(candidate => Number(vscode.Uri.parse(candidate).path.split('/')[1]) < preview - 8)) {
      this.contents.delete(key)
    }
    return files.map(file => {
      const side = (name: string, text: string) => {
        const uri = vscode.Uri.from({scheme: previewScheme, path: `/${preview}/${name}/${file.path}`})
        this.contents.set(uri.toString(), text)
        return uri
      }
      return [vscode.Uri.joinPath(folder, ...file.path.split('/')), side('current', file.before ?? ''), side('proposed', file.after)]
    })
  }
}

/** The repository's candidates not yet adopted. */
async function candidates(runner: Pick<Runner, 'request'>): Promise<ExploreCandidate[]> {
  const response = await runner.request({method: 'GET', path: '/api/explore'})
  if (response.status !== 200) throw new Error(`Could not list the candidates: ${refusal(response)}`)
  const list = (response.body as {candidates?: (ExploreCandidate | null)[]} | null)?.candidates
  if (!Array.isArray(list)) throw new TypeError('The Projections backend returned invalid candidates')
  return list.filter((candidate): candidate is ExploreCandidate => typeof candidate?.id === 'string' && !candidate.adopted)
}

/**
 * Previews a write in VS Code's multi-file diff, asks to confirm (a modal), and writes with the preview's digest.
 * A `409` means the files changed since the preview: it offers to preview again.
 */
async function previewAndWrite({
  runner,
  folder,
  previews,
  path,
  body,
  title,
  detail,
  write,
}: {
  runner: Pick<Runner, 'request'>
  folder: vscode.Uri
  previews: PreviewDocuments
  path: '/api/adopt'
  body: Record<string, unknown>
  title: string
  detail: (preview: OnboardingWrite) => string
  write: boolean
}): Promise<OnboardingWrite | undefined> {
  for (;;) {
    const response = await runner.request({method: 'POST', path, body: {...body, dryRun: true}})
    if (response.status !== 200) throw new Error(refusal(response))
    const preview = parseWrite(response.body)
    const changed = preview.files.filter(file => file.changed)
    if (!changed.length) {
      void vscode.window.showInformationMessage(`Projections: ${title}: nothing to write; the files are up to date.`)
      return preview
    }
    await vscode.commands.executeCommand('vscode.changes', `${title} (preview)`, previews.add(folder, changed))
    if (!write) return preview
    const files = changed.map(file => `${file.created ? 'Create' : 'Update'} ${file.path}`).join('\n')
    const choice = await vscode.window.showWarningMessage(
      `${title}: write ${changed.length === 1 ? '1 file' : `${changed.length} files`}?`,
      {modal: true, detail: `${files}\n\n${detail(preview)}`.trim()},
      'Write',
    )
    if (choice !== 'Write') return undefined
    const written = await runner.request({method: 'POST', path, body: {...body, digest: preview.digest}})
    if (written.status === 409) {
      const again = await vscode.window.showWarningMessage(
        `Projections: the files changed since the preview, so nothing was written.`,
        {modal: true},
        'Preview Again',
      )
      if (again === 'Preview Again') continue
      return undefined
    }
    if (written.status !== 200) throw new Error(refusal(written))
    return parseWrite(written.body)
  }
}

/** **Projections: Adopt…**: pick explored candidates, preview their definitions and bookmarks, and write them. */
export async function adopt(
  runner: Pick<Runner, 'request'>,
  folder: vscode.Uri,
  previews: PreviewDocuments,
  args: OnboardingArguments = {},
): Promise<OnboardingWrite | undefined> {
  let ids = args.projections
  if (!ids) {
    const list = await candidates(runner)
    if (!list.length) {
      void vscode.window.showInformationMessage(
        'Projections: no built-in projection to adopt applies here. Build one with projections init <id>.',
      )
      return undefined
    }
    const picked = await vscode.window.showQuickPick(
      byTitle(
        list,
        candidate => candidate.title,
        candidate => candidate.id,
      ).map(candidate => ({
        label: candidate.title,
        description: candidate.id,
        detail: `${candidate.description}${candidate.requiresTrust ? ' · Runs repository code' : ''}`,
        id: candidate.id,
      })),
      {
        canPickMany: true,
        title: 'Adopt projections',
        placeHolder: 'The projections to keep: their definitions and their best changes as bookmarks',
      },
    )
    if (!picked || picked.length === 0) return undefined
    ids = picked.map(item => item.id)
  }
  const result = await previewAndWrite({
    runner,
    folder,
    previews,
    path: '/api/adopt',
    body: {projections: ids, ...(args.bookmarks === undefined ? {} : {bookmarks: args.bookmarks})},
    title: `Adopt ${ids.join(', ')}`,
    detail: preview =>
      preview.bookmarked?.length !== undefined && preview.bookmarked.length > 0
        ? `Bookmarks ${preview.bookmarked.length} change${preview.bookmarked.length === 1 ? '' : 's'} from the latest sweep.`
        : '',
    write: args.write !== false,
  })
  if (result?.written) {
    void vscode.window.showInformationMessage(
      `Projections: adopted ${(result.adopted ?? ids).join(', ')}. Add them to your CI with Projections: Add to CI….`,
    )
  }
  return result
}
