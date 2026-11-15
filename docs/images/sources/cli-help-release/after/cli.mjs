// The `ship` command line: prints its help.
console.log(`Usage: ship <command> [options]

Commands:
  build          Build the site into ./dist
  preview        Serve ./dist on localhost:4173
  deploy         Upload ./dist and switch traffic to it
  rollback       Switch traffic back to the previous deploy

Options:
  --output <dir> Where to write the build (default: dist)
  -v, --verbose  Print every step
  -h, --help     Show this help`)
