// Smoke test in a real VS Code (downloaded by @vscode/test-electron into .vscode-test): the extension starts the
// runner for a demo repository, the webview Inspector reads it through the message transport and compares a pair.
import {runTests} from '@vscode/test-electron'
import {execFileSync} from 'node:child_process'
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createDemoRepository} from './demo-repo.mjs'

/**
 * The smoke test drives the Inspector as on a desktop. A GitHub-hosted Windows runner's display is 1024×768, where VS
 * Code's editor is narrower than the Inspector's two-panel layout (1012 px), which moves the Details panel into a menu;
 * and Windows Server turns animations off, which Chromium reports as prefers-reduced-motion, which shows comparisons
 * without playing them. The test sets both as it starts, not in a CI step before it: such a step is skipped once an
 * earlier one fails, and the test then ran on the small display and timed out waiting for the Details panel's evidence.
 */
function desktopDisplay() {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Set-DisplayResolution -Width 1920 -Height 1080 -Force',
    `Add-Type -Namespace Win32 -Name User -MemberDefinition '[DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint action, uint parameter, IntPtr value, uint flags);'`,
    // SPI_SETCLIENTAREAANIMATION, on, saved and broadcast.
    "if (-not [Win32.User]::SystemParametersInfo(0x1043, 0, [IntPtr]1, 3)) { throw 'Could not turn animations on' }",
  ].join('\n')
  // Encoded, so the script's quotes survive Windows' command line.
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {stdio: 'inherit'})
}
if (process.platform === 'win32' && process.env.RUNNER_ENVIRONMENT === 'github-hosted') desktopDisplay()

const extension = fileURLToPath(new URL('../../', import.meta.url))
const cli =
  process.env.PROJECTIONS_CLI ??
  fileURLToPath(new URL(`../../../../cli/dist/projections${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
const repository = await createDemoRepository(cli)
// A definition that uses the removed module comparator, uncommitted beside the valid one: it must fail alone.
await writeFile(
  join(repository, '.github', 'projections', 'legacy.json'),
  `${JSON.stringify({id: 'legacy', title: 'Legacy', extractor: 'workspace-dependencies', renderer: 'graph', comparator: {module: 'dist/order.wasm'}}, null, 2)}\n`,
)
// Schemas are never downloaded: validation must come from the extension's bundled schemas.
const user = await mkdtemp(join(tmpdir(), 'projections-vscode-user-'))
await mkdir(join(user, 'User'), {recursive: true})
await writeFile(join(user, 'User', 'settings.json'), JSON.stringify({'json.schemaDownload.enable': false}))
await runTests({
  version: process.env.VSCODE_VERSION ?? 'stable',
  cachePath: join(extension, '.vscode-test'),
  extensionDevelopmentPath: extension,
  extensionTestsPath: fileURLToPath(new URL('./suite.cjs', import.meta.url)),
  // Chromium treats a window another covers (or one that opened behind the active app) as hidden: its pages never
  // paint and their timers run once a minute, so the tab's first paint and its title bar commands would time out.
  launchArgs: [
    repository,
    '--disable-extensions',
    '--user-data-dir',
    user,
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
  extensionTestsEnv: {PROJECTIONS_CLI: cli},
})
