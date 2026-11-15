//! Workspace globs, as npm, pnpm and Yarn match them against package directories.

use anyhow::{Result, bail, ensure};
use projections_extractor_sdk::glob;
use regex::Regex;

pub struct Selection {
    positive: Vec<Regex>,
    negative: Vec<Regex>,
    /// Negated patterns the package manager ignores.
    pub ignored: Vec<String>,
}

impl Selection {
    /// `negation` is whether `!pattern` excludes directories (every manager but Yarn classic).
    pub fn new(patterns: &[String], negation: bool) -> Result<Self> {
        let mut selection = Self {
            positive: vec![],
            negative: vec![],
            ignored: vec![],
        };
        for pattern in patterns {
            let (negated, body) = match pattern.strip_prefix('!') {
                Some(body) => (true, body),
                None => (false, pattern.as_str()),
            };
            if negated && !negation {
                selection.ignored.push(pattern.clone());
                continue;
            }
            for expanded in braces(body)? {
                let normalized = expanded.trim_start_matches("./").trim_end_matches('/').to_owned();
                ensure!(
                    !normalized.is_empty() && !normalized.starts_with('/') && !normalized.split('/').any(|s| s == ".."),
                    "Workspace pattern {pattern:?} must select directories inside the workspace"
                );
                ensure!(
                    !normalized.contains(['[', ']']) && !["+(", "@(", "!(", "?(", "*("].iter().any(|e| normalized.contains(e)),
                    "Workspace pattern {pattern:?} uses character classes or extended globs, which are not supported"
                );
                let regex = glob(&normalized)?;
                if negated {
                    selection.negative.push(regex);
                } else {
                    selection.positive.push(regex);
                }
            }
        }
        Ok(selection)
    }

    pub fn matches(&self, directory: &str) -> bool {
        self.positive.iter().any(|p| p.is_match(directory)) && !self.negative.iter().any(|p| p.is_match(directory))
    }
}

/// Expands `{a,b}` alternatives, including nested ones.
fn braces(pattern: &str) -> Result<Vec<String>> {
    let Some(open) = pattern.find('{') else {
        ensure!(!pattern.contains('}'), "Unbalanced braces in workspace pattern {pattern:?}");
        return Ok(vec![pattern.to_owned()]);
    };
    let mut depth = 0;
    let mut parts = vec![];
    let mut start = open + 1;
    for (i, c) in pattern[open..].char_indices().map(|(i, c)| (i + open, c)) {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    parts.push(&pattern[start..i]);
                    let (prefix, suffix) = (&pattern[..open], &pattern[i + 1..]);
                    let mut expanded = vec![];
                    for part in parts {
                        for inner in braces(&format!("{prefix}{part}{suffix}"))? {
                            expanded.push(inner);
                        }
                    }
                    return Ok(expanded);
                }
            }
            ',' if depth == 1 => {
                parts.push(&pattern[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    bail!("Unbalanced braces in workspace pattern {pattern:?}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn braces_expand_including_nested_alternatives() {
        assert_eq!(braces("a/{b,c}").unwrap(), ["a/b", "a/c"]);
        assert_eq!(braces("{a,b/{c,d}}/*").unwrap(), ["a/*", "b/c/*", "b/d/*"]);
        assert!(braces("a/{b").is_err());
    }

    #[test]
    fn negation_excludes_unless_the_manager_ignores_it() {
        let patterns = ["packages/*".to_owned(), "!packages/legacy".to_owned()];
        let npm = Selection::new(&patterns, true).unwrap();
        assert!(npm.matches("packages/api") && !npm.matches("packages/legacy"));
        let classic = Selection::new(&patterns, false).unwrap();
        assert!(classic.matches("packages/legacy"));
        assert_eq!(classic.ignored, ["!packages/legacy"]);
        assert!(Selection::new(&["../x".to_owned()], true).is_err());
        assert!(Selection::new(&["packages/[ab]".to_owned()], true).is_err());
    }
}
