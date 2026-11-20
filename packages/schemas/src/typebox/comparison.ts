import Type from 'typebox'
import {Data} from './extraction.js'
import {annotated, Closed, define} from './support.js'

const document = 'comparison'

const Text = define(document, 'text', Type.String({minLength: 1}))
const Ids = define(document, 'ids', Type.Array(Text, {maxItems: 60_000, uniqueItems: true}))

/** A change's `status`, the `ChangeStatus` type. */
export const ChangeStatusName = Type.Enum(['added', 'removed', 'modified', 'unchanged'])
/** A change's `correspondence`, the `Correspondence` type. */
export const CorrespondenceName = Type.Enum(['exact', 'declared', 'split', 'merge', 'none'])
/** A change's `collection`, the `Collection` type. */
export const CollectionName = Type.Enum(['entities', 'relationships'])

const one = {minItems: 1, maxItems: 1}
const when = (condition: object, then: object) => ({if: {properties: condition}, then: {properties: then}})

/** The JSON Schema of `Varied`, the comparison schema's `$defs/varied`. */
export const VariedSchema = define(
  document,
  'varied',
  Closed(
    {
      path: annotated(Text, {description: 'The concrete pointer into the item, under `/data/`.'}),
      within: Type.Boolean({description: 'Whether the difference is within the declared tolerance.'}),
      reason: Type.Optional(
        annotated(Text, {
          description:
            "Why a tolerance couldn't be applied: only when a spread was unavailable and no other bound held, or a generated value is on one side only.",
        }),
      ),
      generated: Type.Optional(
        Type.Literal(true, {description: 'A generated value, judged by its basis: within exactly when the bases are equal.'}),
      ),
      because: Type.Optional(
        Type.Array(Text, {
          minItems: 1,
          uniqueItems: true,
          description: "A generated value's basis parts that differ, in UTF-16 order; absent when the bases are equal.",
        }),
      ),
    },
    {description: 'One volatile value that differs between a matched pair.'},
  ),
)

const ContextIds = define(
  document,
  'contextIds',
  Type.Array(Text, {
    maxItems: 1_000,
    uniqueItems: true,
    description: "Item IDs of one revision, entities or relationships, in UTF-16 order; never the change's own.",
  }),
)

/** The JSON Schema of a change's `context`, the comparison schema's `$defs/context`. */
export const ContextSchema = define(
  document,
  'context',
  Closed(
    {
      before: ContextIds,
      after: ContextIds,
      rules: Type.Optional(
        Type.Array(Text, {
          minItems: 1,
          uniqueItems: true,
          description: "The comparator's `context` rules that added IDs, in its file's order; absent when the core's context is all of it.",
        }),
      ),
    },
    {
      description:
        "The other items a person needs to read the change, in each revision (a removal's in `before`): the core's context, a changed relationship's endpoints and the items containing what changed, and what comparator rules add. Present only on a change whose status or identity changed, and only when it names an item. Renderers receive it only when they declare the `context` capability.",
    },
  ),
)

/**
 * The JSON Schema of a `Change`, the comparison schema's `$defs/change`, with the ID counts and statuses each
 * correspondence allows; `validate-comparison` checks the IDs against the extractions.
 */
export const ChangeSchema = define(
  document,
  'change',
  Closed(
    {
      id: annotated(Text, {
        description: 'Unique within the comparison: by convention the first after ID, or the before ID for removals.',
      }),
      collection: CollectionName,
      before: Ids,
      after: Ids,
      status: ChangeStatusName,
      correspondence: CorrespondenceName,
      varied: Type.Optional(
        Type.Array(VariedSchema, {
          minItems: 1,
          maxItems: 60_000,
          description:
            'The volatile values that differ, sorted by path; present exactly when one does. Only on `exact` and `declared` changes. An `exact` change whose every difference is within is `unchanged` and belongs to no step.',
        }),
      ),
      summary: Type.Optional(Text),
      context: Type.Optional(ContextSchema),
    },
    {
      allOf: [
        when({status: {const: 'added'}}, {before: {maxItems: 0}, after: one, correspondence: {const: 'none'}}),
        when({status: {const: 'removed'}}, {before: one, after: {maxItems: 0}, correspondence: {const: 'none'}}),
        when({correspondence: {enum: ['exact', 'declared']}}, {before: one, after: one, status: {enum: ['modified', 'unchanged']}}),
        when(
          {correspondence: {const: 'split'}},
          {before: one, after: {minItems: 2}, status: {enum: ['modified', 'unchanged']}, varied: false},
        ),
        when(
          {correspondence: {const: 'merge'}},
          {before: {minItems: 2}, after: one, status: {enum: ['modified', 'unchanged']}, varied: false},
        ),
        when({correspondence: {const: 'none'}}, {status: {enum: ['added', 'removed']}, varied: false}),
      ],
    },
  ),
)

/** The JSON Schema of a `Step`, the comparison schema's `$defs/step`: one or more distinct change IDs. */
export const StepSchema = define(
  document,
  'step',
  Closed({
    changes: Type.Array(Text, {minItems: 1, maxItems: 120_000, uniqueItems: true}),
    kind: Type.Optional(Type.Enum(['remove', 'restructure', 'add'])),
    summary: Type.Optional(Text),
  }),
)
const Steps = define(document, 'steps', Type.Array(StepSchema, {maxItems: 120_000}))

/**
 * The JSON Schema of a `Comparison`, the root of the published `comparison/v0.json`: `reverseSteps` exactly when
 * `order.reverse` is `explicit`. Structure only; the engine's `validate-comparison` checks a comparison against both
 * extractions.
 */
export const ComparisonSchema = define(
  document,
  undefined,
  Closed(
    {
      protocolVersion: Type.Literal(0),
      changes: Type.Array(ChangeSchema, {maxItems: 120_000}),
      steps: Steps,
      order: Type.Optional(Closed({reverse: Type.Enum(['mirror', 'explicit'])})),
      reverseSteps: Type.Optional(Steps),
      variation: Type.Optional(
        Closed(
          {
            within: Type.Integer({minimum: 0, description: 'Unchanged changes with `varied`: variation within tolerance only.'}),
            beyond: Type.Integer({
              minimum: 0,
              description: 'Modified changes with at least one `varied` value beyond tolerance.',
            }),
          },
          {description: 'Present exactly when a change has `varied`.'},
        ),
      ),
      metadata: Type.Optional(Data),
    },
    {
      description:
        'How one extraction became another: correspondence, status, optional summaries and presentation order. Never positions, colors or timing.',
      if: {required: ['order'], properties: {order: {properties: {reverse: {const: 'explicit'}}}}},
      then: {required: ['reverseSteps']},
      else: {not: {required: ['reverseSteps']}},
    },
  ),
)
