import {useCallback, useEffect, useRef} from 'react'
import type {RendererClient} from '@githubnext/projections-renderer-sdk/client'
import type {ControlValue, InitPayload, SummaryFactItem} from '@githubnext/projections-renderer-sdk/protocol'
import type {SummaryNouns} from '@githubnext/projections-renderer-sdk/presentation'
import {rendererSummary} from '../../summary.js'
import type {ComparisonModel} from '../../model.js'
import type {MountOptions} from './props.js'

/**
 * The summary bar's figures: counted here for every document, in the renderer's words once it names its kinds, then
 * the renderer's facts about the document. Renderers name kinds in effects, which run before the shell's, so the first
 * summary already has their words; facts wait for the document's model, so it has those too. `model` is the model of
 * the current document, once there is one. Returns `declareNouns` (see `RendererProps.declareNouns`).
 */
export function useSummaryReport(
  client: RendererClient | undefined,
  init: InitPayload | undefined,
  options: Pick<MountOptions, 'nouns' | 'facts'>,
  onError: (message: string) => void,
  document: {model: ComparisonModel | Error | undefined; controls: {[id: string]: ControlValue}},
): (nouns: SummaryNouns | undefined) => void {
  const nouns = useRef<SummaryNouns | undefined>(options.nouns)
  const summarized = useRef<{model?: ComparisonModel | Error; controls: {[id: string]: ControlValue}}>({controls: {}})
  const sentSummary = useRef('')
  const sendSummary = useRef(() => {})
  sendSummary.current = () => {
    if (!client || !init) return
    const {model: current, controls: values} = summarized.current
    if (options.facts && !current) return
    let facts: readonly SummaryFactItem[] = []
    if (options.facts && current && !(current instanceof Error)) {
      try {
        facts = options.facts({init, model: current, controls: values, rendererName: init.projection.renderer})
      } catch (error) {
        onError(`The renderer's summary facts failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    try {
      const summary = rendererSummary(init, nouns.current, facts)
      const key = JSON.stringify(summary)
      if (key === sentSummary.current) return
      sentSummary.current = key
      client.summary(summary)
    } catch {
      // A summary the protocol refuses leaves the host's own words.
    }
  }
  const declareNouns = useCallback(
    (next: SummaryNouns | undefined) => {
      nouns.current = next ?? options.nouns
      sendSummary.current()
    },
    [options.nouns],
  )
  summarized.current = {...(document.model ? {model: document.model} : {}), controls: document.controls}
  useEffect(() => sendSummary.current(), [client, init, document.model, document.controls])
  return declareNouns
}
