// The theme tokens reference, from the renderer SDK's tokens and icons.
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {code, fail, header, outDir, requireBuilt, root, table} from './shared.mjs'

export async function tokens() {
  const module = await import(await requireBuilt('packages/renderers/sdk/dist/tokens.js'))
  const source = await readFile(join(root, 'packages/renderers/sdk/src/tokens.ts'), 'utf8')
  const doc = /\/\*\*([\s\S]*?)\*\/\s*const definitions/u.exec(source)?.[1]
  if (!doc) fail('packages/renderers/sdk/src/tokens.ts: the token set has no documentation comment')
  const intro = doc
    .split('\n')
    .map(line => line.replace(/^\s*\* ?/u, ''))
    .join('\n')
    .trim()
  const iconSource = await readFile(join(root, 'packages/renderers/sdk/src/icons.ts'), 'utf8')
  const iconDoc = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export const iconNames/u.exec(iconSource)?.[1]
  const comment = text =>
    text
      .split('\n')
      .map(line => line.replace(/^\s*\* ?/u, ''))
      .join('\n')
      .trim()
  const light = module.defaultThemeTokens('light')
  const dark = module.defaultThemeTokens('dark')
  const groups = new Map()
  const icons = module.themeTokenNames.filter(name => name.startsWith('icon-'))
  if (icons.length && !iconDoc) fail('packages/renderers/sdk/src/icons.ts: the icon vocabulary has no documentation comment')
  for (const name of module.themeTokenNames) {
    if (name.startsWith('icon-')) continue
    const prefix = name.split('-')[0]
    if (!groups.has(prefix)) groups.set(prefix, [])
    groups.get(prefix).push(name)
  }
  const titles = {color: 'Colors', chart: 'Chart palette', font: 'Type', line: 'Line heights', space: 'Spacing', radius: 'Radii'}
  const swatch = value =>
    /^(?:#[0-9a-f]{3,8}|rgba?\([^)]*\))$/iu.test(value)
      ? `<span class="docs-swatch" style="background: ${value}"></span> ${code(value)}`
      : code(value)
  const page = `${header(['packages/renderers/sdk/src/tokens.ts', 'packages/renderers/sdk/src/icons.ts'])}# Theme tokens

Hosts send renderers a theme of design tokens; renderers style themselves with them, so a renderer matches whatever
host shows it. This is token set version ${code(module.themeTokenSetVersion)}: every token below is always defined
(\`resolveThemeTokens\` fills any a host omits with these defaults). CSS reads each as \`--projections-<name>\`.

${intro}

${[...groups]
  .map(
    ([prefix, names]) => `## ${titles[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1)}

${table(
  ['Token', 'Light', 'Dark'],
  names.map(name => [code(`--projections-${name}`), swatch(light[name]), swatch(dark[name])]),
)}`,
  )
  .join('\n\n')}
${
  icons.length
    ? `
## Icons

${comment(iconDoc)}

The defaults are the default UI's icons, drawn in the text color beside them. Light and dark are the same image.

${table(
  ['Token', 'Default'],
  icons.map(name => [
    code(`--projections-${name}`),
    light[name] === 'none'
      ? code('none')
      : `<span class="docs-icon" role="img" aria-label="${name.slice('icon-'.length)}" style="--docs-icon: ${light[name].replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></span>`,
  ]),
)}
`
    : ''
}`
  return {[`${outDir}/theme-tokens.md`]: page}
}
