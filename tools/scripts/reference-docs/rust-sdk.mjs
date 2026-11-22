// The Rust SDK references, from rustdoc JSON with the pinned nightly.
import {spawnSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {apiPage, firstParagraph} from './api.mjs'
import {extract, fail, nightly, outDir, root, run, to} from './shared.mjs'

export async function rustApi() {
  const check = spawnSync('rustup', ['run', nightly, 'rustc', '--version'], {cwd: root, encoding: 'utf8'})
  if (check.status !== 0) {
    fail(
      `The Rust SDK references read rustdoc JSON, which needs ${nightly}. Install it with:\n  rustup toolchain install ${nightly} --profile minimal`,
    )
  }
  const readme = await readFile(join(root, 'packages/extractors/rust-public-api/README.md'), 'utf8')
  if (!readme.includes(nightly)) {
    fail(`packages/extractors/rust-public-api/README.md no longer uses ${nightly}; update the pin here to match`)
  }
  const crates = [
    {name: 'projections-extractor-sdk', page: 'extractor-sdk', title: 'Extractor SDK API', guide: to('packages/extractors/sdk/README.md')},
  ]
  const pages = {}
  for (const crate of crates) {
    run('cargo', [
      `+${nightly}`,
      'rustdoc',
      '--quiet',
      '--locked',
      '-p',
      crate.name,
      '--lib',
      '--',
      '-Z',
      'unstable-options',
      '--output-format',
      'json',
    ])
    const file = `target/doc/${crate.name.replace(/-/g, '_')}.json`
    const rustdoc = JSON.parse(await readFile(join(root, file), 'utf8'))
    // Importing a generated rustdoc JSON file runs nothing, so it needs no trust.
    const extraction = extract('rust-public-api', {rustdocJson: file})
    const docs = new Map()
    for (const item of Object.values(rustdoc.index)) {
      if (item.docs && item.span && item.crate_id === 0) docs.set(`${item.span.filename}:${item.span.begin[0]}`, item.docs)
    }
    const crateDocs = rustdoc.index[rustdoc.root]?.docs
    const skip = entity => entity.kind === 'impl' || entity.kind === 'crate'
    pages[`${outDir}/${crate.page}.md`] = apiPage({
      outro: crate.outro,
      title: crate.title,
      intro: `The public API of the \`${crate.name}\` crate. Read with the \`rust-public-api\` extractor from rustdoc's
JSON output (${nightly}), the same way it shows your crates' APIs; descriptions are the sources' documentation
comments. Start with [the guide](${crate.guide}).${crateDocs ? `\n\n> ${firstParagraph(crateDocs)}` : ''}`,
      sources: [`${dirname(rustdoc.index[rustdoc.root].span.filename)}`, 'via rust-public-api'],
      extraction,
      docs,
      language: 'rust',
      name: entity => entity.id.replace(/^rust:[^:]+::/, ''),
      group: entity => {
        if (skip(entity)) return undefined
        const kinds = {
          struct: 'Types',
          enum: 'Types',
          union: 'Types',
          type: 'Types',
          trait: 'Traits',
          function: 'Functions',
          constant: 'Constants',
          static: 'Constants',
          macro: 'Macros',
        }
        return kinds[entity.kind] ?? 'Other items'
      },
      skip,
    })
  }
  return pages
}
