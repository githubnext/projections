import Type from 'typebox'
import {domainSchemas, vocabularyNames, type Json} from '../constants.js'
import {annotated, Closed, define, Dictionary, NonBlank} from './support.js'

const document = 'extraction'
const safe = Number.MAX_SAFE_INTEGER

/** A string that isn't empty or only whitespace, as IDs and kinds must be; the extraction schema's `$defs/text`. */
export const Text = define(document, 'text', NonBlank())
/**
 * A number within ±`Number.MAX_SAFE_INTEGER`, the extraction schema's `$defs/number`. JSON Schema can't say finite or
 * safe-integer; the engine rejects the rest.
 */
export const SafeNumber = define(document, 'number', Type.Number({minimum: -safe, maximum: safe}))
/** Any JSON value whose numbers are `SafeNumber`s, typed as `Json`; the extraction schema's `$defs/json`. */
export const JsonValue = define(
  document,
  'json',
  Type.Unsafe<Json>({
    anyOf: [
      {type: 'null'},
      {type: 'boolean'},
      {type: 'string'},
      {$ref: '#/$defs/number'},
      {type: 'array', items: {$ref: '#/$defs/json'}},
      {type: 'object', additionalProperties: {$ref: '#/$defs/json'}},
    ],
  }),
)
/**
 * An open JSON object: an item's `data`, an extraction's `metadata`, a definition's `inputs` or a custom comparator's
 * `options`. Domain schemas type some of its fields per kind; the extraction schema's `$defs/data`.
 */
export const Data = define(document, 'data', Dictionary(JsonValue))
/** One of `domainSchemas`, an extraction's `schema`; the extraction schema's `$defs/domainSchema`. */
export const DomainSchemaName = define(document, 'domainSchema', Type.Enum([...domainSchemas]))
/** One of `vocabularyNames`, an entry of an extraction's `vocabularies`; the extraction schema's `$defs/vocabulary`. */
export const VocabularyName = define(document, 'vocabulary', Type.Enum([...vocabularyNames]))
/** An item's `confidence`, the `Confidence` type; the extraction schema's `$defs/confidence`. */
export const ConfidenceLevel = define(document, 'confidence', Type.Enum(['authoritative', 'derived', 'inferred']))
/**
 * The distinct IDs an item had at earlier revisions, declaring identity continuity for comparators; the extraction
 * schema's `$defs/previousIds`. Several items may claim one previous ID, which declares a split.
 */
export const PreviousIds = define(document, 'previousIds', Type.Array(Text, {uniqueItems: true}))
const Position = Type.Integer({minimum: 1, maximum: safe})
/** The JSON Schema of `Evidence`, the extraction schema's `$defs/evidence`. */
export const EvidenceSchema = define(
  document,
  'evidence',
  Closed({
    kind: Text,
    source: Text,
    location: Type.Optional(Closed({line: Position, column: Type.Optional(Position)})),
  }),
)

const annotations = {
  data: Type.Optional(Data),
  previousIds: Type.Optional(PreviousIds),
  evidence: Type.Optional(Type.Array(EvidenceSchema)),
  confidence: Type.Optional(ConfidenceLevel),
}

// The engine requires entity labels and allows empty ones; relationship labels are optional.
/** The JSON Schema of an `Entity`, the extraction schema's `$defs/entity`. */
export const EntitySchema = define(document, 'entity', Closed({id: Text, kind: Text, label: Type.String(), ...annotations}))
/** The JSON Schema of a `Relationship`, the extraction schema's `$defs/relationship`. */
export const RelationshipSchema = define(
  document,
  'relationship',
  Closed({id: Text, kind: Text, from: Text, to: Text, label: Type.Optional(Type.String()), ...annotations}),
)

const Pointer = Type.String({
  pattern: '^/data/([^~]|~[01])*$',
  maxLength: 1024,
})
const Bound = Type.Number({minimum: 0})
/**
 * The JSON Schema of a `Tolerance`, the extraction schema's `$defs/tolerance`: at least one bound, and `factor` only
 * with `spread`.
 */
