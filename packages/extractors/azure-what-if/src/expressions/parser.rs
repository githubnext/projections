//! A character cursor over one template expression.

pub(crate) struct Parser {
    pub(super) chars: Vec<char>,
    pub(super) at: usize,
}

impl Parser {
    pub(super) fn peek(&self) -> Option<char> {
        self.chars.get(self.at).copied()
    }
    pub(super) fn next(&mut self) -> Option<char> {
        let c = self.peek()?;
        self.at += 1;
        Some(c)
    }
    pub(super) fn skip(&mut self) {
        while self.peek().is_some_and(char::is_whitespace) {
            self.at += 1;
        }
    }
    pub(super) fn expect(&mut self, c: char) -> Option<()> {
        self.skip();
        (self.next()? == c).then_some(())
    }
    pub(super) fn identifier(&mut self) -> Option<String> {
        let start = self.at;
        while self.peek().is_some_and(|c| c.is_alphanumeric() || c == '_') {
            self.at += 1;
        }
        (self.at > start).then(|| self.chars[start..self.at].iter().collect())
    }
    pub(super) fn string(&mut self) -> Option<String> {
        self.expect('\'')?;
        let mut out = String::new();
        loop {
            match self.next()? {
                '\'' if self.peek() == Some('\'') => {
                    self.at += 1;
                    out.push('\'');
                }
                '\'' => return Some(out),
                c => out.push(c),
            }
        }
    }
}
