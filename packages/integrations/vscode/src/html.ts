import type {WebviewConfig} from './protocol.js'

/**
 * The webview's content security policy. Nothing loads from the network: scripts are the extension's own resources
 * (or carry the page's nonce), the engine and comparator Workers and renderer documents are Blob URLs the page made
 * from those resources, and `connect-src` reaches only webview resources. Renderer documents are Blob URLs, so they
 * inherit this policy on top of their own; their inline scripts are given the nonce.
 */
export function contentSecurityPolicy(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${cspSource} 'wasm-unsafe-eval'`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `img-src ${cspSource} data: blob:`,
    `font-src ${cspSource} data:`,
    `media-src data: blob:`,
    `connect-src ${cspSource}`,
    'worker-src blob:',
    'frame-src blob:',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

/** A projection tab whose definition can't load (see `ProjectionFailure`), in the editor's own type and colors. */
const failureStyle =
  '.projection-failure{padding:16px 20px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground)}' +
  '.projection-failure h2{display:flex;align-items:center;gap:6px;margin:0 0 8px;font-size:1.15em;font-weight:600}' +
  '.projection-failure h2 .codicon{color:var(--vscode-errorForeground)}' +
  '.projection-failure ul{margin:0;padding-left:20px}.projection-failure li{margin:4px 0;line-height:1.5}' +
  '.projection-failure a{color:var(--vscode-textLink-foreground);font-family:var(--vscode-editor-font-family)}' +
  '.projection-failure p{color:var(--vscode-descriptionForeground)}'

/**
 * Before the Inspector panel's script runs: VS Code's thin progress bar at the top, shown only after 300 ms (as the Inspector's
 * loading state is), so the first paint is neither blank for long nor misleading. The script removes it.
 */
const bootStyle =
  '.pj-boot{position:fixed;top:0;left:0;right:0;height:2px;overflow:hidden;opacity:0;pointer-events:none;animation:pj-boot-show 0s linear 300ms forwards}' +
  '.pj-boot>div{position:absolute;top:0;bottom:0;width:30%;background:var(--vscode-progressBar-background,#0e70c0);animation:pj-boot-move 1.5s ease-in-out infinite}' +
  '@keyframes pj-boot-show{to{opacity:1}}@keyframes pj-boot-move{from{left:-30%}to{left:100%}}' +
  '@media (prefers-reduced-motion:reduce){.pj-boot>div{animation:none;left:0;width:100%;opacity:.5}}'

/**
 * A projection tab's skeleton, painted at once, before any script and while the backend starts: the real layout in VS
 * Code's own colors and the VS Code UI's dimensions, so nothing moves when the page replaces it. The toolbar strip
 * (35px, the active tab's surface, a hairline below), empty: no stand-ins for controls that can't be used yet; the
 * summary bar's strip (22px, the side bar's surface, a hairline above); and, centered
 * between them, a 16px spinning `loading` codicon and "Loading <title>…" in the description foreground. It sits over the
 * page (`position: fixed`, no pointer events): the page hides each part once its own is drawn, and removes it when the
 * projection has loaded (`webview/page-states.ts`). Still under reduced motion.
 */
const skeletonStyle =
  'body{background:var(--vscode-editor-background)}' +
  '.pj-skeleton{position:fixed;inset:0;z-index:5;display:flex;flex-direction:column;pointer-events:none;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size,13px);color:var(--vscode-descriptionForeground,#9d9d9d)}' +
  '.pj-skeleton-toolbar{box-sizing:border-box;flex:none;height:35px;border-bottom:1px solid var(--vscode-contrastBorder,var(--vscode-panel-border,#2b2b2b));background:var(--vscode-tab-activeBackground,var(--vscode-editor-background,#1f1f1f))}' +
  '.pj-skeleton-status{flex:1 1 auto;display:flex;align-items:center;justify-content:center;gap:8px;min-height:0}' +
  '.pj-skeleton-status .codicon{font-size:16px}' +
  '.pj-skeleton-bar{box-sizing:border-box;flex:none;height:22px;border-top:1px solid var(--vscode-contrastBorder,var(--vscode-panel-border,#2b2b2b));background:var(--vscode-sideBar-background,#181818)}' +
  '.pj-skeleton[data-toolbar] .pj-skeleton-toolbar,.pj-skeleton[data-bar] .pj-skeleton-bar,.pj-skeleton[data-status] .pj-skeleton-status{visibility:hidden}' +
  'body:has(.pj-skeleton-status) .phv-progress{display:none!important}' +
  '@media (prefers-reduced-motion:reduce){.pj-skeleton .codicon-modifier-spin{animation:none}}'

/** A projection tab's skeleton markup (see `skeletonStyle`). */
export function skeletonMarkup({title}: {title: string}): string {
  return (
    `<div class="pj-skeleton" data-skeleton aria-busy="true">` +
    `<div class="pj-skeleton-toolbar" aria-hidden="true"></div>` +
    `<div class="pj-skeleton-status" role="status" aria-live="polite"><span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" data-loading-indicator></span>` +
    `<span>Loading ${escape(title)}…</span></div>` +
    `<div class="pj-skeleton-bar" aria-hidden="true"></div></div>`
  )
}

/**
 * A projection tab's first document, set the moment its editor opens, before its folder's facts or the backend are
 * ready: the skeleton alone, with the codicon font, and no script. The full page (`webviewHtml`) follows with the same
 * skeleton, so the tab never shows blank.
 */
export function skeletonHtml({
  cspSource,
  nonce,
  title,
  codicons,
}: {
  cspSource: string
  nonce: string
  title: string
  codicons: string
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escape(contentSecurityPolicy(cspSource, nonce))}">
<link rel="stylesheet" href="${escape(codicons)}">
<style nonce="${nonce}">html,body{margin:0;padding:0;height:100%}${skeletonStyle}</style>
</head>
<body>${skeletonMarkup({title})}</body>
</html>`
}

function escape(text: string) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function webviewHtml({
  cspSource,
  config,
  styles,
  codicons,
  script,
}: {
  cspSource: string
  config: WebviewConfig
  /** The stylesheets: the Inspector bundle's `mount.css`, then the VS Code UI's `styles.css` and `inspector.css`. */
  styles: string | readonly string[]
  /** The codicon stylesheet, linked as `vscode-codicon-stylesheet` (VSCode Elements' icons read it); its font loads under `font-src`. */
  codicons?: string
  /** The webview page script (`dist/webview.js`). */
  script: string
}): string {
  // `<` is escaped so the JSON can't end its script element.
  const json = JSON.stringify(config).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escape(contentSecurityPolicy(cspSource, config.nonce))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Projections Inspector</title>
${(typeof styles === 'string' ? [styles] : styles).map(href => `<link rel="stylesheet" href="${escape(href)}">`).join('\n')}${codicons ? `\n<link id="vscode-codicon-stylesheet" rel="stylesheet" href="${escape(codicons)}">` : ''}
<style nonce="${config.nonce}">html,body{margin:0;padding:0;height:100%}#root>.pi{min-height:100vh}${failureStyle}${config.projection ? skeletonStyle : bootStyle}</style>
</head>
<body>
${
  config.projection
    ? `${config.failure ? '' : skeletonMarkup({title: config.title ?? config.projection})}<div id="root" data-host-ui="vscode"></div>`
    : `<div id="root" data-host-ui="vscode"><div class="pj-boot" role="progressbar" aria-label="Loading…" data-loading-indicator><div></div></div></div>`
}
<script type="application/json" id="projections-config">${json}</script>
<script type="module" nonce="${config.nonce}" src="${escape(script)}"></script>
</body>
</html>`
}
