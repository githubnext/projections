// Turns a shadcn/ui registry item (the JSON the registry serves for one component) into this directory's form: the
// mechanical local changes listed in ../../src/ui/components/README.md, applied deterministically so a vendored file
// can be three-way merged against two upstream releases (see ./update.mjs).
import {readFile} from 'node:fs/promises'
import {format} from 'oxfmt'
import ts from 'typescript'
import {prefixAll} from './classes.mjs'
import {addHeader, header} from './header.mjs'
import {applyEdits, parse} from './source.mjs'

const oxfmtConfig = new URL('../../../../../.oxfmtrc.json', import.meta.url)

const iconLibraries = new Set(['lucide', 'tabler', 'hugeicons', 'phosphor', 'remixicon'])
const kebab = name => name.replaceAll(/([a-z0-9])([A-Z])/gu, '$1-$2').toLowerCase()

// Replaces `<IconPlaceholder lucide="CheckIcon" tabler=… />` with `<CheckIcon />` (keeping its other attributes) and
// returns the lucide icons used.
function replaceIcons(text) {
  const sourceFile = parse(text)
  const icons = new Set()
  const edits = []
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === 'IconPlaceholder') {
      const attributes = node.attributes.properties
      const lucide = attributes.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === 'lucide')
      if (!lucide?.initializer || !ts.isStringLiteral(lucide.initializer)) {
        throw new Error(`IconPlaceholder without a lucide icon: ${node.getText(sourceFile)}`)
      }
      const icon = lucide.initializer.text
      icons.add(icon)
      const kept = attributes
        .filter(attribute => !(ts.isJsxAttribute(attribute) && iconLibraries.has(attribute.name.getText(sourceFile))))
        .map(attribute => attribute.getText(sourceFile))
      edits.push({start: node.getStart(sourceFile), end: node.end, replacement: `<${[icon, ...kept].join(' ')} />`})
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return {text: applyEdits(text, edits), icons: [...icons].toSorted()}
}

// Maps one upstream import to ours (none for the icon placeholder).
function rewriteImport(declaration, sourceFile) {
  const specifier = declaration.moduleSpecifier.text
  const bindings = declaration.importClause?.namedBindings
  const named = bindings && ts.isNamedImports(bindings) ? bindings.elements : []
  if (named.some(element => element.name.text === 'IconPlaceholder')) return []
  if (specifier === 'cn' || /(?:^|\/)lib\/utils$/u.test(specifier)) return [`import {cn} from '../lib/utils.js'`]
  if (specifier === 'radix-ui') {
    return named.map(element => {
      const primitive = (element.propertyName ?? element.name).text
      return `import * as ${element.name.text} from '@radix-ui/react-${kebab(primitive)}'`
    })
  }
  const sibling = /^@\/registry\/[\w-]+\/ui\/([\w-]+)$/u.exec(specifier)
  const text = declaration.getText(sourceFile)
  return [sibling ? text.replace(declaration.moduleSpecifier.getText(sourceFile), `'./${sibling[1]}.js'`) : text]
}

// Rewrites the import block as one group: React first (added if upstream relies on the global), then lucide icons,
// then the rest in upstream order.
function rewriteImports(text, icons) {
  const sourceFile = parse(text)
  const imports = sourceFile.statements.filter(ts.isImportDeclaration)
  if (imports.length === 0) return text
  const lines = imports.flatMap(declaration => rewriteImport(declaration, sourceFile))
  const isReact = line => /from ['"]react['"]$/u.test(line)
  if (!lines.some(isReact) && /\bReact\./u.test(text)) lines.unshift(`import * as React from 'react'`)
  if (icons.length) lines.splice(lines.findIndex(isReact) + 1, 0, `import {${icons.join(', ')}} from 'lucide-react'`)
  return text.slice(0, imports[0].getStart(sourceFile)) + lines.join('\n') + text.slice(imports.at(-1).end)
}

let formatOptions
async function formatted(text) {
  if (!formatOptions) {
    const {$schema, ignorePatterns, overrides, ...options} = JSON.parse(await readFile(oxfmtConfig, 'utf8'))
    formatOptions = options
  }
  const result = await format('component.tsx', text, formatOptions)
  if (result.errors.length) throw new Error(`oxfmt: ${result.errors.map(error => error.message).join('; ')}`)
  return result.code
}

/** The registry item's single source file. */
export function itemSource(item) {
  const files = item.files ?? []
  if (files.length !== 1 || typeof files[0].content !== 'string') {
    throw new Error(`${item.name}: expected one file with content, got ${files.length}`)
  }
  return files[0].content
}

/**
 * Transforms a registry item into this directory's form: `pj:` classes and `--pj-` variables, lucide icons,
 * individual @radix-ui packages, sibling `./x.js` imports and the attribution header, formatted with oxfmt.
 */
export async function transformItem(item, {style, version, notes = []}) {
  const icons = replaceIcons(prefixAll(itemSource(item)))
  const text = rewriteImports(icons.text, icons.icons)
  return formatted(addHeader(text, header({style, version, notes})))
}
