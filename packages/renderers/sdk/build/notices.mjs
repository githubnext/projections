import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join} from 'node:path'

/*
 * Third-party license notices for browser bundles, derived from the modules a
 * bundle actually contains. Node-only (outside `src`, which stays
 * browser-portable): renderer builds (`./vite`) and hosts that serve renderer
 * bundles use it at build time.
 */

const packageRoot = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/
// Third-party data vendored into this repository: `vendor/<name>/` with a `vendor.json` ({name, version, license}) and
// the upstream license file.
const vendorRoot = /^(.*[\\/]vendor[\\/][^\\/]+)[\\/]/
const licenseFile = /^(licen[cs]e|copying|notice)([-_.].*)?$/i
// Licenses whose binary-form distribution must say where the source is.
const sourceRequired = /\b(EPL|MPL|LGPL|GPL|CDDL|EUPL|CPL)\b/

/**
 * The npm packages among a bundle's module IDs (as Rollup or esbuild report
 * them, with or without plugin prefixes and queries), except this
 * repository's own `@githubnext/*` packages, and third-party data vendored
 * into it (a `vendor/<name>/` directory with a `vendor.json`), in name order.
 *
 * @param {Iterable<string>} moduleIds
 * @returns {import('./notices.d.mts').BundledPackage[]}
 */
export function bundledPackages(moduleIds) {
  const found = new Map()
  for (const id of moduleIds) {
    const file = id.replace(/^\0/, '').replace(/\?.*$/, '')
    const match = packageRoot.exec(file)
    // Vendored data is attributed wherever it is, including inside an installed package (`@githubnext/projections`
    // ships the SDK's `vendor/linguist` beside its bundles).
    const vendored = vendorRoot.exec(file)
    if (vendored && (!match || vendored[1].length > match[1].length) && existsSync(join(vendored[1], 'vendor.json'))) {
      const directory = vendored[1]
      if (!found.has(directory)) {
        const manifest = JSON.parse(readFileSync(join(directory, 'vendor.json'), 'utf8'))
        found.set(directory, {name: manifest.name, version: manifest.version, license: manifest.license ?? '', directory, files: []})
      }
      continue
    }
    if (!match || !existsSync(join(match[1], 'package.json'))) continue
    const directory = match[1]
    let entry = found.get(directory)
    if (!entry) {
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      if (manifest.name.startsWith('@githubnext/')) continue
      entry = {
        name: manifest.name,
        version: manifest.version,
        license: typeof manifest.license === 'string' ? manifest.license : '',
        directory,
        files: [],
      }
      found.set(directory, entry)
    }
    if (existsSync(file) && !entry.files.includes(file)) entry.files.push(file)
  }
  return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1))
}

/** @param {readonly string[]} files */
function copyrights(files) {
  const lines = new Set()
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/Copyright\s+(?:\(c\)|©)[^\n]*/gi)) {
      lines.add(match[0].replace(/[\s*/]+$/, '').trim())
    }
  }
  return [...lines].sort()
}

/** @param {string} directory @returns {string[]} */
function scripts(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap(file =>
    file.isDirectory() && file.name !== 'node_modules'
      ? scripts(join(directory, file.name))
      : file.isFile() && /\.[cm]?js$/.test(file.name)
        ? [join(directory, file.name)]
        : [],
  )
}

/** @param {string} directory */
function repository(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const url = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
  return url
    ?.replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
}

/**
 * The notice for one bundled package: its license files, every copyright
 * line in the files the bundle includes and, for licenses that require it
 * (EPL, MPL, (L)GPL and similar), where its unmodified source is. Throws when
 * the package declares no license, so a bundle never ships unattributed code.
 *
 * @param {import('./notices.d.mts').BundledPackage} entry
 */
export function packageNotice(entry) {
  const licenses = readdirSync(entry.directory)
    .filter(name => licenseFile.test(name) && statSync(join(entry.directory, name)).isFile())
    .sort()
  if (!licenses.length && !entry.license)
    throw new Error(`Bundled package ${entry.name}@${entry.version} has no license file or license field`)
  const lines = [`===== ${entry.name} ${entry.version} (${entry.license || 'see license file'}) =====`]
  const copyleft = sourceRequired.test(entry.license)
  if (copyleft) {
    const source = repository(entry.directory)
    if (!source) throw new Error(`Bundled package ${entry.name}@${entry.version} (${entry.license}) declares no repository for its source`)
    const elected = entry.license.split(/\s+OR\s+/)[0].replace(/[()]/g, '')
    lines.push(`Distributed under ${elected}. Source: ${source}/tree/${entry.version}, unmodified.`)
  }
  // Copyleft packages are attributed from every script they publish, not just those bundled.
  lines.push(...copyrights(copyleft ? [...new Set([...entry.files, ...scripts(entry.directory)])] : entry.files))
  if (!licenses.length) lines.push(`Licensed under ${entry.license} (declared in its package.json; the package ships no license file).`)
  for (const name of licenses) lines.push(`--- ${name} ---`, readFileSync(join(entry.directory, name), 'utf8').trimEnd())
  return `${lines.join('\n')}\n`
}

/**
 * A notices file for a bundle built from `moduleIds`, introduced by `title`.
 *
 * @param {string} title
 * @param {Iterable<string>} moduleIds
 */
export function bundleNotices(title, moduleIds) {
  const packages = bundledPackages(moduleIds)
  return `${title}\n\n${packages.length ? packages.map(packageNotice).join('\n') : 'This bundle includes no third-party packages.\n'}`
}

/**
 * Sections of a notices file, keyed by their `===== name version (license) =====` heading.
 *
 * @param {string} text
 */
export function noticeSections(text) {
  const sections = new Map()
  const headings = [...text.matchAll(/^===== .+ =====$/gm)]
  for (const [index, heading] of headings.entries()) {
    sections.set(heading[0], text.slice(heading.index, headings[index + 1]?.index ?? text.length).trimEnd())
  }
  return sections
}

/**
 * Merges notices files into one, each package version once, in heading order.
 * `exclude` names packages the including app lists already.
 *
 * @param {string} title
 * @param {Iterable<string>} texts
 * @param {ReadonlySet<string>} [exclude]
 */
export function mergeNotices(title, texts, exclude = new Set()) {
  const sections = new Map()
  for (const text of texts)
    for (const [heading, section] of noticeSections(text)) {
      if (!exclude.has(heading.slice(6).split(' ')[0])) sections.set(heading, section)
    }
  return `${title}\n\n${[...sections]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, section]) => section)
    .join('\n\n')}\n`
}
