Serves Projections' agent tools to a coding agent (GitHub Copilot CLI, Claude
Code or any other MCP client) as a Model Context Protocol server over standard
input and output: JSON-RPC 2.0, one message per line. The tools list the
repository's projections, compare revisions through one, explore and sweep the
projections that apply, run checks and comparator tests, describe built-in
parts, and adopt, set a definition's parts and update comparator test snapshots.
Writes preview first: a call without confirm returns the preview and a confirm
token, and a second call with that token writes exactly what was previewed.
Repository code (custom extractors) runs, and writes outside an explore session
happen, only with --trust. In VS Code the Projections extension offers the same
tools to its agent itself, so it needs no MCP server. Standard output carries
only protocol messages; diagnostics go to standard error. It exits when standard
input closes or on a signal.
