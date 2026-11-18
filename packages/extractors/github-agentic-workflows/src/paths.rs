//! Paths as gh-aw resolves them, over project-relative POSIX paths (`""` is
//! the project's root): imports in `pkg/parser/remote_path_predicates.go` and
//! runtime imports in `pkg/parser/frontmatter_hash.go`.

/// `path` with `.` and empty segments removed and `..` applied, as Go's
/// `filepath.Clean` does for a relative path; `""` for the root. A path that
/// climbs above the root keeps its leading `..` segments.
pub fn clean(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." if parts.last().is_some_and(|last| *last != "..") => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

pub fn join(base: &str, path: &str) -> String {
    clean(&format!("{base}/{path}"))
}

/// The directory holding `path`; the root's is the root.
pub fn dir(path: &str) -> String {
    path.rsplit_once('/').map(|(parent, _)| parent.to_owned()).unwrap_or_default()
}

/// Whether `path` is `base` or inside it.
pub fn within(base: &str, path: &str) -> bool {
    !path.starts_with("..") && (base.is_empty() || path == base || path.starts_with(&format!("{base}/")))
}

/// gh-aw's `findGitHubFolder`: the nearest directory at or above `base`
/// whose name ends with `.github`, or `base` itself when there is none.
pub fn github_folder(base: &str) -> String {
    let mut current = base.to_owned();
    while !current.ends_with(".github") {
        let parent = dir(&current);
        if parent == current || parent.is_empty() {
            return base.to_owned();
        }
        current = parent;
    }
    current
}

const GITHUB: &str = ".github/";
const AGENTS: &str = ".agents/";

/// gh-aw's `resolveHashImportPath`: where an import written in a file in
/// `base` of a workflow in `root` resolves, without its `#section`. A path
/// without `/`, or starting with `./`, is relative to the importing file;
/// others to the workflow's directory; `.github/…` and `/.github/…` to the
/// repository's root. Fails, as gh-aw does, on a path that leaves the
/// `.github` (or `.agents`) folder.
pub fn resolve_import(import: &str, base: &str, root: &str) -> Result<String, String> {
    let written = import.split_once('#').map_or(import, |(path, _)| path);
    let mut resolve_base = if !written.contains('/') || written.starts_with("./") {
        base
    } else {
        root
    }
    .to_owned();
    let github = github_folder(&resolve_base);
    let mut security = github.clone();
    let mut path = written.to_owned();
    if github.ends_with(".github") {
        let repository = dir(&github);
        if path.starts_with(GITHUB) {
            resolve_base = repository;
        } else if let Some(stripped) = path.strip_prefix('/').map(str::to_owned) {
            if stripped.starts_with(AGENTS) {
                security = join(&repository, ".agents");
            } else if !stripped.starts_with(GITHUB) {
                return Err(format!("{import} must be within the .github or .agents folder"));
            }
            path = stripped;
            resolve_base = repository;
        }
    }
    if let Some(stripped) = path.strip_prefix('/')
        && !stripped.starts_with(GITHUB)
        && !stripped.starts_with(AGENTS)
    {
        return Err(format!("{import} must be within the .github or .agents folder"));
    }
    let full = join(&resolve_base, &path);
    if !within(&security, &full) {
        return Err(format!(
            "{import} must be within the {} folder",
            if security.is_empty() { "project" } else { &security }
        ));
    }
    Ok(full)
}

/// gh-aw's `runtimeImportHashCandidatePaths`: the files a
/// `{{#runtime-import path}}` in a workflow in `base` may name, in order.
pub fn runtime_candidates(path: &str, base: &str) -> Vec<String> {
    let mut normalized = path.trim().replace('\\', "/");
    if normalized.starts_with('/') {
        normalized = normalized.trim_start_matches('/').to_owned();
        if !normalized.starts_with(GITHUB) && !normalized.starts_with(AGENTS) {
            return vec![];
        }
    }
    let normalized = normalized.strip_prefix("./").unwrap_or(&normalized).to_owned();
    if normalized.is_empty() || normalized.starts_with("../") || normalized.contains("/../") {
        return vec![];
    }
    let github = github_folder(&clean(base));
    let workspace = if github.ends_with(".github") {
        dir(&github)
    } else {
        base.to_owned()
    };
    if normalized.starts_with(AGENTS) || normalized.starts_with(GITHUB) {
        return vec![join(&workspace, &normalized)];
    }
    let mut candidates: Vec<String> = Vec::new();
    for candidate in [
        join(&join(&workspace, ".github"), &normalized),
        join(&join(&workspace, ".github/workflows"), &normalized),
        join(base, &normalized),
    ] {
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_imports_as_gh_aw_does() {
        let base = ".github/workflows";
        assert_eq!(
            resolve_import("shared/otlp.md", base, base).unwrap(),
            ".github/workflows/shared/otlp.md"
        );
        assert_eq!(
            resolve_import("tools.md#Web", ".github/workflows/shared", base).unwrap(),
            ".github/workflows/shared/tools.md"
        );
        assert_eq!(
            resolve_import("./a.md", ".github/workflows/shared", base).unwrap(),
            ".github/workflows/shared/a.md"
        );
        assert_eq!(resolve_import(".github/agents/x.md", base, base).unwrap(), ".github/agents/x.md");
        assert_eq!(resolve_import("/.agents/skills/a.md", base, base).unwrap(), ".agents/skills/a.md");
        assert!(resolve_import("../../etc/passwd", base, base).is_err());
        assert!(resolve_import("/etc/passwd", base, base).is_err());
        // A cross-repository import resolves locally and is then missing, as in gh-aw.
        assert_eq!(
            resolve_import("owner/repo/a.md@v1", base, base).unwrap(),
            ".github/workflows/owner/repo/a.md@v1"
        );
    }

    #[test]
    fn lists_runtime_import_candidates() {
        let base = ".github/workflows";
        assert_eq!(
            runtime_candidates("prompts/x.md", base),
            [".github/prompts/x.md", ".github/workflows/prompts/x.md"]
        );
        assert_eq!(runtime_candidates("/.github/a.md", base), [".github/a.md"]);
        assert!(runtime_candidates("/etc/a", base).is_empty());
        assert!(runtime_candidates("../a", base).is_empty());
    }
}
