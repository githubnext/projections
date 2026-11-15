/**
 * The license notices a browser bundle that includes React ships: Projections' own license, then React's, React DOM's
 * and Scheduler's (`browserNoticePackages`) as `importer` resolves them, then each `additional` file under its file
 * name. Rejects if a package or file can't be read.
 *
 * @param importer - The importing module's URL (`import.meta.url`), from which the React packages are resolved.
 * @param additional - Further license files to append, in order.
 * @returns The notices text, for a bundle's THIRD_PARTY_NOTICES.txt.
 */
export declare function browserNotices(importer: string, additional?: readonly URL[]): Promise<string>
/** The packages `browserNotices` always lists: pass them as `rendererNotices`' `exclude` so they appear once. */
export declare const browserNoticePackages: string[]
