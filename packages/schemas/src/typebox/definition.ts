import Type from 'typebox'
import {kindColors} from '../constants.js'
import {Data} from './extraction.js'
import {Closed, define, Dictionary} from './support.js'

const document = 'definition'

/**
 * A projection, extractor or renderer ID: 1 to 100 ASCII letters, digits, `.`, `_` and `-`, starting with a letter or
 * digit, so it is safe as a file name; the definition schema's `$defs/identifier`.
 */
export const Identifier = define(document, 'identifier', Type.String({pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$'}))
/**
 * A path relative to the definition's project, of 1 to 1024 characters, `/`-separated: no leading, trailing or doubled
 * `/`, no backslash, control character, `?`, `#` or `:`, and no `.` or `..` segment except leading `..` segments, which
 * name something outside a nested project (never outside the repository). The definition schema's `$defs/path`.
 */
export const RepositoryPath = define(
  document,
  'path',
  Type.String({
    minLength: 1,
    maxLength: 1024,
    description:
      "Relative to the definition's project (the directory holding its `.github/projections` or `.projections`); leading `../` segments leave a nested project.",
    pattern:
      '^(?:\\.\\.(?:/\\.\\.)*|(?:\\.\\./)*(?!\\.{1,2}(?:/|$))(?!.*/\\.{1,2}(?:/|$))(?!.*//)(?!.*/$)(?!.*[\\\\\\u0000-\\u001f\\u007f])[^/?#:][^?#:]*)$',
  }),
)
const Sources = define(document, 'sources', Type.Array(RepositoryPath, {maxItems: 256, uniqueItems: true}))
const NonEmpty = Type.String({minLength: 1})

/** The JSON Schema of `DefaultComparatorOptions`, the definition schema's `$defs/defaultComparatorOptions`. */
export const DefaultComparatorOptionsSchema = define(
  document,
  'defaultComparatorOptions',
  Closed({
    order: Type.Optional(
      Closed({
        by: Type.Unsafe<'dependents' | `data.${string}`>(Type.String({pattern: '^(?:dependents|data\\..+)$'})),
        direction: Type.Optional(Type.Enum(['ascending', 'descending'])),
      }),
    ),
  }),
)

/**
 * The JSON Schema of one of a command extractor's `upstream` entries, the definition schema's `$defs/upstream`: a
 * built-in extractor ID and its `inputs`.
 */
export const UpstreamExtractorSchema = define(
  document,
  'upstream',
  Closed(
    {
      extractor: Identifier,
      inputs: Type.Optional(Data),
    },
    {description: 'A built-in extractor, with its inputs, whose extraction of the same revision the command receives.'},
  ),
)

/**
 * The JSON Schema of a `CommandExtractor`: a `command` of 1 to 256 arguments without NUL, the first nonempty; up to 256
 * `sources`; and 1 to 8 `upstream` extractions.
 */
export const CommandExtractorSchema = Closed({
  command: Type.Array(Type.String({pattern: '^[^\\u0000]*$'}), {
    minItems: 1,
    maxItems: 256,
    prefixItems: [{type: 'string', minLength: 1, pattern: '^[^\\u0000]+$'}],
  }),
  sources: Type.Optional(Sources),
  upstream: Type.Optional(
    Dictionary(UpstreamExtractorSchema, {
      description:
        "Built-in extractions the command builds on, by name. The runner extracts each from the examined revision first, with the definition's scope and timeout, and passes them in the request's `upstream`, keyed by the same names.",
      minProperties: 1,
      maxProperties: 8,
      propertyNames: {pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$'},
    }),
  ),
})
/** The JSON Schema of a `DefaultComparator`, `{options?}`. */
export const DefaultComparatorSchema = Closed(
  {options: Type.Optional(DefaultComparatorOptionsSchema)},
  {description: 'The default comparator, with its options. An object without `file` is always the default comparator.'},
)
/**
 * A comparator file's path, a `RepositoryPath` (relative to the project) ending in `.comparator.yaml` or `.comparator.yml`; the
 * definition schema's `$defs/comparatorFile`.
 */
export const ComparatorFilePath = define(
  document,
  'comparatorFile',
  Type.Unsafe<string>({
    description:
      "A comparator file (`<name>.comparator.yaml` or `.comparator.yml`), relative to the definition's project: the custom comparator, run sandboxed over the default comparator.",
    allOf: [RepositoryPath, {type: 'string', pattern: '\\.comparator\\.ya?ml$'}],
  }),
)
/** The JSON Schema of a `CustomComparator`, `{file, sources?, options?}`. */
export const CustomComparatorSchema = Closed(
  {
    file: ComparatorFilePath,
    sources: Type.Optional(Sources),
    options: Type.Optional(Data),
  },
  {description: 'A custom comparator: its comparator file, with options it reads as `options` and any other files it depends on.'},
)
/** The JSON Schema of a `RendererBundle`, `{bundle, sources?}`. */
export const RendererBundleSchema = Closed({bundle: RepositoryPath, sources: Type.Optional(Sources)})
/** A definition's `renderer`, a built-in renderer ID or `RendererBundle`; the definition schema's `$defs/renderer`. */
export const RendererReference = define(document, 'renderer', Type.Union([Identifier, RendererBundleSchema]))
/** A definition's `execution.reproducibility`, a `Reproducibility`; the definition schema's `$defs/reproducibility`. */
export const ReproducibilityLevel = define(
  document,
  'reproducibility',
  Type.Enum(['hermetic', 'pinned-toolchain', 'local', 'unknown', 'external']),
)

/**
 * A definition's `execution.determinism`, `pure`, `environmental` or `observed`, which decides how its extractions are
 * cached and reused; the definition schema's `$defs/determinism`.
 */
export const DeterminismClass = define(
  document,
  'determinism',
  Type.Enum(['pure', 'environmental', 'observed'], {
    description:
      "How reproducible the extraction is, like a test's, declared and never enforced: `pure`, a function of the revision's files (cached by tree, and a rerun must match); `environmental`, the files plus the toolchain and dependencies (cached only within one environment; the default for custom extractors); `observed`, live or varying data such as timings or coverage (never reused silently).",
  }),
)

const KindNounText = Type.String({minLength: 1, maxLength: 64, pattern: '\\S'})

/** The JSON Schema of a `KindPresentation`, the definition schema's `$defs/kindPresentation`. */
export const KindPresentationSchema = define(
  document,
  'kindPresentation',
  Closed(
    {
      color: Type.Optional(
        Type.Enum([...kindColors], {
          description:
            'The color its items take where a renderer colors by kind: a meaning (`danger`, `warning`, `success`, `info`, `neutral`) or a categorical hue. Renderers paint it with theme tokens.',
        }),
      ),
      noun: Type.Optional(
        Closed(
          {singular: KindNounText, plural: KindNounText},
          {description: 'The words for one item and for any other count, such as `{"singular": "hidden key", "plural": "hidden keys"}`.'},
        ),
      ),
    },
    {description: 'How viewers present one extraction kind.'},
  ),
)

/**
 * The JSON Schema of `presentation.kinds`, the definition schema's `$defs/kinds`: up to 64 `KindPresentation`s keyed
 * by kind.
 */
export const KindsSchema = define(
  document,
  'kinds',
  Dictionary(KindPresentationSchema, {
    description:
      "How viewers present extraction kinds, keyed by kind: a color for renderers that color items by kind, and the summary bar's noun. A kind's key also names the flag of that name (`data.flags`) where a renderer draws flags.",
    maxProperties: 64,
    propertyNames: {minLength: 1, maxLength: 256},
  }),
)

/** The JSON Schema of `PresentationSettings`, the definition schema's `$defs/presentation`. */
export const PresentationSettingsSchema = define(
  document,
  'presentation',
  Closed(
    {
      highlighting: Type.Optional(
        Type.Enum(['animated', 'on', 'off'], {description: 'Change highlighting: fading with the transition, always, or off.'}),
      ),
      changesOnly: Type.Optional(Type.Boolean({description: 'Show only changed items.'})),
      mode: Type.Optional(
        Type.Enum(['animated', 'side-by-side', 'swipe', 'diff'], {
          description: 'Initial comparison mode; hosts use it only when the renderer supports it.',
        }),
      ),
      durationMs: Type.Optional(
        Type.Integer({
          description: 'Playback duration from before to after at 1× speed, in milliseconds. Omitted, it scales with the number of steps.',
          minimum: 500,
          maximum: 120_000,
        }),
      ),
      rendererOptions: Type.Optional(
        Dictionary(Type.Union([Type.String(), Type.Number(), Type.Boolean()]), {
          description:
            "Initial values of the renderer's declared controls, keyed by control ID. Hosts ignore unknown IDs and invalid values, with a notice.",
          maxProperties: 32,
          propertyNames: {pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'},
        }),
      ),
      kinds: Type.Optional(KindsSchema),
    },
    {description: 'Initial host and renderer settings for viewers. Viewers can still change them.'},
  ),
)

/**
 * The JSON Schema of a `Definition`, the root of the published `definition/v0.json`: `id`, `extractor` and `renderer`
 * required, the rest optional, unknown fields rejected.
 */
export const DefinitionSchema = define(
  document,
  undefined,
  Closed(
    {
      id: Identifier,
      title: Type.Optional(NonEmpty),
      description: Type.Optional(NonEmpty),
      extractor: Type.Union([NonEmpty, CommandExtractorSchema]),
      comparator: Type.Optional(
        Type.Union([ComparatorFilePath, CustomComparatorSchema, DefaultComparatorSchema], {
          description:
            'How changes are matched, explained and ordered. A string or an object with `file` names a custom comparator file (`<name>.comparator.yaml`); an object without `file` is the default comparator, with its options. Omitted, the default comparator with no options.',
        }),
      ),
      renderer: RendererReference,
      inputs: Type.Optional(Data),
      correspondence: Type.Optional(Dictionary(Type.Array(NonEmpty, {minItems: 1, uniqueItems: true}), {propertyNames: {minLength: 1}})),
      execution: Type.Optional(
        Closed({
          timeoutMs: Type.Optional(Type.Integer({minimum: 1, maximum: 300_000})),
          environment: Type.Optional(Type.Array(Type.String({pattern: '^[A-Za-z_][A-Za-z0-9_]*$'}), {uniqueItems: true})),
          network: Type.Optional(Type.Boolean()),
          reproducibility: Type.Optional(ReproducibilityLevel),
          determinism: Type.Optional(DeterminismClass),
          scope: Type.Optional(
            Type.Array(Type.String({minLength: 1, maxLength: 1024, pattern: '^[^/*?\\[\\\\]([^*?\\[\\\\]*[^/*?\\[\\\\])?/?$'}), {
              minItems: 1,
              maxItems: 100,
              description:
                "Files and directories the extractor reads, not globs, relative to the definition's project: `.` is the project itself, and leading `../` segments widen a nested project's scope beyond it. Optional and enforced where reads are mediated; the default is the whole repository, or a nested project's own directory.",
            }),
          ),
        }),
      ),
      presentation: Type.Optional(PresentationSettingsSchema),
    },
    {description: 'A projection: an extractor, an optional comparator and a renderer, with their configuration.'},
  ),
)
