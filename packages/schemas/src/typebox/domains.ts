import Type, {type TSchema} from 'typebox'
import {domainSchemas, vocabularyNames, type DomainSchema, type Vocabulary} from '../constants.js'
import {dataRules, domainDescriptions, vocabularies, type DataRule, type FieldRule, type PrimitiveType, type Shape} from '../domains.js'
import {ExtractionSchema, Text} from './extraction.js'
import {annotated, define} from './support.js'

/** The published document name of a domain schema: `database/v0` is `database` (`/schemas/database/v0.json`). */
export const domainDocument = (schema: DomainSchema) => schema.replace(/\/v\d+$/u, '')
/** The published document name of a vocabulary: `vocabularies/dependency-injection` for `dependency-injection/v0`. */
export const vocabularyDocument = (vocabulary: Vocabulary) => `vocabularies/${vocabulary.replace(/\/v\d+$/u, '')}`

// As the engine checks them: numbers are any finite JSON number.
const primitiveSchemas: Record<PrimitiveType, () => object> = {
  text: () => Text,
  string: () => ({type: 'string'}),
  number: () => ({type: 'number'}),
  nonnegative: () => ({type: 'number', minimum: 0}),
  boolean: () => ({type: 'boolean'}),
  'nullable-string': () => ({type: ['string', 'null']}),
  strings: () => ({type: 'array', items: {type: 'string'}}),
  object: () => ({type: 'object'}),
}

// A named record is defined once in its schema's document; every use refers to it.
const records = new Map<string, TSchema>()

/** The JSON Schema of a shape, in the document of `schema`. */
function shapeSchema(shape: Shape, schema: DomainSchema): TSchema {
  switch (shape.type) {
    case 'enum':
      return {enum: [...shape.values]}
    case 'array':
      return {type: 'array', items: shapeSchema(shape.items, schema)}
    case 'record': {
      const key = `${schema}#${shape.name}`
      if (!records.has(key)) {
        records.set(
          key,
          define(domainDocument(schema), shape.name, Type.Unsafe({description: shape.about, ...fieldsSchema(shape.fields, schema)})),
        )
      }
      return records.get(key)!
    }
    case 'text':
    case 'string':
    case 'number':
    case 'nonnegative':
    case 'boolean':
    case 'nullable-string':
    case 'strings':
    case 'object':
      return primitiveSchemas[shape.type]()
  }
}

/** A closed object of typed fields. */
function fieldsSchema(fields: Readonly<Record<string, FieldRule>>, schema: DomainSchema) {
  const required = Object.entries(fields).flatMap(([name, field]) => (field.required ? [name] : []))
  return {
    type: 'object',
    additionalProperties: false,
    ...(required.length ? {required} : {}),
    properties: Object.fromEntries(
      Object.entries(fields).map(([name, field]) => [
        name,
        annotated(shapeSchema(field as Shape, schema), {description: field.description}),
      ]),
    ),
  }
}

/** What one rule requires of an item's `data`. */
function dataSchema(rule: DataRule) {
  const required = Object.entries(rule.fields).flatMap(([name, field]) => (field.required ? [name] : []))
  const data = {
    type: 'object',
    ...(required.length ? {required} : {}),
    properties: Object.fromEntries(
      Object.entries(rule.fields).map(([name, field]) => [
        name,
        annotated(shapeSchema(field as Shape, rule.schema), {description: field.description}),
      ]),
    ),
  }
  const item = {type: 'object', ...(required.length ? {required: ['data']} : {}), properties: {data}}
  return rule.kinds ? {if: {type: 'object', required: ['kind'], properties: {kind: {enum: [...rule.kinds]}}}, then: item} : item
}

function itemsSchema(rules: DataRule[]) {
  return {type: 'array', items: rules.length === 1 ? dataSchema(rules[0]!) : {type: 'object', allOf: rules.map(dataSchema)}}
}

function refinementOf(rules: DataRule[], schema: object, description: string) {
  const of = (collection: DataRule['collection']) => rules.filter(rule => rule.collection === collection)
  const properties: Record<string, object> = {schema}
  if (of('entities').length) properties.entities = itemsSchema(of('entities'))
  if (of('relationships').length) properties.relationships = itemsSchema(of('relationships'))
  return Type.Unsafe({description, type: 'object', properties})
}

const rules = dataRules as readonly DataRule[]

/** What each domain schema adds to the envelope, as its document's `refinement` definition. */
export const domainRefinements = Object.fromEntries(
  domainSchemas.map(schema => [
    schema,
    define(
      domainDocument(schema),
      'refinement',
      refinementOf(
        rules.filter(rule => rule.schema === schema && !rule.vocabulary),
        {const: schema},
        `What \`${schema}\` adds to the extraction envelope.`,
      ),
    ),
  ]),
) as unknown as Record<DomainSchema, TSchema>

/** What each vocabulary adds to an extraction that declares it, including the schemas it applies to. */
export const vocabularyRefinements = Object.fromEntries(
  vocabularyNames.map(vocabulary => {
    const {schemas} = vocabularies[vocabulary]
    return [
      vocabulary,
      define(
        vocabularyDocument(vocabulary),
        'refinement',
        refinementOf(
          rules.filter(rule => rule.vocabulary === vocabulary),
          {enum: [...schemas]},
          `What \`${vocabulary}\` adds to an extraction that declares it.`,
        ),
      ),
    ]
  }),
) as unknown as Record<Vocabulary, TSchema>

/** Each domain schema's document: the extraction envelope with its schema's refinement. */
export const domainSchemaDocuments = [
  ...domainSchemas.map(schema => ({
    name: domainDocument(schema),
    title: `Projections domain schema ${schema}`,
    schema: define(
      domainDocument(schema),
      undefined,
      Type.Unsafe({description: domainDescriptions[schema], allOf: [ExtractionSchema, domainRefinements[schema]]}),
    ),
  })),
  ...vocabularyNames.map(vocabulary => ({
    name: vocabularyDocument(vocabulary),
    title: `Projections vocabulary ${vocabulary}`,
    schema: define(
      vocabularyDocument(vocabulary),
      undefined,
      Type.Unsafe({
        description: `${vocabularies[vocabulary].description} Defined in ${vocabularies[vocabulary].document}.`,
        allOf: [
          ExtractionSchema,
          {type: 'object', required: ['vocabularies'], properties: {vocabularies: {contains: {const: vocabulary}}}},
          vocabularyRefinements[vocabulary],
        ],
      }),
    ),
  })),
]

// The envelope applies the refinement of the schema an extraction names, and of each vocabulary it declares,
// so validating against the extraction schema alone checks every rule the engine's table does.
Object.assign(ExtractionSchema, {
  allOf: [
    ...domainSchemas.map(schema => ({
      if: {required: ['schema'], properties: {schema: {const: schema}}},
      then: domainRefinements[schema],
    })),
    ...vocabularyNames.map(vocabulary => ({
      if: {required: ['vocabularies'], properties: {vocabularies: {contains: {const: vocabulary}}}},
      then: vocabularyRefinements[vocabulary],
    })),
  ],
})
