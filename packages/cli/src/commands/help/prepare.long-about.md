Runs the prepare steps the repository's environment file
(.github/projections/environment.json) declares, such as npm ci, the way its CI
makes a checkout usable. In the working tree by default, where nothing ever runs
automatically (as with tests); with --revision, in the workspace Projections
keeps for that commit, which toolchain extractors use. Each step runs only when
its key files (typically lockfiles) changed since its last successful run there,
unless --force. Steps are repository code, so --trust is required; they may use
the network. Each has a timeout, stops on Ctrl+C, and writes a log, which a
failure names.
