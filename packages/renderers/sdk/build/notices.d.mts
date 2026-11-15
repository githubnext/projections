/**
 * Third-party license notices for browser bundles, derived from the modules a
 * bundle actually contains. Node-only (outside `src`, which stays
 * browser-portable): renderer builds (`./vite`) and hosts that serve renderer
 * bundles use it at build time.
 */
/** One npm package found among a bundle's inputs. */
export interface BundledPackage {
  /** The package name from its `package.json` (or a vendored directory's `vendor.json`). */
  name: string
  /** The installed version, so two versions of one package get a notice each. */
  version: string
  /** SPDX expression from its `package.json`. */
  license: string
  /** The directory the package is installed in, as the module IDs locate it; its license files are read from here. */
  directory: string
  /** The package's files the bundle includes. */
  files: string[]
}
/**
 * The npm packages among a bundle's module IDs (as Rollup or esbuild report
 * them, with or without plugin prefixes and queries), except this
 * repository's own `@githubnext/*` packages, in name order.
 */
export declare function bundledPackages(moduleIds: Iterable<string>): BundledPackage[]
/**
 * The notice for one bundled package: its license files, every copyright
 * line in the files the bundle includes and, for licenses that require it
 * (EPL, MPL, (L)GPL and similar), where its source is. Throws when the
 * package declares no license, so a bundle never ships unattributed code.
 */
export declare function packageNotice(entry: BundledPackage): string
/** A notices file for a bundle built from `moduleIds`, introduced by `title`. */
export declare function bundleNotices(title: string, moduleIds: Iterable<string>): string
/** Sections of a notices file, keyed by their `===== name version (license) =====` heading. */
export declare function noticeSections(text: string): Map<string, string>
/** Merges notices files into one, each package version once, in heading order. */
export declare function mergeNotices(title: string, texts: Iterable<string>, exclude?: ReadonlySet<string>): string
