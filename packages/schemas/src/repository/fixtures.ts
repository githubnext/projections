// Schemas for test data formats that are this repository's own: what its tests and stories read. Each is internal
// and unversioned.
import Type from 'typebox'
import {schemaUrl} from '../constants.js'
import {Closed, Dictionary} from '../typebox/support.js'

const Text = Type.String({minLength: 1, pattern: '\\S'})
const published = (name: string, pointer = '') => Type.Unsafe({$ref: `${schemaUrl(name)}${pointer}`})

/** `packages/host/vscode-ui/fixtures/themes/*.json`: a VS Code theme's webview variables, captured for the stories. */
export const VscodeThemeSchema = Closed({
  id: Type.String({pattern: '^[a-z0-9][a-z0-9-]*$'}),
  name: Text,
  setting: Text,
  kind: Type.Enum(['light', 'dark', 'hc-light', 'hc-dark']),
  source: Text,
  bodyClasses: Type.Array(Type.String({pattern: '^vscode-[a-z-]+$'}), {minItems: 1}),
  themeKind: Type.String({pattern: '^vscode-[a-z-]+$'}),
  variables: Dictionary(Type.String(), {propertyNames: {pattern: '^--vscode-'}, minProperties: 1}),
})

/** `examples/extractors/*\/test/cases.json`: each fixture a sample extractor runs on, with the definition inputs. */
export const ExampleCasesSchema = Type.Array(
  Closed({name: Type.String({pattern: '^[a-z0-9][a-z0-9-]*$'}), inputs: published('definition', '#/properties/inputs')}),
  {minItems: 1},
)

const Digest = Type.String({pattern: '^sha256:[0-9a-f]{64}$'})

/**
 * `packages/comparators/rules/tests/golden/*.json`: an original comparator's verdict on every case, which the rules
 * port must reproduce (packages/comparators/rules/tests/common/mod.rs): its comparison, its error code, or `sameAs`
 * an earlier case; `"baseline": "rules"` marks the rules' own comparison where no original recorded one.
 */
export const ComparatorGoldenSchema = Closed({
  comparator: Type.String({pattern: '^[a-z0-9][a-z0-9-]*$'}),
  original: Text,
  cases: Type.Array(
    Type.Union([
      Closed({case: Text, input: Digest, baseline: Type.Optional(Type.Literal('rules')), comparison: published('comparison')}),
      Closed({case: Text, input: Digest, baseline: Type.Optional(Type.Literal('rules')), error: Type.String({pattern: '^[a-z][a-z-]*$'})}),
      Closed({case: Text, input: Digest, sameAs: Text}),
    ]),
  ),
})

const Id = Type.String({pattern: '^[a-z0-9][a-z0-9-]*$'})
const ErrorCode = Type.String({pattern: '^[a-z][a-z-]*$', description: 'The diagnostic code the engine must fail with.'})

/**
 * `packages/schemas/fixtures/conformance.json`: the corpus the native and Wasm engines must agree on. Its inputs are
 * deliberately loose, since many are invalid on purpose.
 */
export const ConformanceSchema = Closed({
  version: Type.Literal(0),
  cases: Type.Array(
    Closed({
      id: Id,
      request: Type.Object(
        {
          version: Type.Literal(0),
          operation: Type.Enum(['decode', 'normalize', 'canonicalize', 'pair', 'vary', 'review', 'validate-comparison']),
        },
        {description: "An engine request; the other fields are the operation's."},
      ),
      expectError: Type.Optional(ErrorCode),
      expectedErrorPath: Type.Optional(Type.String()),
      expectedCanonical: Type.Optional(Type.String()),
      expectedResult: Type.Optional(Type.Unknown()),
    }),
  ),
  comparisons: Type.Array(
    Closed({
      id: Id,
      before: Type.Object({}),
      after: Type.Object({}),
      expectError: Type.Optional(ErrorCode),
      expected: Type.Optional(published('comparison')),
    }),
  ),
})
