// `tools`: this repository's command line for coding agents and people. Every command is defined here with typed
// arguments, options and output; incur turns the definitions into --help, --llms, --schema, skills and an MCP server.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {Cli, z} from 'incur'
import {docsRead, docsSearch} from './commands/docs.ts'
import {doctorReport} from './commands/doctor.ts'
import {feedbackReport} from './commands/feedback.ts'
import {contextReport, explainReport, mapReport} from './commands/info.ts'
import {modulesReport} from './commands/modules.ts'
import {shadcnReport} from './commands/update.ts'
import {affectedReport} from './commands/work/affected.ts'
import {buildReport} from './commands/work/build.ts'
import {checkReport} from './commands/work/check.ts'
import {fixReport} from './commands/work/fix.ts'
import {generatedCheck, generatedList} from './commands/work/generated.ts'
import {split} from './commands/work/change-set.ts'
import {testReport} from './commands/work/test.ts'
import {verifyReport} from './commands/verify.ts'
import {versionReport} from './commands/version.ts'
import {gates} from './lib/gates.ts'
import {generators} from './lib/generated.ts'
import {cliName, linkedBin} from './lib/invocation.ts'
import {workspaceRoot} from './lib/repo.ts'
import {exitCodes, guard, next, progress, settle} from './outcome.ts'
import {ciCommands} from './ci.ts'
import {setupCommands} from './setup.ts'

const root = process.env['TOOLS_ROOT'] ?? workspaceRoot
const {version} = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')) as {version: string}

export {exitCodes}

const problem = z.object({file: z.string().optional(), line: z.number().optional(), message: z.string()})
const since = z.string().optional().describe('Compare with this ref instead of the merge base')
const unitSummary = z.object({path: z.string(), kind: z.string(), name: z.string()})

const cli = Cli.create(cliName, {
  version,
  description: `This repository's own tools: orientation, package map, checks, tests, generated files and vendored updates. ${
    linkedBin
      ? "Run as `projections-tools <command>` from anywhere: inside a Projections checkout it runs that checkout's tools."
      : 'Run from the workspace root as `npm run tools -- <command>`.'
  }`,
  update: false,
  sync: {
    cwd: root,
    suggestions: ['brief me on this repository', 'check my change', 'which tests cover this file?'],
  },
  mcp: {
    // The linked command's absolute path when run as projections-tools, so the registration outlives this checkout.
    command: linkedBin ? `${linkedBin} --mcp` : `node ${join(import.meta.dirname, 'bin.ts')} --mcp`,
    instructions:
      'Start with the context tool. Verify a change cheapest first: check with fast=true, then test one target, then check and test with affected=true. Explain a path before editing generated files.',
  },
})

cli.command('context', {
  description: 'One-screen briefing: purpose, areas, toolchains, git state, changed packages and invariants',
  hint: 'Run this first in a new session.',
  output: z.object({
    purpose: z.string(),
    areas: z.array(z.object({path: z.string(), packages: z.number(), description: z.string()})),
    toolchains: z.array(z.object({name: z.string(), required: z.string(), installed: z.string(), status: z.string()})),
    git: z.object({branch: z.string(), head: z.string(), dirty: z.number(), untracked: z.number(), base: z.string()}),
    changed: z.object({files: z.number(), packages: z.array(z.string()), dependants: z.number(), other: z.number()}),
    invariants: z.array(z.string()),
    invariantsSource: z.string(),
    next,
  }),
  run: () => guard(() => contextReport(root)),
})

cli.command('map', {
  description: 'Every npm workspace and Cargo crate: path, name, README description and dependencies on each other',
  args: z.object({filter: z.string().optional().describe('Only paths starting with, or names containing, this')}),
  examples: [{description: 'Everything'}, {args: {filter: 'packages/renderers'}, description: 'The renderers'}],
  output: z.object({
    count: z.number(),
    units: z.array(
      z.object({
        path: z.string(),
        kind: z.string(),
        name: z.string(),
        description: z.string(),
        flag: z.string().optional(),
        dependsOn: z.array(z.string()),
      }),
    ),
  }),
  run: c => guard(() => mapReport(root, c.args.filter)),
})

