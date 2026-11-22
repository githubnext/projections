// The summary check: the figures a renderer sends for the host's summary bar match the documents.
import {summaryCounts} from '@githubnext/projections-renderer-sdk/presentation'
import type {StageState} from '../../types.js'
import {Skip, primaryMode, limit, label} from '../support.js'
import type {Checks} from '../support.js'
import {countFailures, factFailures, knownIds} from './summary-figures.js'

export const summaryChecks: Pick<Checks, 'summary'> = {
  async summary(driver, subject, {modes}) {
    const mode = primaryMode(subject, modes)
    // The summary describes the whole document: a renderer with a timeline sends the same one at every progress.
    const progresses = subject.mode === 'comparison' && !mode.comparisonMode ? [0, 0.5, 1] : [1]
    await driver.load(subject, {progress: progresses[0]!, ...mode})
    const failures: string[] = []
    const seen: [number, string][] = []
    let sent: StageState['summary']
    for (const progress of progresses) {
      if (progresses.length > 1) await driver.seek(progress)
      await driver.measure('settle')
      // The summary travels beside the paint acknowledgement; give it a moment.
      await driver.sleep(50)
      sent = (await driver.state()).summary
      seen.push([progress, JSON.stringify(sent ?? null)])
    }
    const [first] = seen
    for (const [progress, summary] of seen.slice(1)) {
      if (summary !== first![1]) {
        failures.push(`The summary changes while scrubbing: ${first![1]} at ${label(first![0])} but ${summary} at ${label(progress)}.`)
      }
    }
    if (!sent || sent.length === 0) throw new Skip("The renderer sends no summary; hosts word the summary bar from the kinds' names.")
    const counts = summaryCounts(subject)
    const known = knownIds(subject)
    for (const item of sent) {
      failures.push(...(item.type === 'fact' ? factFailures(item, subject, known) : countFailures(item, subject, counts)))
    }
    return failures.slice(0, limit)
  },
}
