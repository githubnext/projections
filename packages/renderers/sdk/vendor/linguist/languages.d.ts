// Types of the generated languages.js (see packages/renderers/sdk/scripts/linguist.mjs).

export type LinguistType = 'programming' | 'markup' | 'data' | 'prose'

/** [name, type, group, Linguist color, light-theme color, dark-theme color] */
export type LinguistRow = readonly [string, LinguistType, string | null, string | null, string | null, string | null]

export declare const release: string
export declare const languages: readonly LinguistRow[]
export declare const extensions: Readonly<Record<string, number>>
export declare const filenames: Readonly<Record<string, number>>
export declare const aliases: Readonly<Record<string, number>>