cli.command('modules', {
  description: "Import cycles inside each npm workspace's source, and package exports nothing imports: a report for planning refactors",
  args: z.object({workspace: z.string().optional().describe('Only this workspace (its directory)')}),
  options: z.object({
    also: z.array(z.string()).default([]).describe('Other directories whose imports count as consumers (relative to the root)'),
  }),
  examples: [{description: 'Every workspace'}, {args: {workspace: 'packages/host/core'}, description: 'One workspace'}],
  output: z.object({
    workspaces: z.array(
      z.object({
        path: z.string(),
        cycles: z.array(z.array(z.string())),
        unusedExports: z.array(z.object({entry: z.string(), names: z.array(z.string())})),
      }),
    ),
    note: z.string(),
    next,
  }),
  run: c => guard(() => modulesReport(root, c.args.workspace, c.options.also)),
})

cli.command('explain', {
  description: 'What owns a path: its package and description, tests beside it, whether it is generated, and the checks to run',
  args: z.object({path: z.string().describe('A file or directory, relative to the workspace root')}),
  examples: [
    {args: {path: 'packages/renderers/graph/src/layout.ts'}, description: 'A source file'},
    {args: {path: 'docs/reference/cli.md'}, description: 'A generated page'},
  ],
  output: z.object({
    path: z.string(),
    exists: z.boolean(),
    owner: z.object({path: z.string(), kind: z.string(), name: z.string(), description: z.string()}),
    tests: z.array(z.string()),
    generated: z.union([z.literal(false), z.object({by: z.string(), regenerate: z.string(), note: z.string()})]),
    checks: z.array(z.string()),
    run: z.array(z.string()),
  }),
  run: c => guard(() => explainReport(root, c.args.path)),
})

const docs = Cli.create('docs', {description: 'Search and read the repository’s Markdown, locally'})
docs.command('search', {
  description: 'Rank Markdown files by the query words (titles, headings, descriptions and text)',
  args: z.object({query: z.string().describe('Words to look for')}),
  options: z.object({limit: z.number().default(8).describe('Most results')}),
  examples: [{args: {query: 'comparator tests'}, description: 'Where comparator tests are described'}],
  output: z.object({
    query: z.string(),
    hits: z.array(z.object({path: z.string(), title: z.string(), section: z.string().optional(), line: z.number(), snippet: z.string()})),
    next,
  }),
  run: c => guard(() => docsSearch(root, c.args.query, c.options.limit)),
})
docs.command('read', {
  description: 'Print a Markdown file by path or title, or one section of it',
  args: z.object({target: z.string().describe('A path (or unique suffix) or a title')}),
  options: z.object({
    section: z.string().optional().describe('Only the section under this heading'),
    maxLines: z.number().default(200).describe('Most lines to print; the rest is summarised by its headings'),
  }),
  examples: [
    {args: {target: 'CONTRIBUTING.md'}, options: {section: 'Invariants'}, description: 'One section'},
    {args: {target: 'contracts'}, description: 'By title'},
  ],
  output: z.object({
    path: z.string(),
    title: z.string(),
    lines: z.number(),
    text: z.string(),
    truncated: z.boolean(),
    headings: z.array(z.string()).optional(),
    next,
  }),
  run: c => guard(() => docsRead(root, c.args.target, {section: c.options.section, maxLines: c.options.maxLines})),
})
cli.command(docs)

cli.command('doctor', {
  description:
    'Is this machine ready? Toolchains, registry, installed dependencies, stale builds, Playwright browsers, memory, gh and the projections-tools link',
  hint: 'Exits 1 only on failures (wrong Node, missing dependencies, a public npm registry); warnings exit 0.',
  output: z.object({
    status: z.enum(['ok', 'warn', 'fail']),
    findings: z.array(
      z.object({check: z.string(), status: z.enum(['ok', 'warn', 'fail']), detail: z.string(), fix: z.string().optional()}),
    ),
    next,
  }),
  run: () => guard(() => settle(doctorReport(root))),
})

