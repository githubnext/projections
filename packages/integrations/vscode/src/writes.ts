// What Adopt previews and writes (`POST /api/adopt`), without VS Code, for tests.
import type {RunnerResponse} from './runner.js'

/** A file Adopt would write (`POST /api/adopt` with `dryRun`). */
export interface OnboardingFile {
  path: string
  before: string | null
  after: string
  created: boolean
  changed: boolean
}

export interface OnboardingWrite {
  files: OnboardingFile[]
  digest: string
  written: boolean
  adopted?: string[]
  bookmarked?: {id: string; projection: string}[]
}

export interface ExploreCandidate {
  id: string
  title: string
  description: string
  adopted: string | null
  requiresTrust: boolean
}

/** What the commands accept from another extension or a test: skip the pick, and stop after the preview. */
export interface OnboardingArguments {
  /** Adopt: the candidates to adopt, instead of asking. */
  projections?: string[]
  /** Adopt: bookmarks per projection from the latest sweep (0-20). */
  bookmarks?: number
  /** `false`: preview only, writing nothing. */
  write?: boolean
}

/** The backend's message for a refused request: its first diagnostic, else the body. */
export function refusal(response: RunnerResponse): string {
  const body = response.body as {diagnostics?: {message?: unknown}[]} | string | null
  const message = typeof body === 'object' && body !== null ? body.diagnostics?.[0]?.message : body
  return `${typeof message === 'string' && message ? message : JSON.stringify(response.body)} (${response.status})`
}

export function parseWrite(value: unknown): OnboardingWrite {
  const write = value as Partial<OnboardingWrite> | null
  if (!write || !Array.isArray(write.files) || typeof write.digest !== 'string' || typeof write.written !== 'boolean') {
    throw new Error('The Projections backend returned an invalid preview')
  }
  for (const file of write.files as (Partial<OnboardingWrite['files'][number]> | null)[]) {
    if (typeof file?.path !== 'string' || typeof file.after !== 'string' || (file.before !== null && typeof file.before !== 'string')) {
      throw new Error('The Projections backend returned an invalid preview')
    }
  }
  return write as OnboardingWrite
}
