// The commands that set up this machine rather than work on the repository: `install` (the product, for early access)
// and `link`/`unlink` (the optional `projections-tools` command for these tools).
import {Cli, z} from 'incur'
import {installReport} from './commands/install.ts'
import {linkReport, unlinkReport} from './commands/link.ts'
import {editors, parts, TARBALL} from './lib/install.ts'
import {guard, next, progress, settle} from './outcome.ts'

const binDir = z.string().optional().describe('Where the projections-tools command goes (default ~/.local/bin)')
const dryRun = z.boolean().default(false).describe('Report what would change; change nothing')

export function setupCommands(root: string) {
  const install = Cli.command({
    description:
      'Build this checkout and install it for early access: the projections CLI linked onto PATH, the VS Code extension (this CLI inside) and @githubnext/projections packed for file: references',
    hint: `Run it again after git pull to update. The package is always ${TARBALL}; --project points a renderer package at it. Checks tools doctor first (exit 3 when a toolchain is missing).`,
    options: z.object({
      only: z
        .array(z.string())
        .optional()
        .describe(`Only these parts (repeat or comma-separate): ${parts.join(', ')}`),
      project: z
        .string()
        .optional()
        .describe("Also point this renderer package's @githubnext/projections at the tarball (file:) and npm install it there"),
      binDir: z.string().optional().describe('Where to link projections (default ~/.local/bin)'),
      editor: z
        .enum(editors)
        .default('auto')
        .describe('Install the extension into code, code-insiders, the first found (auto), or package only (none)'),
      extensionsDir: z.string().optional().describe("Passed to the editor's --extensions-dir (an isolated install)"),
      userDataDir: z.string().optional().describe("Passed to the editor's --user-data-dir"),
      skipBuild: z.boolean().default(false).describe('Use the existing build instead of building'),
      dryRun: z.boolean().default(false).describe('Print the plan; change nothing'),
    }),
    examples: [
      {description: 'Everything, into VS Code'},
      {
        options: {only: ['npm'], project: '../my-repo/.github/projections/flags/renderer'},
        description: 'Pack the package and use it in a renderer',
      },
      {options: {only: ['vscode'], editor: 'none'}, description: 'Package the extension only'},
    ],
    output: z.object({
      status: z.enum(['ok', 'fail', 'planned']),
      build: z.object({commit: z.string(), dirty: z.boolean()}),
      steps: z.array(
        z.object({
          step: z.string(),
          status: z.enum(['ran', 'skip', 'planned', 'failed']),
          detail: z.string(),
          commands: z.array(z.string()).optional(),
          seconds: z.number().optional(),
          tail: z.array(z.string()).optional(),
        }),
      ),
      installed: z.array(z.object({part: z.string(), path: z.string(), version: z.string().optional()})),
      warnings: z.array(z.string()),
      next,
    }),
    run: c => guard(async () => settle(await installReport(root, c.options, progress(c.agent), !c.agent))),
  })

  const link = Cli.command({
    description:
      "Put a projections-tools command on PATH (~/.local/bin) that runs these tools from anywhere: inside a Projections checkout that checkout's own tools, elsewhere this checkout's, with the checkout's pinned Node",
    hint: 'Optional: npm run tools -- stays the default. A launcher script, not npm link; it never replaces a file it did not write. Run it again to relink another checkout.',
    options: z.object({binDir, dryRun}),
    examples: [{description: 'Link this checkout'}, {options: {dryRun: true}, description: 'What it would write'}],
    output: z.object({
      status: z.enum(['linked', 'unchanged', 'planned']),
      path: z.string(),
      checkout: z.string(),
      node: z.object({path: z.string(), version: z.string()}),
      resolution: z.string(),
      warnings: z.array(z.string()),
      next,
    }),
    run: c => guard(() => linkReport(root, c.options)),
  })

  const unlink = Cli.command({
    description: 'Remove the projections-tools command that tools link wrote',
    hint: 'Refuses to remove a file tools link did not write.',
    options: z.object({binDir, dryRun}),
    output: z.object({
      status: z.enum(['unlinked', 'absent', 'planned']),
      path: z.string(),
      checkout: z.string().optional(),
      next,
    }),
    run: c => guard(() => unlinkReport(c.options)),
  })

  return {install, link, unlink}
}