cli.command('affected', {
  description: 'What the change touches: changed workspaces and crates, their dependants, generated files to regenerate, and what to run',
  options: z.object({since}),
  output: z.object({
    base: z.object({ref: z.string(), commit: z.string(), reason: z.string()}),
    files: z.number(),
    changed: z.array(unitSummary),
    dependants: z.array(unitSummary),
    other: z.array(z.string()),
    moreOther: z.number().optional(),
    regenerate: z.array(z.object({name: z.string(), outputs: z.array(z.string()), generate: z.string()})),
    kinds: z.array(z.string()),
    next,
  }),
  run: c => guard(() => affectedReport(root, c.options.since)),
})

cli.command(ciCommands(root))

const gateNames = gates.map(gate => gate.name).join(', ')
cli.command('check', {
  description: `Run the repository's gates and summarise each, with the first problems as {file, line, message}. Gates: ${gateNames}`,
  hint: 'Gates run one at a time in a fixed order; build-dependent gates are skipped when build fails. clippy runs only with --clippy or --only. Start with --fast: it fails in seconds on what a full check would find minutes later.',
  options: z.object({
    affected: z.boolean().default(false).describe('Only what the change touches (changed files, affected workspaces)'),
    fast: z
      .boolean()
      .default(false)
      .describe(
        'Only the cheap gates, over what changed (implies --affected): format, lint, cargo check and typecheck of the changed crates and workspaces, and the repository rules. Builds and tests nothing',
      ),
    since,
    only: z.array(z.string()).optional().describe(`Only these gates (repeat or comma-separate): ${gateNames}`),
    clippy: z.boolean().default(false).describe('Also run clippy'),
    limit: z.number().default(5).describe('Most problems listed per gate'),
  }),
  examples: [
    {options: {fast: true}, description: 'First: the cheap gates over what changed'},
    {options: {affected: true}, description: 'Then: everything the change touches'},
    {options: {only: ['format,lint']}, description: 'Two gates over everything'},
  ],
  output: z.object({
    status: z.enum(['pass', 'fail']),
    scope: z.string(),
    gates: z.array(z.object({gate: z.string(), status: z.enum(['pass', 'fail', 'skip']), seconds: z.number(), note: z.string()})),
    failures: z.array(
      z.object({
        gate: z.string(),
        commands: z.array(z.string()),
        problems: z.array(problem),
        moreProblems: z.number().optional(),
        tail: z.array(z.string()).optional(),
        fix: z.string().optional(),
      }),
    ),
    next,
  }),
  run: c => guard(async () => settle(await checkReport(root, c.options, progress(c.agent)))),
})

cli.command('build', {
  description:
    'Build a workspace and the workspaces it needs, rebuilding a dependency only when it is out of date; npm run build rebuilds all of them, the release CLI and Storybook included',
  hint: "A dependency is rebuilt when it was never built, its src is newer than its dist, or one of its own dependencies was rebuilt or is newer. Workspaces that build Rust always run, Cargo skipping what is current; one whose outputs come out the same (`unchanged`) keeps their times, so nothing above it rebuilds. Changes outside src (a vite config, a build script) aren't seen: pass --force.",
  args: z.object({target: z.string().optional().describe('A workspace: path or npm name')}),
  options: z.object({
    affected: z.boolean().default(false).describe('The changed workspaces (not their dependants), and what they need'),
    since,
    force: z.boolean().default(false).describe('Rebuild every dependency, current or not'),
    dryRun: z.boolean().default(false).describe('List what would be built, and why, without building'),
    limit: z.number().default(8).describe('Most problems listed for a failed build'),
  }),
  examples: [
    {args: {target: 'packages/renderers/graph'}, description: 'A renderer and what it needs'},
    {args: {target: 'packages/cli'}, description: 'The CLI with whatever renderer, host or Inspector change it embeds'},
    {options: {affected: true}, description: 'What the change touches'},
    {args: {target: 'packages/host/inspector'}, options: {dryRun: true}, description: 'What would be built'},
  ],
  output: z.object({
    status: z.enum(['pass', 'fail']),
    steps: z.array(
      z.object({
        workspace: z.string(),
        status: z.enum(['built', 'unchanged', 'current', 'planned', 'failed', 'skip']),
        reason: z.string(),
        seconds: z.number().optional(),
        problems: z.array(problem).optional(),
        moreProblems: z.number().optional(),
        tail: z.array(z.string()).optional(),
      }),
    ),
    notes: z.array(z.string()),
    next,
  }),
  run: c => guard(async () => settle(await buildReport(root, {...c.options, target: c.args.target}, progress(c.agent)))),
})

