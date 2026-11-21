// The registry of committed generated files: what writes each, from which inputs, and how to check it is current.
// Every file whose first line is a comment saying it was generated must be covered by an entry; `tools generated`
// reports any that aren't, and this package's tests fail on them.
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {git, matches, walk, type Command} from './repo.ts'

/** What a generator needs before it can run. */
export type Need = 'build' | 'cli' | 'nightly' | 'rust' | 'dist' | 'network' | 'browser' | 'toolchains'

export type Check =
  | {mode: 'script'; commands: Command[]}
  | {mode: 'snapshot'}
  | {mode: 'tests'; commands: Command[]}
  | {mode: 'none'; reason: string}

export type Generator = {
  name: string
  description: string
  /** Globs of the committed files it writes. */
  outputs: string[]
  /** Globs of the sources it reads: a change to one may need regenerating. */
  inputs: string[]
  generate: Command[]
  check: Check
  needs: Need[]
  /** Whether `tools fix` runs it (offline and deterministic) when its needs are met. */
  fix: boolean
}

const npm = (...argv: string[]): Command => ({argv: ['npm', ...argv]})
const node = (...argv: string[]): Command => ({argv: ['node', ...argv]})

export const generators: Generator[] = [
  {
    name: 'reference-docs',
    description: 'docs/reference pages and docs/agents prompt files, from action.yml, the schemas, tokens, renderers, catalog and SDK APIs',
    outputs: ['docs/reference/**/*.md', 'docs/agents/*.md'],
    inputs: [
      'action.yml',
      'packages/schemas/src/**',
      'packages/renderers/sdk/src/**',
      'packages/renderers/kit/src/**',
      'packages/renderers/*/package.json',
      'packages/cli/src/**',
      'packages/cli/templates/SKILL.md',
      'packages/extractors/catalog/**',
      'packages/extractors/sdk/src/**',
      'docs/setup/**',
      'tools/scripts/reference-docs.mjs',
      'tools/scripts/reference-docs/**',
    ],
    generate: [npm('run', 'docs:generate')],
    check: {mode: 'script', commands: [npm('run', 'docs:check')]},
    needs: ['build', 'nightly'],
    fix: true,
  },
  {
    name: 'builtin-docs',
    description:
      "The generated regions of the built-ins' pages (docs/builtins): facts, inputs, options and definitions from the catalog, manifests and schemas; the rest is written by hand",
    outputs: ['docs/builtins/**/*.md'],
    inputs: [
      'packages/cli/src/**',
      'packages/extractors/catalog/**',
      'packages/extractors/*/src/**',
      'packages/renderers/*/package.json',
      'packages/schemas/src/**',
      'tools/scripts/reference-docs.mjs',
      'tools/scripts/reference-docs/**',
      '.oxfmtrc.json',
    ],
    generate: [npm('run', 'docs:generate', '--', '--only', 'builtins')],
    check: {mode: 'script', commands: [node('tools/scripts/reference-docs.mjs', '--check', '--only', 'builtins')]},
    needs: ['build'],
    fix: true,
  },
  {
    name: 'schemas',
    description: 'The published JSON Schemas and the engine data rules fixture, from the TypeBox sources',
    outputs: ['packages/schemas/schemas/**/*.json', 'packages/schemas/fixtures/data-rules.json'],
    inputs: ['packages/schemas/src/**', 'packages/schemas/scripts/generate.mjs'],
    generate: [npm('run', 'generate', '--workspace', '@githubnext/projections-schemas')],
    check: {
      mode: 'script',
      commands: [
        npm('run', 'build', '--workspace', '@githubnext/projections-schemas'),
        node('packages/schemas/scripts/generate.mjs', '--check'),
      ],
    },
    needs: [],
    fix: true,
  },
  {
    name: 'vscode-tools',
    description: "packages/integrations/vscode/package.json's languageModelTools, from the CLI's agent tool catalog",
    outputs: ['packages/integrations/vscode/package.json'],
    inputs: ['packages/cli/src/**', 'packages/integrations/vscode/scripts/tools.mjs'],
    generate: [node('packages/integrations/vscode/scripts/tools.mjs')],
    check: {mode: 'script', commands: [node('packages/integrations/vscode/scripts/tools.mjs', '--check')]},
    needs: ['cli'],
    fix: true,
  },
  {
    name: 'node-extractor-module',
    description:
      'packages/cli/node/extractor.mjs: @githubnext/projections/extractor bundled into one module, which the CLI gives extractors run with node',
    outputs: ['packages/cli/node/extractor.mjs'],
    inputs: ['packages/sdk/src/extractor.ts', 'packages/sdk/src/extractor/**', 'packages/sdk/scripts/extractor-module.mjs'],
    generate: [npm('run', 'generate:extractor', '--workspace', '@githubnext/projections')],
    check: {mode: 'script', commands: [node('packages/sdk/scripts/extractor-module.mjs', '--check')]},
    needs: [],
    fix: true,
  },
  {
    name: 'product-icons',
    description: "The Projections mark and the parts' icons: brand/parts SVGs, the VS Code icon font and the SDK's default icon tokens",
    outputs: [
      'brand/parts/*.svg',
      'packages/integrations/vscode/media/icons/projections-icons.woff',
      'packages/renderers/sdk/src/part-icons.generated.ts',
    ],
    inputs: ['tools/scripts/product-icons.mjs', 'tools/scripts/icon-font.mjs', 'brand/projections-mark.svg'],
    generate: [npm('run', 'icons')],
    check: {mode: 'script', commands: [npm('run', 'check:icons')]},
    needs: [],
    fix: true,
  },
  {
    name: 'codicon-tokens',
    description: 'packages/host/vscode-ui/src/icons.generated.ts: the renderer icon tokens as codicons',
    outputs: ['packages/host/vscode-ui/src/icons.generated.ts'],
    inputs: ['packages/host/vscode-ui/scripts/icons.mjs', 'packages/host/core/src/**/icons*', 'packages/renderers/sdk/src/tokens.ts'],
    generate: [npm('run', 'icons', '--workspace', '@githubnext/projections-host-vscode')],
    check: {mode: 'snapshot'},
    needs: [],
    fix: true,
  },
  {
    name: 'host-vscode-notices',
    description: 'packages/host/vscode-ui/THIRD_PARTY_NOTICES.md, the licences of what the VS Code UI bundles',
    outputs: ['packages/host/vscode-ui/THIRD_PARTY_NOTICES.md'],
    inputs: [
      'packages/host/vscode-ui/package.json',
      'packages/host/vscode-ui/scripts/notices.mjs',
      'packages/host/core/build/ui-notices.mjs',
      'package-lock.json',
    ],
    generate: [node('packages/host/vscode-ui/scripts/notices.mjs')],
    check: {mode: 'script', commands: [node('packages/host/vscode-ui/scripts/notices.mjs', '--check')]},
    needs: [],
    fix: true,
  },
  {
    name: 'crate-notices-table',
    description: "notices/README.md's table of the upstream license texts, from notices/notices.json; the rest is written by hand",
    outputs: ['notices/README.md'],
    inputs: ['notices/notices.json', 'tools/scripts/notices.mjs'],
    generate: [node('tools/scripts/notices.mjs', '--write')],
    check: {mode: 'snapshot'},
    needs: [],
    fix: true,
  },
  {
    name: 'rules-language',
    description: "packages/comparators/rules/language.json, the rules language's manifest (the interpreter's identity)",
    outputs: ['packages/comparators/rules/language.json'],
    inputs: ['packages/comparators/rules/src/**'],
    generate: [
      {argv: ['cargo', 'test', '--locked', '-p', 'projections-comparator-rules', '--test', 'language'], env: {UPDATE_LANGUAGE: '1'}},
    ],
    check: {mode: 'script', commands: [{argv: ['cargo', 'test', '--locked', '-p', 'projections-comparator-rules', '--test', 'language']}]},
    needs: ['rust'],
    fix: true,
  },
  {
    name: 'release-workflow',
    description: '.github/workflows/release.yml, generated by dist from dist-workspace.toml',
    outputs: ['.github/workflows/release.yml'],
    inputs: ['dist-workspace.toml', 'Cargo.toml', '.github/release-build-setup.yml'],
    generate: [node('tools/scripts/dist.mjs')],
    check: {mode: 'script', commands: [node('tools/scripts/dist.mjs', '--check')]},
    needs: ['dist'],
    fix: false,
  },
  {
    name: 'linguist',
    description: "packages/renderers/sdk/vendor/linguist: GitHub Linguist's language table at a pinned release, calibrated to the palette",
    outputs: ['packages/renderers/sdk/vendor/linguist/**'],
    inputs: [
      'packages/renderers/sdk/scripts/linguist.mjs',
      'packages/renderers/sdk/scripts/calibration.mjs',
      'packages/renderers/sdk/scripts/colors.mjs',
    ],
    generate: [node('packages/renderers/sdk/scripts/linguist.mjs')],
    check: {mode: 'none', reason: 'fetches the pinned Linguist release from GitHub'},
    needs: ['build', 'network'],
    fix: false,
  },
  {
    name: 'chart-palette',
    description: 'The calibrated chart palette in packages/renderers/sdk/src/tokens.ts',
    outputs: ['packages/renderers/sdk/src/tokens.ts'],
    inputs: [
      'packages/renderers/sdk/scripts/palette.mjs',
      'packages/renderers/sdk/scripts/calibration.mjs',
      'packages/renderers/sdk/scripts/colors.mjs',
    ],
    generate: [node('packages/renderers/sdk/scripts/palette.mjs')],
    check: {mode: 'none', reason: 'rewrites part of a hand-written file; rerun after changing the calibration'},
    needs: ['build'],
    fix: false,
  },
  {
    name: 'comparator-images',
    description: 'docs/images/comparators: the comparator examples drawn by the CLI and the real renderers',
    outputs: ['docs/images/comparators/**'],
    inputs: ['tools/scripts/comparator-examples.mjs', 'packages/comparators/**/*.comparator.yaml'],
    generate: [node('tools/scripts/comparator-examples.mjs')],
    check: {mode: 'none', reason: 'drawing needs a browser; not checked in CI'},
    needs: ['build', 'cli', 'browser'],
    fix: false,
  },
  {
    name: 'vscode-icon',
    description: "packages/integrations/vscode/media/icon.png, the Marketplace icon rendered from the brand's app icon",
    outputs: ['packages/integrations/vscode/media/icon.png'],
    inputs: ['brand/projections-app-icon.svg'],
    generate: [node('packages/integrations/vscode/scripts/icon.mjs')],
    check: {mode: 'none', reason: 'rendering needs headless Chromium'},
    needs: ['browser'],
    fix: false,
  },
  {
    name: 'api-fixtures',
    description: "The api renderer's compatibility fixtures, from real projects with the real extractors",
    outputs: ['packages/renderers/api/fixtures/**'],
    inputs: ['packages/renderers/api/scripts/fixtures.mjs'],
    generate: [node('packages/renderers/api/scripts/fixtures.mjs', 'dotnet', 'typescript', 'rust', 'go')],
    check: {mode: 'none', reason: "needs each ecosystem's toolchain"},
    needs: ['cli', 'toolchains'],
    fix: false,
  },
  {
    name: 'extractor-goldens',
    description: "Extractors' golden expected outputs, rewritten by their Rust tests",
    outputs: ['packages/extractors/*/tests/**/expected.json', 'packages/extractors/*/tests/fixtures/expected/**'],
    inputs: ['packages/extractors/*/src/**'],
    generate: [{argv: ['cargo', 'test', '--locked', '--workspace'], env: {PROJECTIONS_UPDATE_GOLDEN: '1'}}],
    check: {mode: 'tests', commands: [{argv: ['cargo', 'test', '--locked', '--workspace']}]},
    needs: ['rust'],
    fix: false,
  },
]

