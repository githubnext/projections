// What every check shares: its settings, outcomes other than failures, and waiting and sampling.
import {defaultComparisonMode} from '@githubnext/projections-renderer-sdk/protocol'
import type {ComparisonMode, RendererOptions} from '@githubnext/projections-renderer-sdk/protocol'
import type {CheckId, EntitySample, StageSubject} from '../types.js'
import type {CheckDriver} from './catalog.js'

export class Skip extends Error {}
/** A pass with details to report, such as the subtrees a styling check exempted. */
export class Passed extends Error {
  constructor(readonly details: string[]) {
    super('passed')
  }
}

export const progressModes: readonly ComparisonMode[] = ['animated', 'side-by-side', 'swipe']

export interface Settings {
  maxEntities: number
  phoneWidth: number
  /** The renderer's declared comparison modes. */
  modes: readonly ComparisonMode[]
  /** The renderer options the subject is presented with (see `CheckOptions.rendererOptions`). */
  rendererOptions: RendererOptions
}

/** The mode a host presents a comparison in by default (`defaultComparisonMode`); a stage has one frame, so only diff differs. */
export function primaryMode(subject: StageSubject, modes: readonly ComparisonMode[]): {comparisonMode?: ComparisonMode} {
  return subject.mode === 'comparison' && defaultComparisonMode(modes) === 'diff' ? {comparisonMode: 'diff'} : {}
}
export const limit = 10

export async function until(predicate: () => Promise<boolean>, driver: CheckDriver, timeoutMs = 1500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await driver.sleep(30)
  }
  return predicate()
}

export async function samples(driver: CheckDriver): Promise<Map<string, EntitySample>> {
  await driver.measure('settle')
  return new Map((await driver.measure<EntitySample[]>('samples')).map(sample => [sample.key, sample]))
}

export const label = (progress: number) =>
  progress === 0 ? 'Before (progress 0)' : progress === 1 ? 'After (progress 1)' : `progress ${progress}`

export type Checks = Record<CheckId, (driver: CheckDriver, subject: StageSubject, options: Settings) => Promise<string[]>>