cli.command('test', {
  description:
    'Run workspace unit tests and Rust tests, summarising failures. Browser suites run only with --browser: one project, at most 2 workers',
  args: z.object({target: z.string().optional().describe('A workspace or crate: path, npm name or crate name')}),
  options: z.object({
    affected: z.boolean().default(false).describe("The changed workspaces and crates and their dependants (crates' Rust tests included)"),
    since,
    rust: z.boolean().default(false).describe('Include Rust tests (cargo test) for the target, or the whole workspace'),
    browser: z.string().optional().describe('Run this Playwright project of the selected browser suites instead, e.g. chromium-desktop'),
    filter: z
      .string()
      .optional()
      .describe(
        "Only tests whose name matches (node's --test-name-pattern, cargo test's filter, Playwright's --grep); needs a target or --affected",
      ),
    limit: z.number().default(8).describe('Most failures listed per run'),
  }),
  examples: [
    {options: {affected: true}, description: 'Test the current change'},
    {args: {target: 'packages/renderers/graph'}, description: 'One workspace'},
    {args: {target: 'packages/engine'}, options: {rust: true}, description: 'One crate'},
    {args: {target: 'packages/renderers/graph'}, options: {filter: 'layout'}, description: 'The tests whose name matches'},
    {args: {target: 'packages/host/core'}, options: {browser: 'chromium-desktop'}, description: "One browser project of the host's suite"},
  ],
  output: z.object({
    status: z.enum(['pass', 'fail']),
    runs: z.array(
      z.object({
        target: z.string(),
        command: z.string(),
        status: z.enum(['pass', 'fail']),
        durationMs: z.number(),
        passed: z.number().optional(),
        failed: z.number().optional(),
        problems: z.array(problem).optional(),
        moreProblems: z.number().optional(),
        tail: z.array(z.string()).optional(),
      }),
    ),
    notes: z.array(z.string()),
    next,
  }),
  run: c => guard(async () => settle(await testReport(root, {...c.options, target: c.args.target}, progress(c.agent)))),
})

const generatorNames = generators.map(generator => generator.name).join(', ')
cli.command('generated', {
  description: 'The registry of committed generated files and their generators; `generated check` verifies they are current',
  args: z.object({action: z.enum(['list', 'check']).default('list').describe('list (default) or check')}),
  options: z.object({only: z.array(z.string()).optional().describe(`Only these generators: ${generatorNames}`)}),
  hint: "Never edit generated files by hand. Checks that need what isn't here (a browser, the network, a toolchain) are skipped with the reason.",
  examples: [{description: 'List generators'}, {args: {action: 'check'}, description: 'Check every checkable generator'}],
  output: z.union([
    z.object({
      generators: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
          outputs: z.array(z.string()),
          files: z.number(),
          generate: z.string(),
          check: z.string(),
          needs: z.array(z.string()),
        }),
      ),
      unregistered: z.array(z.string()),
      rule: z.string(),
      next,
    }),
    z.object({
      status: z.enum(['pass', 'fail']),
      results: z.array(
        z.object({
          name: z.string(),
          status: z.enum(['current', 'stale', 'skip', 'error']),
          detail: z.string().optional(),
          files: z.array(z.string()).optional(),
          fix: z.string().optional(),
        }),
      ),
      next,
    }),
  ]),
  run: c =>
    guard(async () => {
      if (c.args.action === 'check') return settle(await generatedCheck(root, split(c.options.only), progress(c.agent)))
      const list = generatedList(root)
      if (list.unregistered.length) process.exitCode = exitCodes.failures
      return list
    }),
})

