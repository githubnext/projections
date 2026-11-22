// The working tree's identity for a projection, which says whether a tab's result is out of date: the backend's answer
// to `GET /api/identity?projection=` (local execution M2) where it gives one, else the latest `tree` a `changes`
// notification carried (the changes rule).
import type {Lease} from '../backends.js'
import type {ChangeRecord, WorkingIdentity} from '../staleness.js'

export class WorkingIdentities {
  /** Whether the backend answers `GET /api/identity`; unknown until asked. */
  private supported: boolean | undefined

  private readonly lease: Lease

  constructor(lease: Lease) {
    this.lease = lease
  }

  /** A replaced backend is asked again. */
  reset() {
    this.supported = undefined
  }

  /** A projection's identity, from the backend else `records`; nothing until the backend reports either. */
  async of(projection: string, records: readonly ChangeRecord[]): Promise<WorkingIdentity | undefined> {
    if (this.supported !== false) {
      try {
        const runner = await this.lease.current()
        const response = await runner.request({method: 'GET', path: `/api/identity?projection=${encodeURIComponent(projection)}`})
        const body = response.body as Partial<WorkingIdentity> | null
        if (response.status === 200 && typeof body?.tree === 'string') {
          this.supported = true
          return body as WorkingIdentity
        }
        if (response.status === 404 && this.supported === undefined) this.supported = false
      } catch {
        // The changes rule, below.
      }
    }
    const tree = [...records].reverse().find(record => record.tree)?.tree
    return tree ? {tree} : undefined
  }
}
