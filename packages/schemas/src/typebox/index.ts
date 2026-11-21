import type {TSchema} from 'typebox'
import * as bookmarks from './bookmarks.js'
import * as comparison from './comparison.js'
import * as comparatorFile from './comparator.js'
import * as comparatorTests from './comparator-tests.js'
import * as definition from './definition.js'
import {domainSchemaDocuments} from './domains.js'
import * as documents from './documents.js'
import * as environment from './environment.js'
import * as extraction from './extraction.js'
import * as renderer from './renderer.js'
import * as scenarios from './scenarios.js'

export * from './bookmarks.js'
export * from './comparison.js'
export * from './comparator.js'
export * from './comparator-tests.js'
export * from './definition.js'
export * from './documents.js'
export * from './environment.js'
export * from './domains.js'
export * from './extraction.js'
export * from './renderer.js'
export * from './scenarios.js'
export {emit, type EmittedSchema} from './emit.js'
export {homeOf, type Home} from './support.js'

/** A published JSON Schema document: its root schema, and every schema exported as one of its `$defs`. */
export interface SchemaDocument {
  name: string
  title: string
  schema: TSchema
}

/** Every published document. Shared definitions are found from the `define` markers. */
export const schemaDocuments: SchemaDocument[] = [
  {name: 'extraction', title: 'Projections extraction', schema: extraction.ExtractionSchema},
  {name: 'comparison', title: 'Projections comparison', schema: comparison.ComparisonSchema},
  {name: 'definition', title: 'Projections projection definition', schema: definition.DefinitionSchema},
  {name: 'extraction-document', title: 'Projections saved extraction', schema: documents.ExtractionDocumentSchema},
  {name: 'comparison-document', title: 'Projections saved comparison', schema: documents.ComparisonDocumentSchema},
  {name: 'extractor-request', title: 'Projections extractor stdin', schema: documents.ExtractorRequestSchema},
  {name: 'artifact', title: 'Projections CI artifact manifest', schema: documents.ArtifactManifestSchema},
  {name: 'scenarios', title: 'Projections scenarios', schema: scenarios.ScenariosDocumentSchema},
  {name: 'environment', title: 'Projections environment', schema: environment.EnvironmentSchema},
  {name: 'comparator', title: 'Projections comparator file', schema: comparatorFile.ComparatorFileSchema},
  {name: 'comparator-tests', title: 'Projections comparator tests', schema: comparatorTests.ComparatorTestsSchema},
  {name: 'bookmarks', title: 'Projections bookmarks', schema: bookmarks.BookmarksSchema},
  {name: 'renderer', title: 'Projections renderer manifest', schema: renderer.RendererManifestSchema},
  ...domainSchemaDocuments,
]
