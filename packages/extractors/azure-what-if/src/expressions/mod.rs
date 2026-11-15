//! A tiny evaluator for the literal ARM template expressions Bicep emits in
//! names and `dependsOn`: string literals, `format`, `concat`, `parameters`
//! (their literal defaults), `variables` and `resourceId`.

mod parser;

use crate::payload::template_expression;
use parser::Parser;
use serde_json::Value;

pub(crate) struct Expressions<'a> {
    pub(crate) template: &'a Value,
}

#[derive(Debug, PartialEq)]
pub(crate) enum Evaluated {
    Text(String),
    Resource(String, String),
}

impl Expressions<'_> {
    pub(crate) fn evaluate(&self, value: &str, depth: usize) -> Option<Evaluated> {
        if !template_expression(value) {
            return Some(Evaluated::Text(value.replacen("[[", "[", 1)));
        }
        let mut parser = Parser {
            chars: value[1..value.len() - 1].chars().collect(),
            at: 0,
        };
        let result = self.call(&mut parser, depth)?;
        parser.skip();
        (parser.at == parser.chars.len()).then_some(result)
    }

    fn call(&self, p: &mut Parser, depth: usize) -> Option<Evaluated> {
        if depth > 16 {
            return None;
        }
        p.skip();
        if p.peek() == Some('\'') {
            return p.string().map(Evaluated::Text);
        }
        let name = p.identifier()?;
        p.expect('(')?;
        let arguments = self.arguments(p, depth)?;
        let texts: Option<Vec<String>> = arguments
            .iter()
            .map(|a| match a {
                Evaluated::Text(t) => Some(t.clone()),
                Evaluated::Resource(..) => None,
            })
            .collect();
        self.apply(&name, &texts?, depth)
    }

    /// The comma-separated arguments after a function's `(`, through its `)`.
    fn arguments(&self, p: &mut Parser, depth: usize) -> Option<Vec<Evaluated>> {
        let mut arguments = vec![];
        loop {
            p.skip();
            if p.peek() == Some(')') {
                p.at += 1;
                break;
            }
            arguments.push(self.call(p, depth + 1)?);
            p.skip();
            match p.next()? {
                ',' => continue,
                ')' => break,
                _ => return None,
            }
        }
        Some(arguments)
    }

    fn apply(&self, name: &str, texts: &[String], depth: usize) -> Option<Evaluated> {
        match name.to_lowercase().as_str() {
            "concat" => Some(Evaluated::Text(texts.concat())),
            "format" => {
                let (pattern, values) = texts.split_first()?;
                let mut out = pattern.clone();
                for (i, v) in values.iter().enumerate() {
                    out = out.replace(&format!("{{{i}}}"), v);
                }
                Some(Evaluated::Text(out))
            }
            "parameters" => {
                let default = &self.template["parameters"][texts.first()?]["defaultValue"];
                let text = default.as_str()?;
                self.evaluate(text, depth + 1)
            }
            "variables" => {
                let text = self.template["variables"][texts.first()?].as_str()?;
                self.evaluate(text, depth + 1)
            }
            "resourceid" => {
                // resourceId([subscriptionId], [resourceGroupName], type, name…): the type has a slash.
                let at = texts.iter().position(|t| t.contains('/'))?;
                let names = &texts[at + 1..];
                (!names.is_empty()).then(|| Evaluated::Resource(texts[at].clone(), names.join("/")))
            }
            _ => None,
        }
    }
}
