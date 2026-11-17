//! Where the documentation is read, and the agent prompt files bundled with the CLI.
//!
//! Links for people go to the repository's Markdown on GitHub: [`DOCS_BASE`] followed by a file's path from the
//! repository root. Repoint it here (and `DOCS_BASE` in the VS Code extension and `tools/scripts/reference-docs.mjs`)
//! when the repository moves.

/// The repository's files on GitHub; a documentation link is this followed by a path such as `docs/guides/comparators.md`.
#[macro_export]
macro_rules! docs_base {
    () => {
        "https://github.com/githubnext/projections/blob/main/"
    };
}

/// The repository's files on GitHub, for documentation links.
pub const DOCS_BASE: &str = docs_base!();

/// The agent prompt files (`docs/agents/*.md`), as `projections help agents NAME` prints them. Each guides a coding
/// agent through one task; they are generated from the setup pages by `tools/scripts/reference-docs.mjs`.
pub const AGENT_PROMPTS: &[(&str, &str, &str)] = &[
    (
        "explore",
        "find the projections that apply here, try them on recent pull requests and keep the useful ones",
        include_str!("../../../docs/agents/explore.md"),
    ),
    (
        "create-projection",
        "build a projection of something only this codebase has",
        include_str!("../../../docs/agents/create-projection.md"),
    ),
    (
        "ci",
        "add Projections to the repository's CI: read its workflows and propose where the step goes",
        include_str!("../../../docs/agents/ci.md"),
    ),
    (
        "install",
        "install the CLI (also on GitHub, for agents without it)",
        include_str!("../../../docs/agents/install.md"),
    ),
];

/// The agent prompt named `name`, without its generated-file comment.
pub fn agent_prompt(name: &str) -> Option<&'static str> {
    AGENT_PROMPTS
        .iter()
        .find(|(id, _, _)| *id == name)
        .map(|(_, _, text)| strip_generated(text))
}

fn strip_generated(text: &str) -> &str {
    match text.strip_prefix("<!--").and_then(|rest| rest.split_once("-->\n")) {
        Some((_, body)) => body.trim_start(),
        None => text,
    }
}

/// The list `projections help agents` prints.
pub fn agent_prompt_list() -> String {
    let width = AGENT_PROMPTS.iter().map(|(id, _, _)| id.len()).max().unwrap_or(0);
    let mut text = String::from("Prompts for a coding agent; `projections help agents NAME` prints one for the agent to follow:\n\n");
    for (id, summary, _) in AGENT_PROMPTS {
        text.push_str(&format!("  {id:width$}  {summary}\n"));
    }
    text.push_str(
        "\nThe skill `projections init` writes (projections/SKILL.md in the skills directory the repository uses, else .agents/skills, which GitHub Copilot, OpenAI Codex, Cursor and Gemini CLI read; `--claude` adds it to .claude/skills for Claude Code, `--skills-dir` chooses another directory and `--no-skill` writes none) holds `projections help authoring`.\n",
    );
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_prompt_is_bundled_and_points_at_no_website() {
        for (id, _, _) in AGENT_PROMPTS {
            let prompt = agent_prompt(id).unwrap();
            assert!(prompt.starts_with("# "), "{id}");
            assert!(!prompt.contains("githubnext.com/docs"), "{id} links the website");
        }
        assert!(agent_prompt("nope").is_none());
        assert!(agent_prompt_list().contains("create-projection"));
    }

    #[test]
    fn the_docs_base_is_a_github_tree() {
        assert!(DOCS_BASE.starts_with("https://github.com/") && DOCS_BASE.ends_with('/'));
    }
}
