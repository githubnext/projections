// Drives a real VS Code (the one @vscode/test-electron downloaded) with Playwright's Electron support, for the
// screenshots and for debugging the webview. `launch` opens a repository with this extension loaded.
import {_electron as electron} from 'playwright-core'
import {downloadAndUnzipVSCode} from '@vscode/test-electron'
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

export const extension = fileURLToPath(new URL('../../', import.meta.url))
export const cli = process.env.PROJECTIONS_CLI ?? fileURLToPath(new URL('../../../../cli/dist/projections', import.meta.url))

/** VS Code theme setting IDs and the workbench class of their kind. */
export const kinds = {light: 'vs', dark: 'vs-dark', 'hc-dark': 'hc-black', 'hc-light': 'hc-light'}

export async function launch({
  repository,
  theme = 'Default Dark Modern',
  kind = 'dark',
  width = 1440,
  height = 900,
  userSettings = {},
  keybindings = [],
}) {
  const executable = await downloadAndUnzipVSCode({
    version: process.env.VSCODE_VERSION ?? 'stable',
    cachePath: join(extension, '.vscode-test'),
  })
  const user = await mkdtemp(join(tmpdir(), 'projections-vscode-user-'))
  await mkdir(join(user, 'User'), {recursive: true})
  const settings = colorTheme => ({
    'workbench.colorTheme': colorTheme,
    'workbench.startupEditor': 'none',
    'workbench.tips.enabled': false,
    'window.restoreWindows': 'none',
    'security.workspace.trust.enabled': false,
    'chat.commandCenter.enabled': false,
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'update.mode': 'none',
    'telemetry.telemetryLevel': 'off',
    'window.zoomLevel': 0,
    ...userSettings,
  })
  // Keybindings pass commands their arguments, which the command palette can't.
  await writeFile(join(user, 'User', 'keybindings.json'), JSON.stringify(keybindings))
  const settingsFile = join(user, 'User', 'settings.json')
  await writeFile(settingsFile, JSON.stringify(settings('Default Dark Modern')))
  const app = await electron.launch({
    executablePath: executable,
    args: [
      repository,
      `--extensionDevelopmentPath=${extension}`,
      `--user-data-dir=${user}`,
      `--extensions-dir=${join(user, 'extensions')}`,
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--disable-gpu-sandbox',
      '--no-sandbox',
      `--window-size=${width},${height}`,
      // As in run.mjs: a covered window still paints, so its tab's notices and screenshots don't wait on it.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
    ],
    env: {...process.env, PROJECTIONS_CLI: cli},
  })
  const window = await app.firstWindow()
  await window.setViewportSize?.({width, height}).catch(() => {})
  await window.waitForSelector('.monaco-workbench', {timeout: 60_000})
  // A theme from an extension (Solarized, the high-contrast themes) applies once the extensions have registered it,
  // so it is set by editing the settings file VS Code watches.
  await new Promise(resolve => setTimeout(resolve, 1500))
  await writeFile(settingsFile, JSON.stringify(settings(theme)))
  await window.waitForFunction(expected => document.querySelector('.monaco-workbench')?.classList.contains(expected), kinds[kind], {
    timeout: 20_000,
  })
  await new Promise(resolve => setTimeout(resolve, 500))
  return {app, window}
}

/** Runs a command from the command palette. */
export async function command(window, title) {
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P')
  const input = window.locator('.quick-input-widget input')
  await input.waitFor()
  await input.fill(`>${title}`)
  await window.locator('.quick-input-list .monaco-list-row').first().waitFor()
  await window.keyboard.press('Enter')
}

/** Chooses a color theme by its label with Preferences: Color Theme (the setting alone isn't applied reliably at startup). */
export async function selectTheme(window, theme) {
  await command(window, 'Preferences: Color Theme')
  await window
    .locator('.quick-input-widget .quick-input-list .monaco-list-row[aria-label*="Theme" i], .quick-input-widget .monaco-list-row')
    .first()
    .waitFor()
  await new Promise(resolve => setTimeout(resolve, 300))
  await window.keyboard.type(theme)
  await window.locator('.quick-input-list .monaco-list-row', {hasText: theme}).first().waitFor()
  await new Promise(resolve => setTimeout(resolve, 300))
  await window.keyboard.press('Enter')
  await window.locator('.quick-input-widget').waitFor({state: 'hidden'})
}

/** The Inspector webview's content frame. */
export async function inspectorFrame(window, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const frame of window.frames()) {
      if (
        await frame
          .locator('#projections-config')
          .count()
          .catch(() => 0)
      ) {
        return frame
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('The Inspector webview did not load')
}