cli.command('fix', {
  description: 'Run the formatters (oxfmt, cargo fmt) and the offline regenerators whose prerequisites are met, and report what changed',
  options: z.object({
    affected: z.boolean().default(false).describe('Only changed files, and generators whose inputs changed'),
    since,
    only: z.array(z.string()).optional().describe(`Only these: format, cargo-fmt, ${generatorNames}`),
  }),
  examples: [
    {options: {affected: true}, description: 'Fix the current change'},
    {options: {only: ['format']}, description: 'Format everything'},
  ],
  output: z.object({
    status: z.enum(['pass', 'fail']),
    changed: z.number(),
    steps: z.array(
      z.object({
        step: z.string(),
        status: z.enum(['ran', 'failed', 'skip']),
        changed: z.array(z.string()).optional(),
        reason: z.string().optional(),
        tail: z.array(z.string()).optional(),
      }),
    ),
    next,
  }),
  run: c => guard(async () => settle(await fixReport(root, c.options, progress(c.agent)))),
})

cli.command('verify', {
  description:
    "Prove the Engine's verified crate (packages/engine/verified) with the pinned Verus release, then run the mutation check that plants one bug per specification clause",
  hint: 'Verus and the Rust toolchain it needs are pinned in packages/engine/verified/verus.toml; --install downloads the release into ~/.cache/projections/verus and installs that toolchain. Exits 3 when they are missing.',
  options: z.object({
    install: z.boolean().default(false).describe('Download the pinned Verus release and install the Rust toolchain it needs'),
    proofsOnly: z.boolean().default(false).describe('Skip the mutation check'),
  }),
  examples: [
    {options: {}, description: 'Prove and mutation check'},
    {options: {install: true}, description: 'First run: install the pinned Verus'},
    {options: {proofsOnly: true}, description: 'Proofs only'},
  ],
  output: z.object({
    status: z.enum(['pass', 'fail']),
    verified: z.number().describe('Items Verus verified'),
    seconds: z.number(),
    mutants: z.object({caught: z.number(), total: z.number(), seconds: z.number()}).optional(),
    problems: z.array(problem),
    next,
  }),
  run: c =>
    guard(async () => settle(await verifyReport(root, {install: c.options.install, mutants: !c.options.proofsOnly}, progress(c.agent)))),
})

const update = Cli.create('update', {
  description: 'Bring vendored third-party code up to date from upstream. Needs the network, so `fix` never runs it',
})
update.command('shadcn', {
  description:
    'Three-way merge the vendored shadcn/ui components (packages/host/core/src/ui/components) with an upstream release; --check only reports what changed upstream',
  hint: 'Needs the network: ui.shadcn.com and the GitHub API (GITHUB_TOKEN or gh auth login avoids its rate limit). Exits 1 when --check finds changes or a merge conflicts; conflicts are left as diff3 markers.',
  args: z.object({
    components: z.array(z.string()).optional().describe('Only these components; a name without a vendored file adds it'),
  }),
  options: z.object({
    check: z.boolean().default(false).describe('Report which components changed upstream since our base; writes nothing'),
    dryRun: z.boolean().default(false).describe('Merge in memory and report clean merges and conflicts; writes nothing'),
    version: z.string().optional().describe('The shadcn release to update to (default: the latest)'),
    unreleased: z.boolean().default(false).describe('Accept a registry that has moved past the release, recorded as <version>+<main sha>'),
  }),
  examples: [
    {options: {check: true}, description: 'What changed upstream'},
    {options: {dryRun: true}, description: 'Preview an update to the latest release'},
    {args: {components: ['tooltip']}, description: 'Add a component at our release'},
  ],
  output: z.object({
    status: z.enum(['pass', 'fail']),
    mode: z.enum(['check', 'dry-run', 'update']),
    ours: z.string(),
    upstream: z.string(),
    registry: z.string(),
    moved: z.array(z.object({sha: z.string(), message: z.string(), path: z.string()})).optional(),
    components: z.array(z.object({name: z.string(), status: z.string(), conflicts: z.number().optional()})),
    written: z.boolean(),
    problems: z.array(problem),
    next,
  }),
  run: c => guard(async () => settle(await shadcnReport(root, {...c.options, components: c.args.components}, progress(c.agent)))),
})
cli.command(update)