export const ToleranceSchema = define(
  document,
  'tolerance',
  Closed(
    {
      absolute: Type.Optional(annotated(Bound, {description: 'Within when `|after − before| ≤ absolute`.'})),
      relative: Type.Optional(annotated(Bound, {description: 'Within when `|after − before| ≤ relative × max(|before|, |after|)`.'})),
      spread: Type.Optional(
        annotated(Pointer, {
          description:
            "A pointer under `/data/` into the same item naming the spread the extractor recorded, such as a standard deviation. Within when `|after − before| ≤ factor × √(spread_before² + spread_after²)`; a spread missing or not a finite nonnegative number on either side can't hold. Its `*` segments take the keys the path's `*` segments matched, in order.",
        }),
      ),
      factor: Type.Optional(annotated(Bound, {description: 'Scales the spread bound; defaults to 1. Requires `spread`.'})),
    },
    {
      description:
        'How much a numeric value may vary. Within when any declared bound holds; values that are not numbers on both sides are beyond.',
      anyOf: [{required: ['absolute']}, {required: ['relative']}, {required: ['spread']}],
      dependentRequired: {factor: ['spread']},
    },
  ),
)
/**
 * The JSON Schema of a `Volatile` declaration, the extraction schema's `$defs/volatile`: a `path` under `/data/`,
 * optionally with a `tolerance` or as a `generated` value with its `basis`, not both.
 */
export const VolatileSchema = define(
  document,
  'volatile',
  Closed(
    {
      collection: Type.Optional(Type.Enum(['entities', 'relationships'], {description: 'Defaults to `entities`.'})),
      kinds: Type.Optional(
        Type.Array(Text, {minItems: 1, uniqueItems: true, description: 'The kinds it applies to; absent for every kind.'}),
      ),
      path: annotated(Pointer, {
        description:
          'A JSON pointer under `/data/`, with RFC 6901 escapes; a `*` segment matches any object key or array index, so a key that is literally `*` cannot be addressed.',
      }),
      tolerance: Type.Optional(ToleranceSchema),
      generated: Type.Optional(
        Type.Literal(true, {
          description:
            'A generated value, such as a summary a language model wrote: judged by its `basis`, not its wording. Requires `basis`; has no `tolerance`.',
        }),
      ),
      basis: Type.Optional(
        annotated(Pointer, {
          description:
            "A pointer under `/data/` into the same item naming the generated value's basis: an object of 1 to 16 named parts (`input`, `prompt`, `model`, ...), each a nonempty string of at most 256 bytes. Equal bases make any rewording expected variation; a changed part makes a change. Its `*` segments take the keys the path's `*` segments matched, in order, and it can't be volatile itself.",
        }),
      ),
    },
    {
      description:
        "Values that may vary between runs at one revision. Without a tolerance any difference is expected variation; with one, only numbers within it are; a generated value is judged by its basis. A pair's declarations from both sides combine, the tighter winning.",
      dependentRequired: {generated: ['basis'], basis: ['generated']},
      if: {required: ['generated']},
      then: {not: {required: ['tolerance']}},
    },
  ),
)

/**
 * The JSON Schema of an `Extraction`, the root of the published `extraction/v0.json`: at most 10,000 entities, 50,000
 * relationships and 256 `volatile` declarations. Structure only; the engine also checks the domain schema's and
 * vocabularies' rules, endpoints and identity.
 */
export const ExtractionSchema = define(
  document,
  undefined,
  Closed(
    {
      protocolVersion: Type.Literal(0),
      schema: DomainSchemaName,
      vocabularies: Type.Optional(
        Type.Array(VocabularyName, {
          description:
            'Vocabularies the extraction follows: typed conventions over its schema, such as `dependency-injection/v0` over `architecture/v0`. The engine checks their rules too.',
          uniqueItems: true,
        }),
      ),
      entities: Type.Array(EntitySchema, {maxItems: 10_000}),
      relationships: Type.Array(RelationshipSchema, {maxItems: 50_000}),
      volatile: Type.Optional(
        Type.Array(VolatileSchema, {
          maxItems: 256,
          description:
            'Data that may vary between runs at the same revision, such as durations or measurements, and how much. Part of the digest.',
        }),
      ),
      missingInputs: Type.Optional(
        Type.Array(NonBlank({maxLength: 1024}), {
          maxItems: 256,
          uniqueItems: true,
          description:
            "Declared inputs (repository-relative files, folders or globs) that don't exist at the examined revision. The extraction describes the revision without them, so a comparison shows their contents as added or removed, with a notice. Part of the digest.",
        }),
      ),
      metadata: Type.Optional(Data),
    },
    {description: 'One aspect of the code at one revision, as produced by an extractor on stdout.'},
  ),
)
