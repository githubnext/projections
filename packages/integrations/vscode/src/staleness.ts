/*
 * Whether a projection result is out of date, behind one interface with two sources of truth:
 *
 * - **Identity** (local execution M2): the result's `provenance.execution` (`tree`, `fidelity`) and
 *   `provenance.definitionDigest`, against the working tree's identity (`GET /api/identity?projection=`, or `tree` on
 *   the `changes` notification). `scopedTree` stands in for `tree` only when `scopeVerified`.
 * - **Changes** (until then): a result taken before a generation whose `changes` touch its projection is out of date.
 *
 * `fidelity: "stale"` (the tree changed while it ran) is out of date at once, in either mode. A toolchain extractor run
 * in place keeps the changes rule too, since a tree misses the ignored files it reads. Renderer changes never make a
 * result out of date: the renderer reloads, which is a view, not a result. Nothing here imports VS Code, so it is unit
 * tested on its own: `staleness/changes.ts` and `staleness/identity.ts` are the two rules, and `staleness/notices.ts`
 * words the result (badges, notices and titles).
 */
import type {Pair} from './projections/pairs.js'
import {staleByChanges} from './staleness/changes.ts'
import {readsEdits, workingTree} from './staleness/edits.ts'
import {staleByIdentity} from './staleness/identity.ts'

/**
 * One side's result, as the tab reports it (`InspectorSummary.results`): `provenance.execution` as local execution
 * records the run that observed it (`source`, `fidelity`, `tree`, `determinism`, `environment`, `at`, and for a CI
 * artifact `official` and `ci`), and `provenance.definitionDigest`.
 */
export interface SideResult {
  ref: string
  job?: string
  definitionDigest?: string
  execution?: {
    source?: string
    fidelity?: string
    tree?: string
    strategy?: string
    /** `pure`, `environmental` or `observed` (live or varying data, such as timings). */
    determinism?: string
    /** The environment fingerprint. */
    environment?: string
    /** When it ran, UTC. */
    at?: string
    /** The commit's official extraction: the one the repository's own CI published, authenticated. */
    official?: boolean
    ci?: {repository?: string; run?: number | string; workflow?: string; authentication?: 'download' | 'attestation'}
    /** The repository paths the extractor depended on (local execution M5). */
    scope?: string[]
  }
  /**
   * The result's scope identity: `scopedTree` (`scope.ts`) of its `execution.tree` over its `execution.scope`, which
   * the host computes when the result arrives; it is compared with the working tree's when the scope is verified.
   */
  scopedTree?: string
}

/** A result as the extension stamped it when it arrived. */
export interface ResultStamp {
  projection: string
  pair: Pair
  /** The `changes` generation when its extraction started. */
  generation: number
  /** `HEAD`'s commit then, for symbolic refs (`HEAD`, `HEAD~1`, a branch). */
  head?: string
  sides: SideResult[]
  /**
   * The revision whose definition it applied (`working-tree`, your edits; `HEAD`, the committed version). A committed
   * definition isn't made out of date by editing the definition file while the tab keeps showing the committed version
   * (Show committed), but is when `HEAD` moves, or when the tab now applies the edits.
   */
  definition?: string
  /** The working tree's tree then, for "N files changed" when no side carries its own. */
  tree?: string
}

/** One `changes` notification: what changed since the generation before it. */
export interface ChangeRecord {
  generation: number
  changes: string[]
  complete: boolean
  /** The working tree's tree after the change (local execution M2), when the backend computed it. */
  tree?: string
}

/**
 * The working tree's identity for a projection (`GET /api/identity?projection=`): its tree and definition digest
 * (local execution M2) and, for a projection with a scope (declared, or implied by a built-in's inputs; M5), the
 * scope, its `scopedTree` (`sha256:` of the scope paths' Git objects) and whether the scope is verified (enforced by
 * the SDK for a built-in, or checked by `projections check`).
 */
export interface WorkingIdentity {
  tree: string
  definitionDigest?: string
  scope?: string[]
  scopedTree?: string
  scopeVerified?: boolean
}

