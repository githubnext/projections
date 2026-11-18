// The dependency rules tools/scripts/check-boundaries.mjs enforces: the npm workspaces' layer table and the crates' rules.

// The npm workspaces' layering, bottom to top: the contracts, the Engine, the renderer SDK, the kit, the built-in
// renderers, the hosts, the Inspector, then the VS Code extension and the CLI that ship it. Each workspace lists the
// first-party workspaces (by directory) it may depend on in production, and those it may use only in development
// (tests, builds and bundling). The first matching entry applies; a new workspace or edge must be added here.
const builtInRenderers = [
  'packages/renderers/api',
  'packages/renderers/code-statistics',
  'packages/renderers/database',
  'packages/renderers/dependency-injection',
  'packages/renderers/file-packing',
  'packages/renderers/graph',
  'packages/renderers/runtime-policy',
  'packages/renderers/agentic-workflows',
  'packages/renderers/text-diff',
]
export const layers = [
  ['packages/schemas', [], []],
  ['packages/engine/js', ['packages/schemas'], []],
  // Its tests evaluate first-party rules files and check what they produce with the Engine.
  ['packages/comparators/runtime/js', [], ['packages/engine/js']],
  ['packages/renderers/sdk', ['packages/schemas'], []],
  ['packages/renderers/kit', ['packages/schemas', 'packages/renderers/sdk'], ['packages/engine/js']],
  // Renderer test tooling: the checks third-party renderers run (published through `packages/sdk/`), and the
  // first-party renderers' browser suites.
  ['packages/renderers/testing', ['packages/schemas', 'packages/renderers/sdk'], []],
  [
    'packages/renderers/harness',
    [],
    ['packages/schemas', 'packages/engine/js', 'packages/comparators/runtime/js', 'packages/renderers/sdk', 'packages/renderers/testing'],
  ],
  // Built-in renderers; their tests compute real comparisons with the Engine and first-party comparator rules.
  [
    'packages/renderers/*',
    ['packages/schemas', 'packages/renderers/sdk', 'packages/renderers/kit'],
    ['packages/engine/js', 'packages/comparators/runtime/js'],
  ],
  // @githubnext/projections bundles the renderer-facing packages into one published package.
  ['packages/sdk', [], ['packages/schemas', 'packages/renderers/sdk', 'packages/renderers/kit', 'packages/renderers/testing']],
  ['examples/renderers/*', ['packages/sdk'], []],
  ['packages/host/core', ['packages/schemas', 'packages/renderers/sdk'], ['packages/engine/js']],
  ['packages/host/vscode-ui', ['packages/schemas', 'packages/host/core'], ['packages/renderers/sdk']],
  // The Inspector runs comparisons in the browser and hosts the renderer fixtures workbench; it bundles the built-in renderers.
  [
    'packages/host/inspector',
    [
      'packages/schemas',
      'packages/engine/js',
      'packages/comparators/runtime/js',
      'packages/renderers/sdk',
      'packages/renderers/testing',
      'packages/host/core',
    ],
    builtInRenderers,
  ],
  ['packages/integrations/vscode', ['packages/host/vscode-ui', 'packages/host/inspector'], []],
  // The viewer as an MCP App: the Inspector's viewer page, with the host's theme mapping, built into one page.
  ['packages/integrations/mcp-apps', ['packages/host/core', 'packages/host/inspector'], []],
  // The CLI embeds the Inspector, the MCP App page, the renderer checks and the TypeScript helper at build time.
  [
    'packages/cli',
    [],
    [
      'packages/engine/js',
      'packages/host/inspector',
      'packages/integrations/mcp-apps',
      'packages/renderers/testing',
      'packages/extractors/typescript-support',
    ],
  ],
  ['packages/extractors/typescript-support', [], ['packages/schemas', 'packages/engine/js']],
  // Samples to copy; class-summaries uses the published package's extractor helpers, as a copy would.
  ['examples/extractors', [], ['packages/engine/js', 'packages/sdk']],
  ['packages/integrations/github-action', [], ['packages/cli', 'packages/schemas']],
  // One Storybook over every UI: a development tool above everything it shows, the kit's icons included.
  [
    'tools/storybook',
    [],
    [
      'packages/schemas',
      'packages/engine/js',
      'packages/comparators/runtime/js',
      'packages/renderers/sdk',
      'packages/renderers/kit',
      'packages/host/core',
      'packages/host/vscode-ui',
      'packages/host/inspector',
      'examples/renderers/minimal',
      ...builtInRenderers,
    ],
  ],
  ['tools/cli', [], []],
]

/** The Projections crates each crate may depend on, by crate directory; `dev` also applies to development dependencies. */
export const crateRules = [
  {crates: 'packages/extractors/sdk', production: ['projections-engine'], dev: []},
  // Tests may check extractions with the public Engine and the default comparator.
  {crates: 'packages/extractors/*', production: [/^projections-extractor-/], dev: ['projections-engine', 'projections-comparator-default']},
  {crates: 'packages/comparators/default', production: ['projections-engine'], dev: []},
  // The rules comparator is Engine infrastructure layered on the default comparator's
  // matching core; its tests run it in the sandbox the comparator runtime provides.
  {
    crates: 'packages/comparators/rules',
    production: ['projections-engine', 'projections-comparator-default', 'projections-rules-yaml'],
    dev: [/^projections-/],
  },
  // The YAML subset rules and their tests are written in, and the tests' format: it never evaluates rules.
  {crates: 'packages/comparators/rules/yaml', production: ['projections-engine'], dev: []},
  // The sandbox for Projections' own comparator modules: the default comparator and the rules interpreter.
  {crates: 'packages/comparators/runtime', production: [], dev: []},
  {crates: 'examples/extractors/*', production: ['projections-extractor-sdk'], dev: []},
  // The CLI runs extractors only through their public entrypoint, and the
  // default comparator and comparator rules only in the comparator runtime;
  // it reads comparator rules tests with the rules' YAML reader, which evaluates nothing.
  {
    crates: 'packages/cli',
    production: [
      'projections-engine',
      'projections-comparator-runtime',
      'projections-extractor-catalog',
      'projections-extractor-sdk',
      'projections-rules-yaml',
    ],
    dev: [/^projections-/],
  },
]
