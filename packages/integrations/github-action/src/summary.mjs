// Writes the run's projections to the job summary: what was compared, each projection's result, steps and
// changes, and how to review the artifact. Links a hosted view only when hosted-url is set.
import {appendFileSync} from 'node:fs'
import {summaryMarkdown} from './lib.mjs'
import {loadReport} from './report.mjs'

const environment = process.env
if (!environment.GITHUB_STEP_SUMMARY) throw new Error('GITHUB_STEP_SUMMARY must be set')
const {manifest, documents, options} = loadReport(environment)
appendFileSync(environment.GITHUB_STEP_SUMMARY, `${summaryMarkdown(manifest, documents, options)}\n`)
