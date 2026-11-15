/**
 * The license notices for the third-party code the default UI (`./ui`, `./ui/components`) bundles into a browser app:
 * shadcn/ui's, then each of the host package's runtime dependencies (`runtimeDependencies`). A package without a
 * license file gets a line naming its SPDX license. Append it to an app's THIRD_PARTY_NOTICES.txt.
 */
export declare function hostUiNotices(): Promise<string>
/**
 * Every runtime dependency reachable from the package whose manifest is at `manifestPath`, as `[name, manifest path]`
 * in name order: what a browser app bundling the package ships. React, React DOM, Scheduler and `@githubnext/`
 * packages are left out, and so is an optional dependency that isn't installed.
 *
 * @throws If a required dependency can't be resolved.
 */
export declare function runtimeDependencies(manifestPath: string): Promise<[name: string, manifestPath: string][]>
