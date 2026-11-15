import type {Extraction} from './types.js'
import type {ExtractorContext} from './shared.js'

export async function collectBuiltin(context: ExtractorContext): Promise<Extraction> {
  const extractor: string = context.extractor
  switch (extractor) {
    case 'typescript-public-api':
      return (await import('./typescript.js')).collectTypeScript(context)
    case 'nestjs-di':
      return (await import('./nestjs.js')).collectNest(context)
    default:
      throw new Error(`The Node extractor helper does not implement ${String(extractor)}`)
  }
}
