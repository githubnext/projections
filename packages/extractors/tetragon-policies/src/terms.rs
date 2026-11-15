//! Human-readable text built from prose and code, written as the contracts'
//! text with inline code (`prose()`): code goes in backtick spans, so viewers
//! draw identifiers, paths, values and selectors in the code font and the
//! connecting English in the text font. `display()` is the plain text.

#[derive(Default, Clone)]
pub struct Terms(Vec<(String, bool)>);

impl Terms {
    pub fn new() -> Self {
        Self::default()
    }
    /// Prose, joined exactly as written (include spaces).
    pub fn text(mut self, text: &str) -> Self {
        if let Some((last, false)) = self.0.last_mut() {
            last.push_str(text);
        } else if !text.is_empty() {
            self.0.push((text.to_owned(), false));
        }
        self
    }
    /// A code span: an identifier, path, value or expression.
    pub fn code(mut self, code: &str) -> Self {
        self.0.push((code.to_owned(), true));
        self
    }
    /// Code values as `a`, `a or b`, `a, b or c`.
    pub fn alternatives(mut self, values: &[String], conjunction: &str) -> Self {
        for (index, value) in values.iter().enumerate() {
            if index > 0 {
                self = self.text(if index + 1 == values.len() { conjunction } else { ", " });
            }
            self = self.code(value);
        }
        self
    }
    pub fn extend(mut self, other: Terms) -> Self {
        for (token, code) in other.0 {
            self = if code { self.code(&token) } else { self.text(&token) };
        }
        self
    }
    /// The plain text, without code markers.
    pub fn display(&self) -> String {
        self.0.iter().map(|(token, _)| token.as_str()).collect()
    }
    /// The text with inline code: code in backticks, backticks and backslashes escaped.
    pub fn prose(&self) -> String {
        self.0
            .iter()
            .map(|(token, code)| {
                let escaped = escape(token);
                if *code { format!("`{escaped}`") } else { escaped }
            })
            .collect()
    }
}

/// Plain text as prose: its backticks and backslashes escaped.
pub fn escape(text: &str) -> String {
    text.replace('\\', "\\\\").replace('`', "\\`")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_prose_and_code() {
        let terms = Terms::new()
            .code("arg0")
            .text(" starts with ")
            .alternatives(&["/a".into(), "/b".into(), "/c".into()], " or ");
        assert_eq!(terms.display(), "arg0 starts with /a, /b or /c");
        assert_eq!(terms.prose(), "`arg0` starts with `/a`, `/b` or `/c`");
        assert_eq!(Terms::new().code("a`b\\").text(" x`").prose(), "`a\\`b\\\\` x\\`");
    }
}
