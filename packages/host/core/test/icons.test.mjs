import {test} from 'node:test'
import assert from 'node:assert/strict'
import {hostTheme, iconNames, iconToken, isIconValue} from '../dist/index.js'

test('the default host sends every renderer icon (Lucide) in both color modes, and keeps overrides', () => {
  for (const mode of ['light', 'dark']) {
    const theme = hostTheme(mode)
    for (const name of iconNames) assert.ok(isIconValue(theme.tokens[iconToken(name)]), `${name} in ${mode}`)
  }
  const custom = 'url("data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E")'
  assert.equal(hostTheme('light', {'icon-warning': custom}).tokens['icon-warning'], custom)
})
