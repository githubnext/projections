// The manifest as published. The internal workspaces this package bundles are its devDependencies (so they build
// first, and only for that), and nothing published may name them. `npm publish` uploads package.json twice, in the
// tarball and as the version's registry metadata, so it must already be the published manifest on disk when publish
// starts: the release workflow runs `strip` in its throwaway checkout first. check-pack.mjs packs with it the same
// way and puts the original back, as does release-asset.mjs for the tarball each GitHub release attaches. `strip` also
// removes the README's front matter (its description, for this repository's tools), which npm would show as text.
//
//   node scripts/manifest.mjs strip    rewrite package.json and README.md as published
import {readFileSync, writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

export const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url))
export const readmePath = fileURLToPath(new URL('../README.md', import.meta.url))

/**
 * `npm pack`s the package as published into `destination`, then puts the manifest and README back. `npm(args, cwd)`
 * runs npm and returns its standard output. Returns `npm pack --json`'s entry for the tarball.
 */
export function packPublished(destination, npm) {
  const original = readFileSync(manifestPath, 'utf8')
  const readme = readFileSync(readmePath, 'utf8')
  try {
    writeFileSync(manifestPath, published(original))
    writeFileSync(readmePath, publishedReadme(readme))
    const [packed] = JSON.parse(npm(['pack', '--json', '--pack-destination', destination], fileURLToPath(new URL('..', import.meta.url))))
    return packed
  } finally {
    writeFileSync(manifestPath, original)
    writeFileSync(readmePath, readme)
  }
}

/** The published manifest for the manifest text `text`. */
export function published(text) {
  const manifest = JSON.parse(text)
  delete manifest.devDependencies
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/** The published README for the README text `text`: without front matter. */
export function publishedReadme(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/u, '')
}

// Run as a script, not imported.
if (import.meta.main) {
  const [action] = process.argv.slice(2)
  if (action !== 'strip') throw new Error('Expected strip')
  writeFileSync(manifestPath, published(readFileSync(manifestPath, 'utf8')))
  writeFileSync(readmePath, publishedReadme(readFileSync(readmePath, 'utf8')))
}
