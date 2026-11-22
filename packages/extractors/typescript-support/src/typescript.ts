import path from 'node:path'
import type {Extraction, Json} from './types.js'
import type {ExtractorContext} from './shared.js'
import {selectTypeScript} from './compiler.js'
import {loadTypeScript, startDirectory} from './toolchain.js'
import {code, inputs} from './typescript/model.js'
import {projectFor} from './typescript/project.js'
import {publicApi} from './typescript/api.js'

/** Collect static TypeScript semantics without importing or executing repository code. */
export async function collectTypeScript(context: ExtractorContext): Promise<Extraction> {
  const collector = context.extractor
  if (collector !== 'typescript-public-api') {
    throw new Error(`Unsupported TypeScript extractor: ${code(collector)}`)
  }
  // The compiler comes from the directory owning the selected configuration, as the project's own build resolves it.
  const configured =
    inputs(context).tsconfig ?? (Array.isArray(inputs(context).tsconfigs) ? (inputs(context).tsconfigs as Json[])[0] : undefined)
  const start = startDirectory(context.toolchain, typeof configured === 'string' ? path.posix.dirname(configured) : undefined)
  selectTypeScript(loadTypeScript(context.toolchain, start, collector).ts)
  return publicApi(await projectFor(context))
}
