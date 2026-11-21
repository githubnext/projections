// The schema of .github/ci-rules.json, the rules that decide what CI runs for a change (CONTRIBUTING.md#what-ci-runs).
// The planner (ci-plan.ts) reads the file without this module, so CI's `changes` job needs no install; the tools
// package's tests validate the file against it, and .github/ci-rules.schema.json is generated from it for editors.
import Type, {type Static} from 'typebox'

const Description = Type.String({
  minLength: 1,
  description: 'What the rule does and why. The run summary prints it as the reason a job runs.',
})
const Globs = Type.Array(Type.String({minLength: 1}), {
  description: 'Repository paths: `*` within a path segment, `**` across segments.',
})
const Name = Type.String({pattern: '^[a-z][a-z0-9-]*$'})
const Facts = {
  mutants: 'The files .cargo/mutants.toml examines (examine_globs, without exclude_globs)',
  coverage: 'The crates `npm run test:rust:coverage` measures',
  harnessRenderers: 'The renderers the renderer harness tests: packages/renderers/<name> with a scenarios.json',
}

/** A set of workspaces and crates, by directory. */
const Selector = Type.Union(
  [
    Type.String({minLength: 1, description: 'A glob of workspace and crate directories, or `@name`: another group'}),
    Type.Object({kind: Type.Union([Type.Literal('crate'), Type.Literal('npm')])}, {additionalProperties: false}),
    Type.Object({facts: Type.Union([Type.Literal('coverage'), Type.Literal('harnessRenderers')])}, {additionalProperties: false}),
  ],
  {description: `A glob, \`@group\`, {"kind": "crate" | "npm"}, or {"facts": …}: ${Facts.coverage}; ${Facts.harnessRenderers}`},
)

const Strict = {additionalProperties: false}

/** When a job, matrix value, browser suite or condition applies. */
export const When = Type.Cyclic(
  {
    When: Type.Union([
      Type.Literal('full', {description: 'The run is a full one: an event, a label or a file rule asked for everything'}),
      Type.Literal('docsOnly', {description: 'Every changed file is documentation, and no generator reads or writes one'}),
      Type.Literal('reachesSuite', {
        description: 'Browser suites only: the change reaches the suite, or a workspace its test:browser script builds',
      }),
      Type.Object({if: Name}, {...Strict, description: 'A named condition holds'}),
      Type.Object(
        {changes: Type.Union([Globs, Type.Object({facts: Type.Literal('mutants')}, Strict)])},
        {...Strict, description: `A changed file matches; {"facts": "mutants"}: ${Facts.mutants}`},
      ),
      Type.Object({tag: Name}, {...Strict, description: 'A changed file has the tag'}),
      Type.Object(
        {generator: Type.String({minLength: 1})},
        {...Strict, description: 'A changed file is an input or output of the generator'},
      ),
      Type.Object(
        {changed: Name},
        {...Strict, description: 'A workspace or crate in the group contains, builds in or reads a changed file (its tests included)'},
      ),
      Type.Object(
        {reaches: Name, from: Type.Optional(Name)},
        {
          ...Strict,
          description:
            "A workspace or crate in the group contains or builds in a changed file, or depends on one that does (tests that read a file don't count); with `from`, counting only changes to that group",
        },
      ),
      Type.Object({any: Type.Array(Type.Ref('When'), {minItems: 1})}, {...Strict, description: 'Any of these holds'}),
      Type.Object({all: Type.Array(Type.Ref('When'), {minItems: 1})}, {...Strict, description: 'All of these hold'}),
      Type.Object({not: Type.Ref('When')}, {...Strict, description: 'This does not hold'}),
    ]),
  },
  'When',
)

const FileRule = Type.Object(
  {
    description: Description,
    paths: Type.Optional(Globs),
    except: Type.Optional(Globs),
    owned: Type.Optional(Type.Boolean({description: 'Whether the file is (true) or isn’t (false) inside a workspace or crate'})),
    read: Type.Optional(
      Type.Boolean({
        description: 'Whether a crate reads the file by path or a generator reads or writes it (true), or nothing does (false)',
      }),
    ),
    effect: Type.Union([Type.Literal('full'), Type.Literal('docs'), Type.Literal('owner'), Type.Literal('readers')], {
      description:
        'full: run everything. docs: documentation only. owner: a change to the workspace or crate containing the file. readers: a change only to what reads it (the crates and generators found for every file); with none, the Linux checks still run',
    }),
  },
  Strict,
)

const Shards = Type.Union([Type.Integer({minimum: 1}), Type.Record(Type.String({minLength: 1}), Type.Integer({minimum: 1}))], {
  description: 'Jobs to shard the suite across: a number, or a number per Playwright project',
})

const Suite = Type.Object(
  {
    description: Description,
    when: Type.Optional(When),
    shards: Type.Optional(Shards),
    macos: Type.Optional(
      Type.Record(Type.String({minLength: 1}), Type.Integer({minimum: 1}), {description: 'Shards per project on macOS'}),
    ),
    narrow: Type.Optional(
      Type.Object(
        {description: Description, group: Name},
        {
          ...Strict,
          description: "When the suite runs only because of changes to some of the group's members (not all), leave the others' tests out",
        },
      ),
    ),
  },
  Strict,
)

const Job = Type.Union([
  Type.Object({description: Description, when: When}, Strict),
  Type.Object(
    {
      description: Description,
      matrix: Type.Array(Type.Object({value: Type.String({minLength: 1}), description: Description, when: When}, Strict), {
        minItems: 1,
      }),
    },
    {...Strict, description: 'A matrix job: the values whose `when` holds, as a JSON array'},
  ),
])

export const CiRules = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    description: Description,
    full: Type.Object(
      {
        description: Description,
        events: Type.Array(Type.String({minLength: 1}), {description: 'GitHub Actions events that run everything'}),
        labels: Type.Array(Type.String({minLength: 1}), {description: 'Pull request labels that run everything'}),
      },
      Strict,
    ),
    files: Type.Array(FileRule, {minItems: 1, description: 'How each changed file counts: the first rule that matches it decides'}),
    tags: Type.Record(Name, Type.Object({description: Description, paths: Globs}, Strict), {
      description: 'Tags every changed file matching the paths gets, whichever file rule decided it',
    }),
    groups: Type.Record(
      Name,
      Type.Object(
        {description: Description, include: Type.Array(Selector, {minItems: 1}), exclude: Type.Optional(Type.Array(Selector))},
        Strict,
      ),
      {description: 'Named sets of workspaces and crates'},
    ),
    conditions: Type.Record(Name, Type.Object({description: Description, when: When}, Strict), {
      description: 'Named conditions, which `{"if": name}` refers to; the `changes` job also outputs each',
    }),
    jobs: Type.Record(Name, Job, {description: 'The jobs of .github/workflows/ci.yml the plan gates, by job ID'}),
    browser: Type.Object(
      {
        description: Description,
        default: Type.Object({description: Description, when: When}, {...Strict, description: 'When a suite without its own `when` runs'}),
        suites: Type.Record(Type.String({minLength: 1}), Suite, {
          description: 'Browser suites by workspace directory; those without `shards` run together in `browser (rest)`',
        }),
      },
      Strict,
    ),
  },
  Strict,
)

export type CiRules = Static<typeof CiRules>
export type When = Static<typeof When>