/** Why a result is out of date: its extraction (extract again) or only its comparison (compare again). */
export interface Staleness {
  tier: 'extraction' | 'comparison'
  why: 'working tree' | 'definition' | 'extractor' | 'comparator' | 'refs moved' | 'changed while extracting'
}

export interface StalenessInput {
  /** The `changes` notifications seen, oldest first. */
  records: readonly ChangeRecord[]
  /** `HEAD`'s commit now. */
  head?: string
  /** The working tree's identity now, when the backend reports it; the changes rule otherwise. */
  identity?: WorkingIdentity
  /** Whether the projection's extractor is a toolchain (repository code), which in place reads ignored files too. */
  toolchain?: boolean
  /** The tab compares again on its own when the comparator changes (the Inspector's `refresh: 'compare'`). */
  recompares?: boolean
  /**
   * The revision whose definition the tab applies now (`working-tree` while the projection has edits, unless the tab
   * shows the committed version). A result applying the committed definition in a tab that now applies the edits is
   * out of date when the definition changes, so Refresh applies them.
   */
  definition?: string
}

/**
 * When a result is an observation (`determinism: "observed"`, live or varying data): the earliest side's `at`. Such a
 * result says when it was observed instead of whether it is out of date.
 */
export function observation(stamp: ResultStamp): {at?: string} | undefined {
  const observed = stamp.sides.filter(side => side.execution?.determinism === 'observed')
  if (!observed.length) return undefined
  const at = observed
    .map(side => side.execution?.at)
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .toSorted((a, b) => Date.parse(a) - Date.parse(b))[0]
  return at ? {at} : {}
}

/**
 * Whether a result is out of date, and why; nothing when it is current. `fidelity: "stale"` is out of date at once; an
 * observation (`observation`) is never judged out of date, since rerunning it may differ anyway: it says when it ran.
 */
export function staleness(stamp: ResultStamp, input: StalenessInput): Staleness | undefined {
  if (stamp.sides.some(side => side.execution?.fidelity === 'stale')) return {tier: 'extraction', why: 'changed while extracting'}
  if (observation(stamp)) return undefined
  if (!input.identity) return staleByChanges(stamp, input)
  const byIdentity = staleByIdentity(stamp, input.identity, input.definition)
  if (byIdentity) return byIdentity
  const byChanges = staleByChanges(stamp, input)
  // With an identity, the changes rule still says what a tree can't: the comparator, refs that moved, extractor code a
  // committed side ran, a definition when the identity has no digest, and what a toolchain run in place read beyond
  // the tree (ignored files).
  if (!byChanges) return undefined
  if (byChanges.why === 'comparator' || byChanges.why === 'refs moved' || byChanges.why === 'extractor') return byChanges
  if (byChanges.why === 'definition' && !input.identity.definitionDigest) return byChanges
  const inPlaceToolchain =
    input.toolchain && stamp.sides.some(side => side.ref === workingTree && side.execution?.source === 'local-in-place')
  return inPlaceToolchain && byChanges.why === 'working tree' ? byChanges : undefined
}

/** Where definition files live: a change there is a definition change. */
const definitionDirectories = ['.github/projections/', '.projections/']

/**
 * The changed files that bear on a result: for one applying the committed definition in a tab that keeps showing it
 * (Show committed), the definition files are left out (editing them doesn't change what the result read); otherwise
 * all of them. `applies` is the revision whose definition the tab applies now. The projection's presentation files
 * (`presentation`: its renderer's package and sources, its comparator file) never bear on it: a renderer edit reloads
 * the view and a comparator edit compares again, though both change the definition's digest.
 */
export function relevantFiles(
  stamp: ResultStamp,
  files: readonly string[],
  applies?: string,
  presentation: readonly string[] = [],
): string[] {
  const under = (path: string, roots: readonly string[]) =>
    roots.some(root => path === root.replace(/\/+$/u, '') || path.startsWith(root.endsWith('/') ? root : `${root}/`))
  return files.filter(path => !under(path, presentation) && (readsEdits(stamp, applies) || !under(path, definitionDirectories)))
}
