import type {FolderModel} from '../folder-model.js'
import type {ViewingHost} from './types.js'

/** Each folder's current branch's open pull request, asked of `gh` at most every five minutes per branch. */
export class PullRequests {
  private readonly pulls = new Map<string, {branch: string; number?: number | undefined; at: number}>()

  private readonly host: ViewingHost
  private readonly found: () => void

  constructor(host: ViewingHost, found: () => void) {
    this.host = host
    this.found = found
  }

  get(model: FolderModel) {
    return this.pulls.get(model.folder.uri.toString())
  }

  /** Asks `gh` for the branch's pull request, unless it is the default branch or was asked lately. */
  lookUp(model: FolderModel) {
    const branch = model.pairs?.head?.branch
    const key = model.folder.uri.toString()
    const known = this.pulls.get(key)
    if (!branch || branch === model.pairs?.defaultBranch) return
    if (known?.branch === branch && Date.now() - known.at < 300_000) return
    this.pulls.set(key, {branch, at: Date.now()})
    void this.host.pullRequest(model.folder, branch).then(
      number => {
        this.pulls.set(key, {branch, number, at: Date.now()})
        if (number !== undefined) this.found()
      },
      () => {},
    )
  }
}
