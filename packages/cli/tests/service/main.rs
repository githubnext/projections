//! The Inspector service in memory, as `serve --stdio`, `mcp` and headless
//! pages call it: its `/api/` routes, assets, jobs, sweeps and writes.

mod api;
mod authoring;
mod changes;
mod common;
mod fixtures;
mod history;
mod jobs;
mod renderers;
#[cfg(not(windows))]
mod saves;
