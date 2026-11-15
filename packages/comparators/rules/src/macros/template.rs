use super::{Args, Expander};
use cel::common::ast::{Expr, IdedExpr, ListExpr, LiteralValue, SelectExpr};
use cel::common::types::CelString;
use std::collections::BTreeMap;

impl Expander<'_> {
    /// `template('… {name} …', {'name': value, …})`, or without the map.
    pub(super) fn expand_template(&mut self, id: u64, mut args: Args) -> IdedExpr {
        let (text, map, None) = (args.next(), args.next(), args.next()) else {
            self.error(id, "`template` takes a string literal and, optionally, a map of fields");
            return self.invalid(id);
        };
        let Some(IdedExpr {
            id: text_id,
            expr: Expr::Literal(LiteralValue::String(text)),
        }) = text
        else {
            self.error(id, "`template` takes a string literal: `template('… {name} …', {'name': value})`");
            return self.invalid(id);
        };
        let fields = match map {
            None => None,
            Some(map) => {
                let Some(entries) = self.entries(id, "template", Some(map)) else {
                    return self.invalid(id);
                };
                let mut fields = BTreeMap::new();
                for (key, value) in entries {
                    match &key.expr {
                        Expr::Literal(LiteralValue::String(name)) => {
                            if fields.insert(name.inner().to_owned(), (key.id, value, false)).is_some() {
                                self.error(key.id, format!("The field `{}` appears twice", name.inner()));
                            }
                        }
                        _ => self.error(key.id, "A `template` field name is a string literal"),
                    }
                }
                Some(fields)
            }
        };
        let (format, names) = match parse_template(text.inner()) {
            Ok(parsed) => parsed,
            Err(message) => {
                self.error(text_id, message);
                return self.invalid(id);
            }
        };
        let mut fields = fields;
        let mut values = Vec::new();
        for field in names {
            let value = match &mut fields {
                Some(fields) => match fields.get_mut(&field) {
                    Some((_, value, used)) => {
                        *used = true;
                        value.clone()
                    }
                    None => {
                        self.error(text_id, format!("The template names `{{{field}}}`, which its map doesn't give"));
                        continue;
                    }
                },
                None if self.params.contains(&field) => self.node(id, Expr::Ident(field.clone())),
                None => {
                    let variables = self.node(id, Expr::Ident("variables".to_owned()));
                    self.node(
                        id,
                        Expr::Select(SelectExpr {
                            operand: Box::new(variables),
                            field: field.clone(),
                            test: false,
                        }),
                    )
                }
            };
            values.push(value);
        }
        for (name, (key, _, used)) in fields.into_iter().flatten() {
            if !used {
                self.error(key, format!("The template doesn't use the field `{name}`"));
            }
        }
        let format = self.node(id, Expr::Literal(LiteralValue::String(CelString::from(format))));
        let list = self.node(id, Expr::List(ListExpr::new(values)));
        self.call(id, "format", Some(format), vec![list])
    }
}

/// A template's format string (`%s` per field, `%%` for `%`) and its field
/// names in order.
fn parse_template(text: &str) -> Result<(String, Vec<String>), String> {
    let mut format = String::new();
    let mut names = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '{' if chars.peek() == Some(&'{') => {
                chars.next();
                format.push('{');
            }
            '}' if chars.peek() == Some(&'}') => {
                chars.next();
                format.push('}');
            }
            '{' => {
                let mut field = String::new();
                loop {
                    match chars.next() {
                        Some('}') => break,
                        Some(c) => field.push(c),
                        None => {
                            return Err("A `{` in the template isn't closed; write `{{` for a brace".to_owned());
                        }
                    }
                }
                let identifier = field.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                    && field.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
                if !identifier {
                    return Err(format!("`{{{field}}}` isn't a field name"));
                }
                format.push_str("%s");
                names.push(field);
            }
            '}' => {
                return Err("A `}` in the template isn't opened; write `}}` for a brace".to_owned());
            }
            '%' => format.push_str("%%"),
            c => format.push(c),
        }
    }
    Ok((format, names))
}

#[cfg(test)]
mod tests;