/** A first line announcing a generated file: a comment saying it was generated. */
const marker = /^(<!--|\/\/|#|\/\*)\s*(this file was )?(auto-?)?generated (by|from)\b/i

/** Files whose first line announces they are generated (Markdown, code, JSON and YAML). */
export function markedFiles(root: string, files: readonly string[] = walkAll(root)): string[] {
  return files.filter(path => {
    if (!/\.(md|ts|js|mjs|json|ya?ml|rs)$/.test(path)) return false
    try {
      return marker.test(readFileSync(join(root, path), 'utf8').slice(0, 300).split('\n')[0] ?? '')
    } catch {
      return false
    }
  })
}

/** The generator whose outputs include `path`. */
export function generatorFor(path: string, registry: readonly Generator[] = generators): Generator | undefined {
  return registry.find(generator => matches(path, generator.outputs))
}

/** Generators whose inputs include one of `paths`. */
export function generatorsAffectedBy(paths: readonly string[], registry: readonly Generator[] = generators): Generator[] {
  return registry.filter(generator => paths.some(path => matches(path, generator.inputs) && !matches(path, generator.outputs)))
}

/** The committed files a generator's output globs match. */
export function outputFiles(root: string, generator: Generator, files?: readonly string[]): string[] {
  const all = files ?? walkAll(root)
  return all.filter(path => matches(path, generator.outputs))
}

/** Every file Git tracks or would track (not ignored), relative to `root`; outside Git, every file walked. */
export function walkAll(root: string): string[] {
  const listed = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '--', '.'])
  if (listed !== undefined) return listed.split('\n').filter(path => path && existsSync(join(root, path)))
  return [...walk(root), ...walk(root, '.github')]
}
