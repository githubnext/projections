import {DOCS_BASE} from './docs.ts'

/**
 * Add to CI: where the Projections GitHub Action step goes depends on the repository's own CI (usually the job that
 * already installs and builds), which takes judgment, so the extension writes nothing. It hands this prompt, the same
 * as docs/setup/ci.md's, to the coding agent, which reads the workflows and proposes the change.
 */
export const addToCiPrompt = "Add Projections to this repository's CI: run `projections help agents ci` and follow what it prints."

/** The guide to adding Projections to CI, on GitHub. */
export const addToCiGuide = `${DOCS_BASE}docs/setup/ci.md`

/** What Add to CI… does: hand the prompt to the agent in chat, copy it for another agent, or open the guide. */
export type AddToCiChoice = 'agent' | 'copy' | 'guide'

export function isAddToCiChoice(value: unknown): value is AddToCiChoice {
  return value === 'agent' || value === 'copy' || value === 'guide'
}
