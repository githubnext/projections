// The schema of tools/cli/test/ci-plan.cases.json: the table of changes and the CI plan each must produce, which the
// tools package's tests run against .github/ci-rules.json. tools/cli/test/ci-plan.cases.schema.json is generated from it.
import Type, {type Static} from 'typebox'

const Strict = {additionalProperties: false}
const Paths = Type.Array(Type.String({minLength: 1}))

export const CiPlanCase = Type.Object(
  {
    name: Type.String({minLength: 1, description: 'What the case shows: the test name'}),
    files: Type.Array(Type.String({minLength: 1}), {description: 'The changed files'}),
    each: Type.Optional(Type.Boolean({description: 'Plan each file as a change of its own, rather than all as one change'})),
    labels: Type.Optional(Type.Array(Type.String({minLength: 1}), {description: "The pull request's labels"})),
    events: Type.Optional(
      Type.Array(Type.String({minLength: 1}), {description: 'Plan for each of these GitHub Actions events (default pull_request)'}),
    ),
    expect: Type.Object(
      {
        full: Type.Optional(Type.Boolean({description: 'Whether everything runs'})),
        docsOnly: Type.Optional(Type.Boolean()),
        jobs: Type.Optional(
          Type.Record(Type.String({minLength: 1}), Type.Union([Type.Boolean(), Paths]), {
            description: "Jobs by ID: whether each runs, or a matrix job's entry names",
          }),
        ),
        productIncludes: Type.Optional(Type.Array(Type.String({minLength: 1}), {description: "public-product's entries include these"})),
        renderers: Type.Optional(Type.Array(Type.String({minLength: 1}), {description: 'The renderers the harness narrows to'})),
        browser: Type.Optional(Type.Array(Type.String({minLength: 1}), {description: 'The Linux browser jobs, exactly, by name'})),
        macos: Type.Optional(Type.Array(Type.String({minLength: 1}), {description: 'The macOS browser jobs, exactly, by name'})),
        allBrowserJobs: Type.Optional(Type.Boolean({description: 'Every browser job runs, as in a full run'})),
        harnessJobs: Type.Optional(Type.Integer({minimum: 0, description: 'How many Linux renderer harness jobs run'})),
        suitesInclude: Type.Optional(Paths),
        suitesExclude: Type.Optional(Paths),
        changedInclude: Type.Optional(Paths),
        dependantsInclude: Type.Optional(Paths),
        dependantsExclude: Type.Optional(Paths),
      },
      Strict,
    ),
  },
  Strict,
)

export const CiPlanCases = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    cases: Type.Array(CiPlanCase, {minItems: 1}),
  },
  Strict,
)

export type CiPlanCase = Static<typeof CiPlanCase>
export type CiPlanCases = Static<typeof CiPlanCases>
