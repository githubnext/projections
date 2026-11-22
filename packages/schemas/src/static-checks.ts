import type {Static} from 'typebox'
import * as T from './index.js'
import type * as S from './typebox/index.js'

// Compile-time checks: each named public type is interchangeable with its schema's static type, so the
// interfaces in `index.ts` can't drift from the schemas that generate the published JSON Schemas.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Check<T extends true> = T

export type StaticChecks = [
  Check<Same<T.Extraction, Static<typeof S.ExtractionSchema>>>,
  Check<Same<T.Comparison, Static<typeof S.ComparisonSchema>>>,
  Check<Same<T.Definition, Static<typeof S.DefinitionSchema>>>,
  Check<Same<T.ExtractorRequest, Static<typeof S.ExtractorRequestSchema>>>,
  Check<Same<T.Provenance, Static<typeof S.ProvenanceSchema>>>,
  Check<Same<T.ExtractionDocument, Static<typeof S.ExtractionDocumentSchema>>>,
  Check<Same<T.ComparisonDocument, Static<typeof S.ComparisonDocumentSchema>>>,
  Check<Same<T.ArtifactManifest, Static<typeof S.ArtifactManifestSchema>>>,
  // A scenario is the schema's stricter `oneOf`: one extraction, or before and after.
  Check<[T.Scenario] extends [Static<typeof S.ScenarioSchema>] ? true : false>,
  Check<Same<T.ScenarioExtraction, Static<typeof S.ScenarioExtractionSchema>>>,
  Check<Same<Omit<T.ScenariosDocument, 'scenarios'>, Omit<Static<typeof S.ScenariosDocumentSchema>, 'scenarios'>>>,
]

/** Domain types: typed kinds narrow to their `data`; other kinds keep open JSON. Never called. */
export function domainTypeChecks(db: T.DatabaseExtraction, metrics: T.MetricsExtraction, api: T.ApiExtraction, any: T.DomainExtraction) {
  for (const entity of db.entities) {
    if (T.isKind(entity, 'column')) {
      const type: string = entity.data.type
      const databaseType: string | null | undefined = entity.data.databaseType
      const nullable: boolean | undefined = entity.data.nullable
      void [type, databaseType, nullable]
    }
    if (T.isKind(entity, 'table')) {
      // @ts-expect-error A kind the schema doesn't type has no typed fields.
      const type: string = entity.data.type
      void [type, entity.data.anything]
    }
  }
  for (const relationship of db.relationships) {
    if (T.isKind(relationship, 'relation')) {
      const columns: string[] | undefined = relationship.data.columns
      void columns
    }
  }
  const value: number = metrics.entities[0]!.data.value
  for (const entity of api.entities) {
    if (T.isKind(entity, 'method')) {
      const signature: string = entity.data.signature
      void signature
    }
  }
  if (any.schema === 'metrics/v0') void (any.entities[0]!.data.value satisfies number)
  const general: T.Extraction = db
  void [value, general]
}
