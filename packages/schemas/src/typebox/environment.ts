import Type from 'typebox'
import {Closed, define} from './support.js'

const document = 'environment'

const RelativePath = Type.String({
  minLength: 1,
  maxLength: 1024,
  pattern: '^(?!/)(?!.*(^|/)\\.\\.(/|$))[^\\\\\\u0000]+$',
  description: 'A repository-relative path, `/`-separated, without `..` segments.',
})

const Argv = Type.Array(Type.String({pattern: '^[^\\u0000]*$'}), {
  minItems: 1,
  maxItems: 100,
  description: 'A program and its arguments, run directly, never through a shell.',
})

/**
 * The JSON Schema of one of an environment file's `prepare` steps, the environment schema's `$defs/step`: an `id`, the
 * argv it `run`s, and the `key` globs whose content decides when it reruns.
 */
export const PrepareStepSchema = define(
  document,
  'step',
  Closed(
    {
      id: Type.String({
        pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$',
        description: 'Names the step in logs, records and failures.',
      }),
      run: Argv,
      key: Type.Array(Type.String({minLength: 1, pattern: '^(?!/)(?!.*(^|/)\\.\\.(/|$))[^\\\\\\u0000]+$'}), {
        minItems: 1,
        maxItems: 50,
        description:
          'Globs (`*` within a path segment, `**` across them) of the files whose content decides whether the step must run again, typically lockfiles and manifests. The step reruns only when their paths or contents change.',
      }),
      directory: Type.Optional({...RelativePath, description: 'The working directory, relative to the checkout. Default `.`.'}),
      environment: Type.Optional(
        Type.Array(Type.String({pattern: '^[A-Za-z_][A-Za-z0-9_]*$'}), {
          uniqueItems: true,
          description:
            'Variables passed through from the invoking environment, besides the home, cache, temporary-directory and proxy variables every step receives. Steps may use the network.',
        }),
      ),
      timeoutMs: Type.Optional(
        Type.Integer({minimum: 1, maximum: 3_600_000, description: 'How long the step may run. Default ten minutes, at most an hour.'}),
      ),
    },
    {description: 'One command that makes a checkout usable, such as installing its dependencies.'},
  ),
)

/**
 * The JSON Schema of a repository's environment file (`format: "projections.environment"`), the root of the published
 * `environment/v0.json`: up to 20 prepare steps, up to 10 toolchain commands, a workspace strategy and a devcontainer.
 */
export const EnvironmentSchema = define(
  document,
  undefined,
  Closed(
    {
      $schema: Type.Optional(Type.String()),
      format: Type.Literal('projections.environment'),
      version: Type.Literal(0),
      prepare: Type.Optional(
        Type.Array(PrepareStepSchema, {
          maxItems: 20,
          description:
            'Run in order in a workspace before a toolchain extractor runs there, and in the working tree only on demand (`projections prepare`). They are repository code, so they need `--trust`.',
        }),
      ),
      toolchain: Type.Optional(
        Type.Array(Argv, {
          maxItems: 10,
          description:
            'Commands whose output identifies the toolchain, such as `node --version`; part of the environment fingerprint that keys cached environmental extractions.',
        }),
      ),
      workspace: Type.Optional(
        Closed({
          strategy: Type.Enum(['fresh', 'worktree', 'clone', 'sparse', 'none'], {
            description:
              "The team's workspace strategy for this repository; a developer's `--workspace` or user configuration overrides it.",
          }),
        }),
      ),
      devcontainer: Type.Optional({
        ...RelativePath,
        description: 'A devcontainer configuration describing the same environment. Reported by `projections doctor`; not run.',
      }),
    },
    {
      description:
        "How to make a checkout usable for the repository's toolchain extractors, as its CI does: `.github/projections/environment.json` or `.projections/environment.json`.",
    },
  ),
)
