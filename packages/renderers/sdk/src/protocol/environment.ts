// The renderer environment a host's `init` and `environment` messages carry.
import {isIconValue} from '../icons.js'
import {rendererLimits} from './frame.js'
import {record, tokenNamePattern} from './validation.js'

type Fields = Record<string, unknown>

/** Whether a theme's tokens are well formed: known-length names and values, icons as icon values. */
const themeTokens = (tokens: Fields) =>
  Object.keys(tokens).length <= rendererLimits.themeTokens &&
  Object.entries(tokens).every(
    ([name, token]) =>
      tokenNamePattern.test(name) &&
      typeof token === 'string' &&
      (name.startsWith('icon-') ? isIconValue(token) : token.length <= rendererLimits.tokenLength),
  )

/** Whether a message carries a well-formed renderer environment: its theme, motion preference, locale, pane and sizing. */
export const environment = (input: Fields) =>
  record(input.theme) &&
  (input.theme.colorMode === 'light' || input.theme.colorMode === 'dark') &&
  record(input.theme.tokens) &&
  (input.theme.version === undefined || Number.isSafeInteger(input.theme.version)) &&
  themeTokens(input.theme.tokens) &&
  typeof input.reducedMotion === 'boolean' &&
  typeof input.locale === 'string' &&
  (input.pane === undefined || input.pane === 'before' || input.pane === 'after') &&
  (input.sizing === undefined || input.sizing === 'content' || input.sizing === 'fill')
