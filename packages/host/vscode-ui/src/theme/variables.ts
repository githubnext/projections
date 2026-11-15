import type {ThemeTokenName} from '@githubnext/projections-host'

/**
 * The VS Code variables each renderer theme token is read from, first match wins. Colors then keep the contrast the
 * token set promises (`vscodeThemeTokens`): text tokens 4.5:1 against the surfaces (7:1 for `color-fg` in high
 * contrast themes), edges, the divider and focus 3:1, and fills drawn behind text keep that text readable; where a
 * theme's own color already has the contrast it is sent unchanged. Tokens VS Code has no variable for (`chart-*`,
 * spacing, control heights) keep the token set's defaults for the theme's color mode; `icon-*` are codicons.
 */
export const vscodeTokenMap: Readonly<Partial<Record<ThemeTokenName, readonly `--vscode-${string}`[]>>> = {
  'color-fg': ['--vscode-editor-foreground', '--vscode-foreground'],
  'color-fg-muted': ['--vscode-descriptionForeground'],
  'color-fg-subtle': ['--vscode-disabledForeground'],
  'color-fg-on-emphasis': ['--vscode-editor-background'],
  'color-bg': ['--vscode-editor-background'],
  'color-bg-subtle': ['--vscode-sideBar-background'],
  'color-bg-inset': ['--vscode-sideBar-background'],
  'color-bg-overlay': ['--vscode-editorHoverWidget-background', '--vscode-editorWidget-background'],
  'color-border': ['--vscode-contrastBorder', '--vscode-panel-border', '--vscode-widget-border'],
  'color-border-muted': ['--vscode-contrastBorder', '--vscode-panel-border', '--vscode-widget-border'],
  'color-border-emphasis': ['--vscode-contrastBorder', '--vscode-input-border', '--vscode-checkbox-border'],
  'color-surface-canvas': ['--vscode-editor-background'],
  'color-surface-raised': ['--vscode-editorWidget-background'],
  'color-surface-header': ['--vscode-sideBarSectionHeader-background', '--vscode-editorGroupHeader-tabsBackground'],
  'color-surface-inset': ['--vscode-sideBar-background'],
  'color-divider': ['--vscode-contrastBorder', '--vscode-editorWidget-border', '--vscode-widget-border'],
  'color-accent': ['--vscode-textLink-foreground'],
  'color-accent-muted': ['--vscode-list-inactiveSelectionBackground', '--vscode-list-hoverBackground'],
  'color-accent-emphasis': ['--vscode-textLink-foreground'],
  'color-focus': ['--vscode-focusBorder'],
  'color-added': ['--vscode-gitDecoration-addedResourceForeground'],
  'color-added-muted': ['--vscode-diffEditor-insertedLineBackground'],
  'color-added-emphasis': ['--vscode-gitDecoration-addedResourceForeground'],
  'color-added-border': ['--vscode-diffEditor-insertedTextBorder', '--vscode-editorGutter-addedBackground'],
  'color-added-highlight': ['--vscode-diffEditor-insertedTextBackground'],
  'color-removed': ['--vscode-gitDecoration-deletedResourceForeground'],
  'color-removed-muted': ['--vscode-diffEditor-removedLineBackground'],
  'color-removed-emphasis': ['--vscode-gitDecoration-deletedResourceForeground'],
  'color-removed-border': ['--vscode-diffEditor-removedTextBorder', '--vscode-editorGutter-deletedBackground'],
  'color-removed-highlight': ['--vscode-diffEditor-removedTextBackground'],
  'color-modified': ['--vscode-gitDecoration-modifiedResourceForeground'],
  'color-modified-emphasis': ['--vscode-gitDecoration-modifiedResourceForeground'],
  'color-modified-border': ['--vscode-gitDecoration-modifiedResourceForeground'],
  'color-moved': ['--vscode-charts-purple'],
  'color-moved-emphasis': ['--vscode-charts-purple'],
  'color-moved-border': ['--vscode-charts-purple'],
  'color-highlight': ['--vscode-editor-selectionHighlightBackground', '--vscode-list-hoverBackground'],
  'font-family': ['--vscode-font-family'],
  'font-family-mono': ['--vscode-editor-font-family'],
  'font-size-xs': ['--vscode-bodyFontSize-xSmall'],
  'font-size-sm': ['--vscode-bodyFontSize-small'],
  'font-size': ['--vscode-font-size'],
  'font-size-xl': ['--vscode-fontSize-heading2'],
  'font-weight-semibold': ['--vscode-fontWeight-semiBold'],
  'font-weight-bold': ['--vscode-fontWeight-semiBold'],
  'radius-sm': ['--vscode-cornerRadius-xSmall'],
  radius: ['--vscode-cornerRadius-small'],
  'radius-lg': ['--vscode-cornerRadius-medium'],
  'radius-full': ['--vscode-cornerRadius-circle'],
  'border-width': ['--vscode-strokeThickness'],
  'shadow-sm': ['--vscode-widget-shadow'],
  'shadow-md': ['--vscode-widget-shadow'],
  'shadow-lg': ['--vscode-widget-shadow'],
  'label-font-size': ['--vscode-bodyFontSize-xSmall'],
}

/** Every VS Code variable the token mapping reads. */
export const vscodeVariableNames: readonly string[] = [
  ...new Set([...Object.values(vscodeTokenMap).flat(), '--vscode-foreground', '--vscode-button-foreground']),
]

/** VS Code's sizes for what its variables don't carry: a 22px row, a 26px button, a 16px codicon; outlines are 1px. */
export const vscodeMetrics: Partial<Record<ThemeTokenName, string>> = {
  'font-size-xs': '11px',
  'font-size-sm': '12px',
  'font-size': '13px',
  'font-size-lg': '14px',
  'font-size-xl': '18px',
  'font-weight-normal': '400',
  'font-weight-medium': '600',
  'font-weight-semibold': '600',
  'font-weight-bold': '600',
  'line-height-tight': '1.2',
  'line-height': '1.4',
  'line-height-relaxed': '1.6',
  'radius-sm': '2px',
  radius: '4px',
  'radius-lg': '6px',
  'radius-full': '9999px',
  'border-width': '1px',
  'border-width-thick': '2px',
  'control-height-sm': '22px',
  'control-height': '26px',
  'control-height-lg': '28px',
  'focus-ring-width': '1px',
  'focus-ring-offset': '1px',
  'label-font-size': '11px',
  'label-font-weight': '400',
  'label-height': '18px',
  'label-padding-x': '6px',
  'label-radius': '11px',
}

export const fallbackFonts = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", "Ubuntu", "Droid Sans", sans-serif',
  mono: 'Menlo, Monaco, Consolas, "Droid Sans Mono", "Courier New", monospace',
}
