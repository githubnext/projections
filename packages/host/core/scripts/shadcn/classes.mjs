// Prefixing a component's Tailwind classes with `pj:` and renaming its theme variables to `--pj-*`.
import ts from 'typescript'
import {applyEdits, parse} from './source.mjs'

/** Rewrites one Tailwind class list: `pj:` before every class except shadcn's `cn-*` hooks, `--x` → `--pj-x` (as in
 * the variables a `style` prop sets). */
export function prefixClasses(classes) {
  return classes.replaceAll(/\S+/gu, token => (token.startsWith('cn-') ? token : `pj:${renameVariables(token)}`))
}

// Theme and component variables are renamed; Radix's own (`--radix-*`) and Tailwind functions (`--spacing(4)`) are not.
function renameVariables(token) {
  return token.replaceAll(/--(?!pj-|radix-|tw-)([a-zA-Z][\w-]*)(?![\w(-])/gu, '--pj-$1')
}

const isCall = (node, name) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name
const isStringLike = node => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
const propertyName = property => (property.name && 'text' in property.name ? property.name.text : undefined)

function eachProperty(object, visit) {
  if (!object || !ts.isObjectLiteralExpression(object)) return
  for (const property of object.properties) if (ts.isPropertyAssignment(property)) visit(property)
}

// Class lists are the strings in `className` attributes, in `cn(…)` arguments and in `cva(base, {variants,
// compoundVariants})`; variant names (`defaultVariants`, compound variant keys) are left alone.
function collectClassStrings(sourceFile) {
  const found = []
  const classValue = node => {
    if (!node) return
    if (isStringLike(node)) found.push(node)
    else if (ts.isParenthesizedExpression(node)) classValue(node.expression)
    else if (ts.isConditionalExpression(node)) [node.whenTrue, node.whenFalse].forEach(classValue)
    else if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) classValue(node.right)
      else if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
        ;[node.left, node.right].forEach(classValue)
      }
    } else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(classValue)
    else if (ts.isTemplateExpression(node)) found.push(node.head, ...node.templateSpans.map(span => span.literal))
  }
  const cva = call => {
    classValue(call.arguments[0])
    eachProperty(call.arguments[1], option => {
      if (propertyName(option) === 'variants') {
        eachProperty(option.initializer, variant => eachProperty(variant.initializer, value => classValue(value.initializer)))
      }
      if (propertyName(option) === 'compoundVariants' && ts.isArrayLiteralExpression(option.initializer)) {
        for (const compound of option.initializer.elements) {
          eachProperty(compound, field => ['className', 'class'].includes(propertyName(field)) && classValue(field.initializer))
        }
      }
    })
  }
  const visit = node => {
    if (isCall(node, 'cn')) node.arguments.forEach(classValue)
    else if (isCall(node, 'cva')) cva(node)
    else if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === 'className' && node.initializer) {
      const value = node.initializer
      classValue(ts.isJsxExpression(value) ? value.expression : value)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

// The variables a JSX `style={{'--gap': …}}` sets, so they match the `--pj-` names the classes read.
function styleVariables(sourceFile) {
  const found = []
  const visit = node => {
    if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === 'style') {
      const find = child => {
        if (ts.isPropertyAssignment(child) && isStringLike(child.name) && child.name.text.startsWith('--')) found.push(child.name)
        ts.forEachChild(child, find)
      }
      find(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

/** Prefixes every class list and renames every variable a `style` prop sets. */
export function prefixAll(text) {
  const sourceFile = parse(text)
  // Every literal opens with one character (a quote, backtick or `}`); template heads and middles close with `${`.
  const inner = node => [node.getStart(sourceFile) + 1, node.end - (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ? 2 : 1)]
  const edits = [
    ...collectClassStrings(sourceFile).map(node => {
      const [start, end] = inner(node)
      return {start, end, replacement: prefixClasses(text.slice(start, end))}
    }),
    ...styleVariables(sourceFile).map(node => {
      const [start, end] = inner(node)
      return {start, end, replacement: renameVariables(text.slice(start, end))}
    }),
  ]
  return applyEdits(text, edits)
}
