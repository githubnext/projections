// Runs the checks against one subject.
import type {ComparisonMode} from '@githubnext/projections-renderer-sdk/protocol'
import type {CheckResult, StageState, StageSubject} from '../types.js'
import {checkTitles, allChecks, type CheckDriver, type CheckOptions} from './catalog.js'
import {Skip, Passed, progressModes, type Settings, type Checks} from './support.js'
import {styleChecks} from './style.js'
import {comparisonChecks} from './comparison.js'
import {frameChecks} from './frame.js'
import {interactionChecks} from './interaction.js'
import {accentChecks} from './accents.js'

/** The comparison modes a renderer declared, in preference order (the SDK's default when it declares none). */
export function declaredModes(state: Pick<StageState, 'capabilities'>): readonly ComparisonMode[] {
  return state.capabilities?.comparisonModes?.length ? state.capabilities.comparisonModes : progressModes
}

const run: Checks = {...styleChecks, ...comparisonChecks, ...interactionChecks, ...frameChecks, ...accentChecks}

/** Runs the checks in order against one subject. A failure to load or measure fails that check, not the run. */
export async function runChecks(driver: CheckDriver, subject: StageSubject, options: CheckOptions = {}): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  let modes: readonly ComparisonMode[] = progressModes
  try {
    modes = declaredModes(await driver.load(subject, {progress: 1}))
  } catch {
    // Each check loads again and reports the failure itself.
  }
  const settings: Settings = {
    maxEntities: options.maxEntities ?? 14,
    phoneWidth: options.phoneWidth ?? 390,
    modes,
    rendererOptions: options.rendererOptions ?? {},
  }
  for (const id of options.checks ?? allChecks) {
    const started = Date.now()
    let result: CheckResult
    try {
      const failures = await run[id](driver, subject, settings)
      result = {id, title: checkTitles[id], status: failures.length ? 'fail' : 'pass', details: failures, durationMs: 0}
    } catch (error) {
      result =
        error instanceof Passed
          ? {id, title: checkTitles[id], status: 'pass', details: error.details, durationMs: 0}
          : error instanceof Skip
            ? {id, title: checkTitles[id], status: 'skip', details: [error.message], durationMs: 0}
            : {id, title: checkTitles[id], status: 'fail', details: [error instanceof Error ? error.message : String(error)], durationMs: 0}
    }
    result.durationMs = Date.now() - started
    results.push(result)
    options.onResult?.(result)
  }
  return results
}
