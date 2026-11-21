// The schema of .github/ci-rules.json, the rules that decide what CI runs for a change (CONTRIBUTING.md#what-ci-runs).
// The planner (ci-plan.ts) reads the file without this module, so CI's `changes` job needs no install; the tools
// package's tests validate the file against it, and tools/scripts/ci-schemas.mjs generates .github/ci-rules.schema.json
// from it for editors.
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

/**
 * When a job, matrix entry, browser suite or condition runs, for a pull request that follows its change. A full run
 * runs everything, whatever `when` says.
 */
export const When = Type.Cyclic(
  {
    When: Type.Union([
      Type.Literal('always', {description: 'Every pull request, whatever changed: for jobs that check the whole repository cheaply'}),
      Type.Literal('never', {description: 'Only in full runs'}),
      Type.Literal('docsOnly', {description: 'Every changed file is documentation'}),
      Type.Object({if: Name}, {...Strict, description: 'A named condition holds'}),
      Type.Object(
        {changes: Type.Union([Globs, Type.Object({facts: Type.Literal('mutants')}, Strict)])},
        {
          ...Strict,
          description: `A changed file's path matches, whatever its class; {"facts": "mutants"}: ${Facts.mutants}`,
        },
      ),
      Type.Object(
        {touches: Name},
        {
          ...Strict,
          description: 'A workspace or crate in the group is touched: it contains, builds in or reads (tests included) a changed file',
        },
      ),
      Type.Object(
        {reaches: Name},
        {
          ...Strict,
          description:
            'A workspace or crate in the group is reached: touched, or depending on one that contains or builds in a changed file (a crate whose tests alone read a file is touched, but its dependants are not reached through it)',
        },
      ),
      Type.Object({any: Type.Array(Type.Ref('When'), {minItems: 1})}, {...Strict, description: 'Any of these holds'}),
      Type.Object({not: Type.Ref('When')}, {...Strict, description: 'This does not hold'}),
    ]),
  },
  'When',
)

const FileRule = Type.Object(
  {
    description: Description,
    paths: Globs,
    except: Type.Optional(Globs),
    class: Type.Union(
      [Type.Literal('lockfile'), Type.Literal('full'), Type.Literal('docs'), Type.Literal('checks'), Type.Literal('code')],
      {
        description: [
          'lockfile (package-lock.json, Cargo.lock): code for the workspaces and crates whose resolved dependencies changed; full when the root package’s own dependencies changed, or there is no earlier version to compare.',
          'full: run everything.',
          'docs: documentation; checks instead when a crate or generator reads it.',
          "checks: the Linux checks alone, which run every crate's tests and generator's check.",
          'code: touches the workspace or crate containing the file and those reading it by path; with none, the Linux checks alone.',
        ].join(' '),
      },
    ),
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
  {
    ...Strict,
    description:
      'A browser suite runs when the change reaches it or a workspace its test:browser script builds, or when its own `when` holds',
  },
)

const Job = Type.Union([
  Type.Object(
    {
      description: Description,
      when: When,
      shards: Type.Optional(
        Type.Integer({
          minimum: 2,
          description:
            'The workflow runs the job as this many checks, `<job> (0)` to `<job> (N-1)`, its matrix `shard` (the planner lists each; a test keeps it the workflow’s)',
        }),
      ),
      events: Type.Optional(
        Type.Array(Type.String({minLength: 1}), {
          minItems: 1,
          description: 'The GitHub Actions events the job runs for, full runs included; without it, every event',
        }),
      ),
    },
    Strict,
  ),
  Type.Object(
    {
      description: Description,
      matrix: Type.Array(
        Type.Object(
          {
            name: Type.String({minLength: 1, description: "The entry's name: the check is `<job> (<name>)`"}),
            description: Description,
            when: When,
            with: Type.Record(Type.String({minLength: 1}), Type.String(), {description: 'The matrix values the job reads, such as `os`'}),
          },
          Strict,
        ),
        {minItems: 1},
      ),
    },
    {...Strict, description: 'A matrix job: the entries whose `when` holds, as `include` objects of `name` and `with`'},
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
    files: Type.Array(FileRule, {
      minItems: 1,
      description:
        'Each changed file’s class: the first rule whose paths match it, or, when none does, code if a workspace or crate contains it or anything reads it, and full otherwise',
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
      description: 'Named conditions, which `{"if": name}` refers to',
    }),
    jobs: Type.Record(Name, Job, {description: 'The jobs of .github/workflows/ci.yml the plan gates, by job ID'}),
    browser: Type.Object(
      {
        description: Description,
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
