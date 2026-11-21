import path from 'node:path'
import ts from 'typescript'
import {readSource, sourcePath, type ExtractorContext} from '../shared.js'
import {optionalString, sourceFile} from './model.js'

export interface RootModule {
  file: string
  name: string
  entry?: string
}

/** The one source file that calls `NestFactory`, `src/main.ts` by convention. */
async function bootstrapFile(context: ExtractorContext): Promise<string> {
  const conventional = context.files.includes('src/main.ts') ? ['src/main.ts'] : []
  const candidates = conventional.length
    ? conventional
    : (
        await Promise.all(
          context.files
            .filter(
              file =>
                sourceFile.test(file) &&
                !file.endsWith('.d.ts') &&
                !/(?:^|\/)node_modules\//.test(file) &&
                !/\.(?:spec|test|e2e-spec)\.[cm]?tsx?$/.test(file),
            )
            .map(async file => ((await readSource(context, file)).includes('NestFactory.') ? file : undefined)),
        )
      ).filter((file): file is string => file !== undefined)
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length
        ? `More than one bootstrap file calls NestFactory (${candidates.slice(0, 5).join(', ')}). Set inputs.entry to the application's main file, or inputs.module to "<file>#<module class>".`
        : 'No bootstrap file calling NestFactory was found (src/main.ts by convention). Set inputs.entry to the application\'s main file, or inputs.module to "<file>#<module class>".',
    )
  }
  return candidates[0]!
}

/** The first argument of the first `NestFactory.create*` call in `source`. */
function factoryArgument(source: ts.SourceFile): ts.Expression | undefined {
  let argument: ts.Expression | undefined
  const visit = (node: ts.Node): void => {
    if (argument) return
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'NestFactory' &&
      ['create', 'createApplicationContext', 'createMicroservice'].includes(node.expression.name.text)
    ) {
      argument = node.arguments[0]
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return argument
}

/** The root module named by `inputs.module` (`file#Export`), or found from the bootstrap file. */
export async function rootModule(context: ExtractorContext): Promise<RootModule> {
  const configured = optionalString(context, 'module')
  if (configured) {
    const separator = configured.lastIndexOf('#')
    if (separator <= 0 || separator === configured.length - 1) {
      throw new Error('inputs.module must be "<file>#<exported module class>", for example "src/app.module.ts#AppModule"')
    }
    return {file: await sourcePath(context, configured.slice(0, separator)), name: configured.slice(separator + 1)}
  }
  const entry = optionalString(context, 'entry') || (await bootstrapFile(context))
  const text = await readSource(context, entry)
  const source = ts.createSourceFile(entry, text, ts.ScriptTarget.Latest, true)
  const argument = factoryArgument(source)
  if (!argument || !ts.isIdentifier(argument)) {
    throw new Error(`${entry} does not pass a module class to NestFactory.create directly. Set inputs.module to "<file>#<module class>".`)
  }
  const local = argument.text
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    const element = bindings.elements.find(item => item.name.text === local)
    if (!element) continue
    const specifier = statement.moduleSpecifier.text
    if (!specifier.startsWith('.')) {
      throw new Error(`${entry} imports ${local} from the package ${specifier}. Set inputs.module to "<file>#<module class>".`)
    }
    const base = path.posix.join(path.posix.dirname(entry), specifier.replace(/\.[cm]?js$/, ''))
    const file = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base].find(candidate => context.files.includes(candidate))
    if (!file) throw new Error(`Cannot find the module ${specifier} that ${entry} imports ${local} from.`)
    return {file: await sourcePath(context, file), name: (element.propertyName ?? element.name).text, entry}
  }
  throw new Error(`${entry} passes ${local} to NestFactory, but does not import it by name. Set inputs.module to "<file>#<module class>".`)
}
