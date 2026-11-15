Serves one page on loopback (127.0.0.1) that shows a projection for a coding
agent to drive and a person to watch: the stage with its comparison modes,
playback, zoom and settings, a one-line header saying what is compared, and a
status line. There is no editing, and the page names no files; errors reach the
agent in full. The URL carries a random session token; requests without it are
refused. It prints the URL (--open also opens the default browser) and keeps
serving until interrupted. The page follows the working tree: editing a
definition or the files it reads extracts and replays again. Agents drive it
with the open_projection, current_view, screenshot and refresh tools
(projections mcp) or the subcommands below, which find the running viewer
through a per-repository record in the user cache.
