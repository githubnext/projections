//! An agentic workflow file as gh-aw reads it as text: the front matter
//! between the first two `---` lines, and the markdown body after them
//! (`extractFrontmatterAndBodyText` in gh-aw's `pkg/parser/frontmatter_hash.go`).

use anyhow::{Result, bail};

/// A markdown file split into its raw front matter text and its body.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Document {
    /// The text between the delimiters, as written (CRLF already LF).
    pub front: String,
    pub body: String,
    /// Whether the file opens with a `---` line.
    pub has_front: bool,
}

/// Splits `content` the way gh-aw does before hashing: CRLF becomes LF; a
/// file whose first line isn't `---` (trimmed) has no front matter and is all
/// body; otherwise the front matter runs to the next `---` line, and a file
/// without one fails.
pub fn split(content: &str) -> Result<Document> {
    let content = content.replace("\r\n", "\n");
    let first = content.split('\n').next().unwrap_or("");
    if first.trim() != "---" {
        return Ok(Document {
            front: String::new(),
            body: content,
            has_front: false,
        });
    }
    let lines: Vec<&str> = content.split('\n').collect();
    let Some(end) = lines
        .iter()
        .enumerate()
        .skip(1)
        .find(|(_, line)| line.trim() == "---")
        .map(|(index, _)| index)
    else {
        bail!("its front matter has no closing `---` line");
    };
    Ok(Document {
        front: lines[1..end].join("\n"),
        body: lines.get(end + 1..).map(|rest| rest.join("\n")).unwrap_or_default(),
        has_front: true,
    })
}

/// gh-aw's `normalizeFrontmatterText`: LF line endings, then Unicode whitespace trimmed at both ends.
pub fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n").trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_front_matter_from_body_as_gh_aw_does() {
        let document = split("---\r\non: push\r\n---\r\n# Title\r\n").unwrap();
        assert_eq!(document.front, "on: push");
        assert_eq!(document.body, "# Title\n");
        assert!(split("# No front matter").unwrap().body == "# No front matter");
        assert!(split("---\non: push\n").is_err());
        assert_eq!(split("---\n---").unwrap().body, "");
        assert_eq!(normalize("\u{a0} text \n"), "text");
    }
}