const setup = setupCommands(root)
cli.command('install', setup.install)
cli.command('link', setup.link)
cli.command('unlink', setup.unlink)

cli.command('version', {
  description:
    'The release version every shipped manifest carries (Cargo, the npm workspaces in packages/, their dependencies on each other, both lockfiles): check them, against a release tag with --tag, or set them all',
  hint: 'Everything in packages/ releases at one version; tools/ and examples/ stay private at 0.0.0. Reads files only, so it is cheap; the release workflow runs it with --tag. See docs/maintainers/releasing.md.',
  args: z.object({set: z.string().optional().describe('Set every shipped manifest to this version, such as 0.2.0, then check')}),
  options: z.object({tag: z.string().optional().describe('Also fail unless this release tag, such as v0.1.0, names the release version')}),
  examples: [
    {description: 'Check that every shipped manifest agrees'},
    {options: {tag: 'v0.1.0'}, description: 'Check them against a release tag'},
    {args: {set: '0.2.0'}, description: 'Bump every shipped manifest and both lockfiles'},
  ],
  output: z.object({
    status: z.enum(['pass', 'fail']),
    version: z.string().describe("The release version: the Cargo workspace's"),
    tag: z.string().optional(),
    released: z.object({crates: z.number(), workspaces: z.number()}),
    changed: z.array(z.string()).optional().describe('Files the bump changed'),
    problems: z.array(problem),
    next,
  }),
  run: c => guard(() => settle(versionReport(root, {set: c.args.set, tag: c.options.tag}))),
})

cli.command('feedback', {
  description:
    "Draft a GitHub issue about friction with this repository's tooling or docs. Prints the draft and a prefilled URL; files it only with --submit",
  args: z.object({summary: z.string().describe('One line: what you were trying to do and what went wrong')}),
  options: z.object({
    details: z.string().optional().describe('What happened, what you expected, what you tried'),
    command: z.string().optional().describe('The command and inputs involved'),
    error: z.string().optional().describe('The error output'),
    submit: z.boolean().default(false).describe('File it with gh (after checking for a similar open issue); without gh, print the URL'),
    comment: z.number().optional().describe('With --submit: comment on this existing issue instead of opening one'),
  }),
  hint: 'Absolute paths become repository-relative and credential-like strings are removed. Never submit without the person agreeing.',
  examples: [
    {
      args: {summary: 'tools test --browser has no way to pass a grep'},
      options: {command: 'npm run tools -- test host --browser chromium-desktop'},
      description: 'Draft only',
    },
  ],
  output: z.object({
    status: z.enum(['draft', 'url', 'duplicate?', 'filed', 'commented']),
    repository: z.string(),
    draft: z.object({title: z.string(), labels: z.array(z.string()), body: z.string()}).optional(),
    url: z.string().optional(),
    reason: z.string().optional(),
    note: z.string().optional(),
    issue: z.number().optional(),
    similar: z.array(z.object({number: z.number(), title: z.string(), url: z.string(), similarity: z.number()})).optional(),
    next,
  }),
  run: c => guard(() => feedbackReport(root, {...c.options, summary: c.args.summary})),
})

export default cli
