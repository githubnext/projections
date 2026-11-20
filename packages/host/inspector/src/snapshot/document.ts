import {customComparator, type ComparisonDocument, type ExtractionDocument, type ProjectionEngine} from '@githubnext/projections-schemas'
import {loadArtifact} from '@githubnext/projections-engine/artifacts'

export type SnapshotDocument = ExtractionDocument | ComparisonDocument

/**
 * Validates the served document with the shared engine. Extractions and
 * default comparisons are verified like a saved artifact (digests recomputed,
 * the comparison rerun). A comparison made by a custom comparator, which the CLI ran in its sandbox, has both
 * extractions verified and is presented as computed.
 */
export async function snapshotDocument(value: unknown, engine: ProjectionEngine): Promise<SnapshotDocument> {
  const document = value as Partial<ComparisonDocument> | null
  const declared = document?.before?.provenance?.definition?.comparator
  if (document?.format === 'projections.comparison' && customComparator(declared)) {
    const [before, after] = await Promise.all([document.before, document.after].map(side => loadArtifact(JSON.stringify(side), {engine})))
    if (
      before?.format !== 'projections.extraction' ||
      after?.format !== 'projections.extraction' ||
      (await engine.pair(before, after)).pairing !== 'same' ||
      !document.comparison ||
      !document.comparator
    ) {
      throw new Error('The comparison does not describe two extractions of one projection definition')
    }
    return {...(document as ComparisonDocument), before, after}
  }
  const loaded = await loadArtifact(JSON.stringify(value), {engine})
  return loaded
}
