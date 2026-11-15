#!/usr/bin/env node
// Writes the calibrated categorical palette (`chart-1` … `chart-16`, see calibration.mjs) into src/tokens.ts.
//
//   node scripts/palette.mjs [--profile softer|default|stronger]
//
// Build the SDK first: the backgrounds are the token set's own defaults. Regenerate the Linguist table
// (scripts/linguist.mjs) with the same profile.
import {readFileSync, writeFileSync} from 'node:fs'
import {chartPalette, profileArgument} from './calibration.mjs'
import {defaultThemeTokens} from '../dist/tokens.js'

const {profile} = profileArgument()
const backgrounds = {light: defaultThemeTokens('light')['color-bg'], dark: defaultThemeTokens('dark')['color-bg']}
const file = new URL('../src/tokens.ts', import.meta.url)
let text = readFileSync(file, 'utf8')
for (const [index, [light, dark]] of chartPalette(profile, backgrounds).entries()) {
  const pattern = new RegExp(`'chart-${index + 1}': \\['#[0-9a-f]{6}', '#[0-9a-f]{6}'\\]`)
  if (!pattern.test(text)) throw new Error(`chart-${index + 1} not found in tokens.ts`)
  text = text.replace(pattern, `'chart-${index + 1}': ['${light}', '${dark}']`)
}
writeFileSync(file, text)
