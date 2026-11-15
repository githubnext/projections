import type {Plugin} from 'vite'
/** The absolute path of every `scenarios.json` in `renderers/*` and `examples/renderers/*`, by package directory. */
export declare function scenarioFiles(): Promise<string[]>
/** The path Storybook serves a scenario's comparator file at: `comparators/<file name>`. */
export declare function comparatorAsset(path: string): string
/**
 * Reads every scenarios file into story fixtures.
 *
 * @returns `scenarios`, one fixture per scenario with `key` `<package directory>/<scenario id>`, its extractions
 *   inlined and its comparator file renamed to its served path (`comparatorAsset`); `files`, every file read, to
 *   watch; and `comparators`, each served comparator path to its file.
 * @throws If a file isn't a `projections.scenarios` v0 document, a file can't be read or parsed, or two different
 *   comparator files share a name.
 */
export declare function loadScenarios(): Promise<{scenarios: unknown[]; files: string[]; comparators: Map<string, string>}>
/**
 * The Vite plugin that serves `virtual:projections-scenarios` (the fixtures `loadScenarios` reads, as its default
 * export) to the stories and reloads them when a file it read changes.
 */
export declare function scenariosPlugin(): Plugin
