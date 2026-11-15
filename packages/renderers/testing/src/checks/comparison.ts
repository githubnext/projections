// The checks of a comparison's progress and diff: endpoints, steps, highlighting and status.
import type {Checks} from './support.js'
import {diffChecks} from './comparison/diff.js'
import {endpointChecks} from './comparison/endpoints.js'
import {statusChecks} from './comparison/status.js'
import {stepChecks} from './comparison/steps.js'

export const comparisonChecks: Pick<
  Checks,
  | 'neutral-endpoints'
  | 'step-holds'
  | 'highlight-scope'
  | 'diff-changes'
  | 'diff-neutral'
  | 'diff-clipping'
  | 'stable-layout'
  | 'status-text'
  | 'quiet-endpoints'
> = {...endpointChecks, ...stepChecks, ...diffChecks, ...statusChecks}
