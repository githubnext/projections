import type * as TypeScript from 'typescript'

let loaded: typeof TypeScript | undefined

/** Selects the repository's own compiler for every later `typescript` use in this helper. */
export function selectTypeScript(module: typeof TypeScript): void {
  loaded = module
}

/**
 * The helper bundle substitutes this module for `typescript`, so the extractor
 * source keeps typing against the compiler API while every call reaches the
 * examined repository's installation, loaded only once its location is known.
 */
const compiler = new Proxy({} as typeof TypeScript, {
  get(_target, key) {
    if (!loaded) throw new Error('The repository TypeScript compiler has not been loaded')
    return Reflect.get(loaded, key) as unknown
  },
})

export default compiler
