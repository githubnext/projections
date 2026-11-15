import type {ComparisonMode, ControlIcon} from '@githubnext/projections-host'

/** Codicons for the icons renderers may request for action controls. */
export const vscodeControlIcons: Readonly<Record<ControlIcon, string>> = {
  'zoom-in': 'zoom-in',
  'zoom-out': 'zoom-out',
  fit: 'screen-normal',
  reset: 'discard',
  expand: 'unfold',
  collapse: 'fold',
  previous: 'chevron-left',
  next: 'chevron-right',
  download: 'cloud-download',
  filter: 'filter',
  search: 'search',
  settings: 'settings-gear',
}

/**
 * Each comparison mode's codicon. None is a playback glyph (no triangles, bars or play circles): animated is a video
 * camera, side by side VS Code's split editor, swipe a two-way arrow and diff the inline diff.
 */
export const modeCodicons: Readonly<Record<ComparisonMode, string>> = {
  animated: 'device-camera-video',
  'side-by-side': 'split-horizontal',
  swipe: 'arrow-both',
  diff: 'diff-single',
}

/** The codicons of the toolbar's own actions and views. */
export const uiCodicons = {
  renderer: 'graph',
  table: 'table',
  text: 'note',
  filter: 'filter',
  filterActive: 'filter-filled',
  settings: 'settings-gear',
  info: 'info',
  more: 'ellipsis',
  fullscreen: 'screen-full',
  exitFullscreen: 'screen-normal',
  play: 'play',
  playBackward: 'debug-reverse-continue',
  pause: 'debug-pause',
  previousStep: 'debug-step-back',
  nextStep: 'debug-step-over',
  swap: 'arrow-swap',
  close: 'close',
  dropdown: 'chevron-down',
  verified: 'workspace-trusted',
  search: 'search',
  loading: 'loading',
  annotation: 'comment',
  varied: 'pulse',
  generated: 'sparkle',
} as const
