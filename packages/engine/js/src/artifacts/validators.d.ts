import type {ComparisonDocument, ExtractionDocument} from '@githubnext/projections-schemas'

interface SchemaError {
  keywordLocation: string
  instanceLocation: string
}

export interface SchemaValidator<T> {
  (value: unknown): value is T
  errors?: readonly SchemaError[] | null
}

export const validateExtractionDocument: SchemaValidator<ExtractionDocument>
export const validateComparisonDocument: SchemaValidator<ComparisonDocument>
