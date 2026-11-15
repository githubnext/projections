//! Long help kept in Markdown files (packages/cli/src/commands/help, packages/cli/src/tools/authoring/describe-part)
//! so the formatter wraps its prose, printed as plain text: each paragraph on one
//! line, the terminal wrapping it. The files use only paragraphs, hard breaks (a
//! trailing `\`), backslash escapes and ```` ``` ```` fences, whose lines print
//! verbatim; blocks print separated by a blank line.

/// The plain text of a help file: paragraphs joined onto one line, fences as written.
pub fn from_markdown(markdown: &str) -> String {
    let mut blocks = Vec::new();
    let mut paragraph: Vec<&str> = Vec::new();
    let mut fence: Option<Vec<&str>> = None;
    for line in markdown.lines() {
        if let Some(lines) = &mut fence {
            if line == "```" {
                blocks.push(lines.join("\n"));
                fence = None;
            } else {
                lines.push(line);
            }
        } else if line.starts_with("```") {
            blocks.extend(join(&mut paragraph));
            fence = Some(Vec::new());
        } else if line.is_empty() {
            blocks.extend(join(&mut paragraph));
        } else {
            paragraph.push(line);
        }
    }
    assert!(fence.is_none(), "Unclosed fence in help text");
    blocks.extend(join(&mut paragraph));
    blocks.join("\n\n")
}

/// One paragraph's lines as one, keeping hard breaks.
fn join(lines: &mut Vec<&str>) -> Option<String> {
    if lines.is_empty() {
        return None;
    }
    let mut text = String::new();
    let last = lines.len() - 1;
    for (index, line) in lines.drain(..).enumerate() {
        let body = line.strip_suffix('\\').filter(|body| !body.ends_with('\\'));
        unescape(body.unwrap_or(line), &mut text);
        if index < last {
            text.push(if body.is_some() { '\n' } else { ' ' });
        }
    }
    Some(text)
}

/// Markdown's backslash escapes: a backslash before ASCII punctuation is dropped.
fn unescape(line: &str, text: &mut String) {
    let mut characters = line.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\\'
            && let Some(&next) = characters.peek()
            && next.is_ascii_punctuation()
        {
            text.push(next);
            characters.next();
        } else {
            text.push(character);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::from_markdown;

    #[test]
    fn joins_paragraph_lines_and_keeps_fences_and_hard_breaks() {
        let markdown = "Writes \\<id>.json,\nnever over a file.\\\nThen run it.\n\n```text\nExamples:\n  projections init a   one\n\n  projections init\n```\n\nLast.\n";
        assert_eq!(
            from_markdown(markdown),
            "Writes <id>.json, never over a file.\nThen run it.\n\nExamples:\n  projections init a   one\n\n  projections init\n\nLast."
        );
    }
}
