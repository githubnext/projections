// Small DOM helpers for the extension's plain pages (the Viewing control), themed from VS Code's
// variables.

/** An element with a class, attributes and children. */
export function el(
  tag: string,
  props: {[name: string]: string | boolean | undefined} = {},
  ...children: Array<Node | string | null | undefined>
): HTMLElement {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue
    if (name === 'class') element.className = String(value)
    else element.setAttribute(name, value === true ? '' : value)
  }
  for (const child of children) if (child !== null && child !== undefined) element.append(child)
  return element
}

export const icon = (name: string) => el('span', {class: `codicon codicon-${name}`, 'aria-hidden': 'true'})

/** A secondary button: an action that runs (Run checks, Sweep again). */
export function button(label: string, codicon: string, onClick: () => void, extra: {[name: string]: string} = {}) {
  const item = el('button', {...extra, type: 'button', class: `pv-button ${extra.class ?? ''}`}, icon(codicon), label)
  item.addEventListener('click', event => {
    event.stopPropagation()
    onClick()
  })
  return item
}

/**
 * A control that opens a quick pick or a file, as VS Code's own pickers are: a flat toolbar text button (an icon, the
 * label and a muted detail) with the toolbar's hover and a focus outline; no box and no chevron.
 */
export function flat(label: string, codicon: string, onClick: () => void, extra: {[name: string]: string} = {}, detail?: string) {
  const item = el(
    'button',
    {...extra, type: 'button', class: `pv-flat ${extra.class ?? ''}`},
    icon(codicon),
    label || null,
    detail ? el('span', {class: 'pv-muted'}, detail) : null,
  )
  item.addEventListener('click', event => {
    event.stopPropagation()
    onClick()
  })
  return item
}

/** The helpers' styles, added once. */
export const domStyle = `
.pv-button{flex:none;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border:1px solid var(--vscode-button-border,transparent);border-radius:2px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);font:inherit;cursor:pointer}
.pv-button:hover{background:var(--vscode-button-secondaryHoverBackground)}
.pv-flat{flex:none;display:inline-flex;align-items:center;gap:4px;min-width:0;height:22px;padding:0 6px;border:0;border-radius:5px;background:none;color:var(--vscode-foreground);font:inherit;cursor:pointer;white-space:nowrap}
.pv-flat:hover{background:var(--vscode-toolbar-hoverBackground)}
.pv-flat:active{background:var(--vscode-toolbar-activeBackground,var(--vscode-toolbar-hoverBackground))}
.pv-button:focus-visible,.pv-flat:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
.pv-muted{color:var(--vscode-descriptionForeground)}
.pv-icon-button{padding:0 3px}
`

let styled = false
export function addDomStyle(more = '') {
  const sheet = document.createElement('style')
  sheet.textContent = (styled ? '' : domStyle) + more
  styled = true
  document.head.append(sheet)
}
