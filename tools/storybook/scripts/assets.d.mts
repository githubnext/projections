/**
 * The generated static directory (`static/`, with a trailing slash), served at the Storybook root (`staticDirs`), so
 * stories resolve `renderers/` and the rest from `iframe.html`.
 */
export declare const staticDirectory: string
/** The renderer packages whose built bundles the stories present: the built-in renderers and the minimal example. */
export declare const rendererPackages: string[]
/**
 * Empties and fills a Storybook static directory: the renderer bundles (`collectRenderers`), the brand mark and
 * favicon, the codicons, the misbehaving test renderers, the comparator runtime's Worker modules and the scenarios'
 * comparator files. The renderer packages must be built first.
 *
 * @param directory - The directory to fill, ending in a slash: `staticDirectory` by default, or another Storybook's
 *   built on these stories' helpers. Its existing contents are deleted.
 * @returns `directory`.
 * @throws If a renderer bundle or another asset is missing, or two scenario comparator files share a name.
 */
export declare function prepareStatic(directory?: string): Promise<string>
