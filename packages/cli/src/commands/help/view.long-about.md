Serves one page on loopback (127.0.0.1) that shows a projection for a coding
agent to drive and a person to watch: the stage with its comparison modes,
playback, zoom and settings, a one-line header saying what is compared, and a
status line. The person can switch the page to another of the repository's
projections from its title; otherwise there is no editing, and the page names no
files; errors reach the agent in full. The URL carries a random session token;
requests without it are refused, and the bare port says only how to get the
link. The token and port are kept per project in the user cache, so a viewer
that restarts has the same URL; view stop --rotate forgets them. It prints the
URL (--open also opens the default browser) and keeps serving until interrupted.
The page follows the working tree: editing a definition or the files it reads
extracts and replays again. Agents drive it with the open_projection,
current_view, screenshot and refresh tools (projections mcp) or the subcommands
below, which find the running viewer through a per-repository record in the user
cache. --viewer NAME shows a named viewer: its own page and URL, independent of
the default one, so several projections can be shown side by side. --theme SEED
colors the page as the app showing it in its own browser pane (a custom agent
harness; the GitHub Copilot app and VS Code theme it themselves): a built-in
seed's name (claude, for Claude Code's Preview pane; chatgpt, for the ChatGPT
and Codex apps), or a theme seed, inline JSON or a JSON file, {"light": {...},
"dark": {...}}, each mode a background and optionally text, muted, border,
accent, focus, sans and mono. It is checked, and goes only in the printed link,
as ?theme=.
