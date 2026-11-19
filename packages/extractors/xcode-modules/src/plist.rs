//! Old-style (OpenStep) property lists, the format of `project.pbxproj`:
//! `{ key = value; }` dictionaries, `( a, b, )` arrays, quoted and bare
//! strings, `<hex>` data and `/* */` and `//` comments. Values become JSON
//! strings, arrays and objects.

use anyhow::{Result, bail};
use serde_json::{Map, Value};

pub fn parse(text: &str) -> Result<Value> {
    let mut parser = Parser {
        chars: text.chars().collect(),
        at: 0,
        line: 1,
    };
    let value = parser.value()?;
    parser.space()?;
    if parser.at < parser.chars.len() {
        bail!("Unexpected content after the property list on line {}", parser.line);
    }
    Ok(value)
}

struct Parser {
    chars: Vec<char>,
    at: usize,
    line: usize,
}

/// Characters a bare string may contain.
fn bare(c: char) -> bool {
    c.is_alphanumeric() || "_$+/:.-".contains(c)
}

impl Parser {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.at).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek()?;
        self.at += 1;
        if c == '\n' {
            self.line += 1;
        }
        Some(c)
    }

    /// Skips whitespace and comments.
    fn space(&mut self) -> Result<()> {
        loop {
            match (self.peek(), self.chars.get(self.at + 1)) {
                (Some(c), _) if c.is_whitespace() => {
                    self.bump();
                }
                (Some('/'), Some('/')) => {
                    while self.peek().is_some_and(|c| c != '\n') {
                        self.bump();
                    }
                }
                (Some('/'), Some('*')) => {
                    let line = self.line;
                    self.at += 2;
                    while !(self.peek() == Some('*') && self.chars.get(self.at + 1) == Some(&'/')) {
                        if self.bump().is_none() {
                            bail!("Unterminated comment starting on line {line}");
                        }
                    }
                    self.at += 2;
                }
                _ => return Ok(()),
            }
        }
    }

    fn expect(&mut self, wanted: char) -> Result<()> {
        self.space()?;
        match self.bump() {
            Some(c) if c == wanted => Ok(()),
            other => bail!("Expected `{wanted}` on line {}, found {other:?}", self.line),
        }
    }

    fn value(&mut self) -> Result<Value> {
        self.space()?;
        match self.peek() {
            Some('{') => self.dictionary(),
            Some('(') => self.array(),
            Some('"') => self.quoted().map(Value::String),
            Some('<') => self.data(),
            Some(c) if bare(c) => Ok(Value::String(self.bare())),
            other => bail!("Unexpected {other:?} on line {}", self.line),
        }
    }

    fn dictionary(&mut self) -> Result<Value> {
        self.bump();
        let mut map = Map::new();
        loop {
            self.space()?;
            if self.peek() == Some('}') {
                self.bump();
                return Ok(Value::Object(map));
            }
            let Value::String(key) = self.value()? else {
                bail!("A dictionary key on line {} isn't a string", self.line);
            };
            self.expect('=')?;
            let value = self.value()?;
            self.expect(';')?;
            map.insert(key, value);
        }
    }

    fn array(&mut self) -> Result<Value> {
        self.bump();
        let mut items = Vec::new();
        loop {
            self.space()?;
            if self.peek() == Some(')') {
                self.bump();
                return Ok(Value::Array(items));
            }
            items.push(self.value()?);
            self.space()?;
            match self.peek() {
                Some(',') => {
                    self.bump();
                }
                Some(')') => {}
                other => bail!("Expected `,` or `)` on line {}, found {other:?}", self.line),
            }
        }
    }

    fn bare(&mut self) -> String {
        let start = self.at;
        while self.peek().is_some_and(bare) {
            self.at += 1;
        }
        self.chars[start..self.at].iter().collect()
    }

    fn quoted(&mut self) -> Result<String> {
        let line = self.line;
        self.bump();
        let mut value = String::new();
        loop {
            match self.bump() {
                None => bail!("Unterminated string starting on line {line}"),
                Some('"') => return Ok(value),
                Some('\\') => value.push(self.escape()?),
                Some(c) => value.push(c),
            }
        }
    }

    fn escape(&mut self) -> Result<char> {
        Ok(match self.bump() {
            Some('n') => '\n',
            Some('t') => '\t',
            Some('r') => '\r',
            Some('U') => {
                let digits: String = (0..4).filter_map(|_| self.bump()).collect();
                u32::from_str_radix(&digits, 16)
                    .ok()
                    .and_then(char::from_u32)
                    .ok_or_else(|| anyhow::anyhow!("Malformed \\U escape on line {}", self.line))?
            }
            Some(other) => other,
            None => bail!("Unterminated escape on line {}", self.line),
        })
    }

    /// `<0fbd 7e>` data, kept as its hex digits.
    fn data(&mut self) -> Result<Value> {
        let line = self.line;
        self.bump();
        let mut hex = String::new();
        loop {
            match self.bump() {
                None => bail!("Unterminated data starting on line {line}"),
                Some('>') => return Ok(Value::String(hex)),
                Some(c) if c.is_ascii_hexdigit() => hex.push(c),
                Some(c) if c.is_whitespace() => {}
                Some(c) => bail!("Unexpected {c:?} in data on line {}", self.line),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_dictionaries_arrays_strings_and_comments() {
        let text = "// !$*UTF8*$!\n{\n\tobjects = {\n\t\tA1 /* x */ = {isa = PBXGroup; children = (B2 /* y */, ); name = \"My \\\"Group\\\"\"; path = Sources/App; };\n\t};\n\tdata = <0A 1b>;\n}\n";
        assert_eq!(
            parse(text).unwrap(),
            json!({"objects": {"A1": {"isa": "PBXGroup", "children": ["B2"], "name": "My \"Group\"", "path": "Sources/App"}}, "data": "0A1b"})
        );
    }

    #[test]
    fn rejects_malformed_lists() {
        assert!(parse("{ a = b }").is_err());
        assert!(parse("{ a = \"b; }").is_err());
    }
}
