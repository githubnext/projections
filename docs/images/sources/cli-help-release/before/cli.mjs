// The `ship` command line: prints its help.
console.log(`Usage: ship <command> [options]

Commands:
  build          Build the site into ./dist
  preview        Serve ./dist on localhost:8080
  publish        Upload ./dist to the bucket

Options:
  --out <dir>    Where to write the build (default: dist)
  --legacy       Build for browsers without ES modules
  -v, --verbose  Print every step
  -h, --help     Show this help`)
