// The browser runtime every story shares: the Wasm engine, the renderer catalog and the comparator Worker.
import {customComparator, type ExtractionDocument, type ProjectionEngine} from '@githubnext/projections-schemas'
import {createWasmEngine} from '@githubnext/projections-engine/browser'
import engineWasm from '@githubnext/projections-engine/engine.wasm?url'
import defaultComparatorWasm from '@githubnext/projections-engine/default-comparator.wasm?url'
import {createRulesRuntime} from '@githubnext/projections-comparator-runtime/browser'
import {loadRendererCatalog} from '@githubnext/projections-host'
import type {ComparatorSource, RendererEntry, RulesRuntime} from '@githubnext/projections-host'

/** A static asset (`scripts/assets.mjs`), resolved against `iframe.html` at the Storybook root. */
export const asset = (path: string) => new URL(path, document.baseURI)

/** The browser runtime every story shares (`loadRuntime`): the Wasm engine and the renderer catalog. */
export interface Runtime {
  engine: ProjectionEngine
  /** Every built-in renderer bundle and the example template (`renderers/index.json`). */
  renderers: RendererEntry[]
}

let runtime: Promise<Runtime> | undefined

/** Starts the engine and loads the renderer catalog once per page. */
export function loadRuntime(): Promise<Runtime> {
  runtime ??= Promise.all([
    createWasmEngine({url: new URL(engineWasm, location.href)}, {url: new URL(defaultComparatorWasm, location.href)}),
    loadRendererCatalog({base: asset('renderers/')}),
  ]).then(([engine, renderers]) => ({engine, renderers}))
  return runtime
}

/** Checks and runs comparator files in the same-origin Worker. */
export const rules: RulesRuntime = createRulesRuntime({
  deadlineMs: 10_000,
  workerUrl: asset('comparator/worker-entry.js'),
  rulesInterpreterUrl: asset('comparator/rules.wasm'),
})

/** `ComparisonPairOptions.loadComparator`: the comparator file a definition declares, or the default comparator. */
export async function loadComparator(document: ExtractionDocument): Promise<ComparatorSource> {
  const file = customComparator(document.provenance.definition.comparator)?.file
  if (file) {
    const response = await fetch(asset(file))
    if (!response.ok) throw new Error(`Comparator file request failed (${response.status})`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {kind: 'rules', id: file, bytes, digest: (await rules.check(bytes)).digest}
  }
  return {kind: 'default'}
}
