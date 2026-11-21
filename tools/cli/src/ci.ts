// `ci`: what CI runs for a change and why (CONTRIBUTING.md#what-ci-runs), from the same plan CI's `changes` job makes.
import {Cli, z} from 'incur'
import {ciExplainReport} from './commands/work/ci.ts'
import {guard, next} from './outcome.ts'

const trace = z.array(z.string()).describe('The rules that ran or skipped it: ✓ held, ✗ did not, indented by nesting')

export function ciCommands(root: string) {
  const ci = Cli.create('ci', {description: 'What CI runs for a change, and why: the plan of .github/ci-rules.json'})
  ci.command('explain', {
    description:
      "Every CI job and browser suite, run or skipped, for a change: each file's class and rule, how each workspace and crate is reached, each `when` traced, and the checks (with suites, shards and filters)",
    args: z.object({files: z.array(z.string()).default([]).describe('Changed files; without them, the change since the merge base')}),
    options: z.object({
      base: z.string().default('origin/main').describe('Compare with the merge base with this ref'),
      event: z.string().default('pull_request').describe('The GitHub Actions event: push, schedule and workflow_dispatch run everything'),
      labels: z.string().default('').describe('Pull request labels, comma-separated: ci:full runs everything'),
    }),
    examples: [
      {description: 'The current branch, as a pull request'},
      {args: {files: ['packages/renderers/database/src/styles.css']}, description: 'One file'},
    ],
    output: z.object({
      base: z.string(),
      full: z.array(z.string()),
      files: z.array(z.object({path: z.string(), class: z.string(), rule: z.string()})),
      touched: z.array(z.string()),
      reached: z.array(z.object({unit: z.string(), through: z.array(z.string())})),
      jobs: z.array(z.object({check: z.string(), runs: z.boolean(), why: trace})),
      suites: z.array(z.object({suite: z.string(), runs: z.boolean(), why: trace})),
      checks: z.array(
        z.object({
          check: z.string(),
          job: z.string(),
          with: z.record(z.string(), z.string()).optional(),
          suites: z.array(z.string()).optional(),
          project: z.string().optional(),
          shard: z.string().optional(),
          grepInvert: z.string().optional(),
        }),
      ),
      next,
    }),
    run: c =>
      guard(() =>
        ciExplainReport(root, {
          files: c.args.files,
          base: c.options.base,
          event: c.options.event,
          labels: c.options.labels.split(',').filter(Boolean),
        }),
      ),
  })
  return ci
}
