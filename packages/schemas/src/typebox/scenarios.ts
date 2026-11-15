import Type from 'typebox'
import {DefaultComparatorOptionsSchema, Identifier, PresentationSettingsSchema} from './definition.js'
import {Data, ExtractionSchema} from './extraction.js'
import {annotated, Closed, define} from './support.js'

const document = 'scenarios'

const Title = define(document, 'title', Type.String({minLength: 1, maxLength: 1000}))
const ScenarioPath = define(
  document,
  'path',
  Type.String({
    description:
      'A path relative to the scenarios file. `..` segments are allowed; absolute paths, URLs, backslashes and control characters are not.',
    minLength: 1,
    maxLength: 1024,
    pattern: '^(?!/)(?!.*//)(?!.*\\/$)(?!.*[\\\\\\u0000-\\u001f\\u007f])[^?#:]+$',
  }),
)

/**
 * A scenario's renderer: a built-in renderer's `Identifier`, or `{bundle}`, a bundle directory relative to the
 * scenarios file; the scenarios schema's `$defs/renderer`.
 */
export const ScenarioRenderer = define(
  document,
  'renderer',
  Type.Union([Identifier, Closed({bundle: annotated(ScenarioPath, {description: 'A renderer bundle directory.'})})]),
)

/** The JSON Schema of a `ScenarioExtraction`, the scenarios schema's `$defs/extraction`. */
export const ScenarioExtractionSchema = define(
  document,
  'extraction',
  Type.Union([ScenarioPath, ExtractionSchema], {
    description:
      'An inline extraction, or the path (relative to the scenarios file) of a JSON file holding an extraction or a `projections.extraction` document, whose `extraction` is used.',
  }),
)

const ScenarioComparatorFile = Type.Unsafe<string>({allOf: [ScenarioPath, {type: 'string', pattern: '\\.comparator\\.ya?ml$'}]})

/** The JSON Schema of a `ScenarioComparator`, the scenarios schema's `$defs/comparator`. */
export const ScenarioComparatorSchema = define(
  document,
  'comparator',
  Type.Union(
    [
      Closed({options: Type.Optional(DefaultComparatorOptionsSchema)}),
      ScenarioComparatorFile,
      Closed({file: ScenarioComparatorFile, options: Type.Optional(Data)}),
    ],
    {
      description:
        'A comparator file (`<name>.comparator.yaml`) by path relative to the scenarios file, as a string or `{file, options}`; an object without `file` is the default comparator with options.',
    },
  ),
)

const Extraction = Type.Optional(ScenarioExtractionSchema)
// A scenario has either an extraction, or before and after extractions with an optional comparator. The JSON
// Schema says so with `oneOf`; the TypeScript type is the matching union.
const ScenarioBase = Closed(
  {
    id: Type.String({description: 'Unique within the file and safe as a file name.', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'}),
    title: Title,
    group: Type.Optional(annotated(Title, {description: 'Overrides the document title for grouping.'})),
    description: Type.Optional(Type.String({minLength: 1, maxLength: 4096})),
    renderer: Type.Optional(
      annotated(ScenarioRenderer, {
        description: "A renderer name, or a bundle directory relative to the scenarios file. Defaults to the document's.",
      }),
    ),
    before: Extraction,
    after: Extraction,
    extraction: Extraction,
    comparator: Type.Optional(annotated(ScenarioComparatorSchema, {description: 'Only with before and after.'})),
    presentation: Type.Optional(PresentationSettingsSchema),
  },
  {
    description: 'One authored renderer scenario: a single extraction, or before and after extractions.',
    oneOf: [
      {required: ['extraction'], not: {anyOf: [{required: ['before']}, {required: ['after']}, {required: ['comparator']}]}},
      {required: ['before', 'after'], not: {required: ['extraction']}},
    ],
  },
)

/**
 * The JSON Schema of a `Scenario`, the scenarios schema's `$defs/scenario`: exactly one of `extraction`, or `before`
 * and `after` with an optional `comparator`.
 */
export const ScenarioSchema = define(document, 'scenario', ScenarioBase)

/**
 * The JSON Schema of a `ScenariosDocument`, the root of the published `scenarios/v0.json`: up to 1000 scenarios, each
 * needing its own `renderer` when the file gives no default.
 */
export const ScenariosDocumentSchema = define(
  document,
  undefined,
  Closed(
    {
      format: Type.Literal('projections.scenarios'),
      version: Type.Literal(0),
      title: Type.Optional(annotated(Title, {description: "Default group for this file's scenarios."})),
      renderer: Type.Optional(annotated(ScenarioRenderer, {description: 'Default renderer for scenarios that omit one.'})),
      scenarios: Type.Array(ScenarioSchema, {maxItems: 1000}),
    },
    {
      description:
        'Authored renderer scenarios: extractions, or before and after extractions with an optional comparator, shown with a renderer. Paths are relative to this file. Scenario IDs are unique within the file.',
      if: {not: {required: ['renderer']}},
      then: {properties: {scenarios: {type: 'array', items: {type: 'object', required: ['renderer']}}}},
    },
  ),
)
