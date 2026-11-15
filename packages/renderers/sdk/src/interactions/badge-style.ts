// The annotation badges' stylesheet, scoped to one controller's overlay.

export const badgeStyle = (scope: string) => `
.${scope} { position: fixed; left: 0; top: 0; width: 0; height: 0; overflow: visible; z-index: 2147483001; pointer-events: none; }
.${scope} > button {
  position: fixed; left: 0; top: 0; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
  min-width: var(--projections-label-height, 20px); height: var(--projections-label-height, 20px); margin: 0;
  padding: 0 calc(var(--projections-label-padding-x, 7px) - 1px);
  border: var(--projections-border-width, 1px) solid var(--projections-color-border, #d1d9e0); border-radius: var(--projections-label-radius, 9999px);
  background: var(--projections-color-bg-subtle, #f6f8fa); color: var(--projections-color-fg-muted, #59636e);
  box-shadow: var(--projections-shadow-sm, none);
  font-family: var(--projections-font-family, system-ui, sans-serif); font-size: var(--projections-label-font-size, 12px);
  font-weight: var(--projections-font-weight-semibold, 600); line-height: 1; font-variant-numeric: tabular-nums; white-space: nowrap;
  cursor: pointer; pointer-events: auto; user-select: none; -webkit-user-select: none;
}
/* Tones never use change colors, so markers don't read as added, removed, modified or moved. */
.${scope} > button[data-tone="attention"] {
  border-color: var(--projections-color-bg, #ffffff); background: var(--projections-color-accent-emphasis, #0969da); color: var(--projections-color-fg-on-emphasis, #ffffff);
}
.${scope} > button[data-tone="done"] { border-color: transparent; }
.${scope} > button[data-tone="subtle"] { border-style: dashed; background: var(--projections-color-bg, #ffffff); }
.${scope} > button[data-dot]::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.${scope} > button:hover { filter: brightness(1.1); }
.${scope} > button:focus { outline: none; }
.${scope} > button:focus-visible {
  outline: var(--projections-focus-ring-width, 2px) solid var(--projections-color-focus, #0969da);
  outline-offset: var(--projections-focus-ring-offset, 2px);
}
.${scope} > button[hidden] { display: none; }
@media (forced-colors: active) { .${scope} > button { border-color: ButtonText; forced-color-adjust: none; background: Highlight; color: HighlightText; } }
`
