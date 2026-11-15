// The checks of what a renderer draws in its frame: legend, summary, layout, opening and identifiers.
import type {Checks} from './support.js'
import {contentChecks} from './frame/content.js'
import {openingChecks} from './frame/opening.js'
import {summaryChecks} from './frame/summary.js'

export const frameChecks: Pick<
  Checks,
  'legend' | 'summary' | 'phone-overflow' | 'relationships' | 'content-top' | 'opens-fitted' | 'identifiers'
> = {...contentChecks, ...summaryChecks, ...openingChecks}
