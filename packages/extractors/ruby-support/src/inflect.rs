//! English singular and plural forms as Rails computes them: ActiveSupport's
//! default inflection rules, plus the `irregular`, `uncountable`, `plural`
//! and `singular` rules an application adds in an initializer.
//!
//! Rules apply newest first, as ActiveSupport applies them. The default rules
//! below are ActiveSupport's (`activesupport/lib/active_support/inflections.rb`),
//! used under its license:
//!
//! Copyright (c) 2005-2022 David Heinemeier Hansson
//!
//! Permission is hereby granted, free of charge, to any person obtaining a copy
//! of this software and associated documentation files (the "Software"), to deal
//! in the Software without restriction, including without limitation the rights
//! to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//! copies of the Software, and to permit persons to whom the Software is
//! furnished to do so, subject to the following conditions:
//!
//! The above copyright notice and this permission notice shall be included in
//! all copies or substantial portions of the Software.
//!
//! THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//! IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//! FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//! AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//! LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//! OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//! SOFTWARE.

use crate::{Expr, Kind, Stmt};
use regex::{Regex, RegexBuilder};

const PLURALS: [(&str, &str); 21] = [
    ("$", "s"),
    ("s$", "s"),
    ("^(ax|test)is$", "${1}es"),
    ("(octop|vir)us$", "${1}i"),
    ("(octop|vir)i$", "${1}i"),
    ("(alias|status)$", "${1}es"),
    ("(bu)s$", "${1}ses"),
    ("(buffal|tomat)o$", "${1}oes"),
    ("([ti])um$", "${1}a"),
    ("([ti])a$", "${1}a"),
    ("sis$", "ses"),
    ("(?:([^f])fe|([lr])f)$", "${1}${2}ves"),
    ("(hive)$", "${1}s"),
    ("([^aeiouy]|qu)y$", "${1}ies"),
    ("(x|ch|ss|sh)$", "${1}es"),
    ("(matr|vert|ind)(?:ix|ex)$", "${1}ices"),
    ("^(m|l)ouse$", "${1}ice"),
    ("^(m|l)ice$", "${1}ice"),
    ("^(ox)$", "${1}en"),
    ("^(oxen)$", "${1}"),
    ("(quiz)$", "${1}zes"),
];

const SINGULARS: [(&str, &str); 27] = [
    ("s$", ""),
    ("(ss)$", "${1}"),
    ("(n)ews$", "${1}ews"),
    ("([ti])a$", "${1}um"),
    ("((a)naly|(b)a|(d)iagno|(p)arenthe|(p)rogno|(s)ynop|(t)he)(sis|ses)$", "${1}sis"),
    ("(^analy)(sis|ses)$", "${1}sis"),
    ("([^f])ves$", "${1}fe"),
    ("(hive)s$", "${1}"),
    ("(tive)s$", "${1}"),
    ("([lr])ves$", "${1}f"),
    ("([^aeiouy]|qu)ies$", "${1}y"),
    ("(s)eries$", "${1}eries"),
    ("(m)ovies$", "${1}ovie"),
    ("(x|ch|ss|sh)es$", "${1}"),
    ("^(m|l)ice$", "${1}ouse"),
    ("(bus)(es)?$", "${1}"),
    ("(o)es$", "${1}"),
    ("(shoe)s$", "${1}"),
    ("(cris|test)(is|es)$", "${1}is"),
    ("^(a)x[ie]s$", "${1}xis"),
    ("(octop|vir)(us|i)$", "${1}us"),
    ("(alias|status)(es)?$", "${1}"),
    ("^(ox)en", "${1}"),
    ("(vert|ind)ices$", "${1}ex"),
    ("(matr)ices$", "${1}ix"),
    ("(quiz)zes$", "${1}"),
    ("(database)s$", "${1}"),
];

const IRREGULARS: [(&str, &str); 6] = [
    ("person", "people"),
    ("man", "men"),
    ("child", "children"),
    ("sex", "sexes"),
    ("move", "moves"),
    ("zombie", "zombies"),
];

const UNCOUNTABLES: [&str; 10] = [
    "equipment",
    "information",
    "rice",
    "money",
    "species",
    "series",
    "fish",
    "sheep",
    "jeans",
    "police",
];

fn rule(pattern: &str) -> Regex {
    RegexBuilder::new(pattern)
        .case_insensitive(true)
        .build()
        .expect("inflection rules are valid")
}

/// Inflection rules, newest last.
#[derive(Clone)]
pub struct Inflections {
    plurals: Vec<(Regex, String)>,
    singulars: Vec<(Regex, String)>,
    uncountables: Vec<String>,
    /// Application rules that couldn't be read, as written.
    pub unread: Vec<String>,
}

impl Default for Inflections {
    fn default() -> Self {
        let mut inflections = Inflections {
            plurals: PLURALS.iter().map(|(p, r)| (rule(p), (*r).to_owned())).collect(),
            singulars: SINGULARS.iter().map(|(p, r)| (rule(p), (*r).to_owned())).collect(),
            uncountables: Vec::new(),
            unread: Vec::new(),
        };
        for (singular, plural) in IRREGULARS {
            inflections.irregular(singular, plural);
        }
        for word in UNCOUNTABLES {
            inflections.uncountable(word);
        }
        inflections
    }
}

/// The first character and the rest, as ActiveSupport's `irregular` splits them.
fn split_first(word: &str) -> (&str, &str) {
    let first = word.chars().next().map_or(0, char::len_utf8);
    word.split_at(first)
}

impl Inflections {
    pub fn irregular(&mut self, singular: &str, plural: &str) {
        self.uncountables.retain(|word| word != singular && word != plural);
        let ((s0, srest), (p0, prest)) = (split_first(singular), split_first(plural));
        let escape = regex::escape;
        let pattern = |first: &str, rest: &str| rule(&format!("({}){}$", escape(first), escape(rest)));
        if s0.eq_ignore_ascii_case(p0) {
            self.plurals.push((pattern(s0, srest), format!("${{1}}{prest}")));
            self.plurals.push((pattern(p0, prest), format!("${{1}}{prest}")));
            self.singulars.push((pattern(s0, srest), format!("${{1}}{srest}")));
            self.singulars.push((pattern(p0, prest), format!("${{1}}{srest}")));
        } else {
            let whole = |first: &str, rest: &str| rule(&format!("{}{}$", escape(first), escape(rest)));
            self.plurals.push((whole(s0, srest), plural.to_owned()));
            self.plurals.push((whole(p0, prest), plural.to_owned()));
            self.singulars.push((whole(s0, srest), singular.to_owned()));
            self.singulars.push((whole(p0, prest), singular.to_owned()));
        }
    }

    pub fn uncountable(&mut self, word: &str) {
        self.uncountables.push(word.to_lowercase());
    }

    fn is_uncountable(&self, word: &str) -> bool {
        let lower = word.to_lowercase();
        self.uncountables.iter().any(|candidate| {
            lower.strip_suffix(candidate.as_str()).is_some_and(|before| {
                // `\b` before the word: the start, or a character that isn't a word character.
                before.chars().last().is_none_or(|c| !(c.is_alphanumeric() || c == '_'))
            })
        })
    }

    fn apply(&self, word: &str, rules: &[(Regex, String)]) -> String {
        if word.is_empty() || self.is_uncountable(word) {
            return word.to_owned();
        }
        for (pattern, replacement) in rules.iter().rev() {
            if pattern.is_match(word) {
                return pattern.replace(word, replacement.as_str()).into_owned();
            }
        }
        word.to_owned()
    }

    pub fn pluralize(&self, word: &str) -> String {
        self.apply(word, &self.plurals)
    }

    pub fn singularize(&self, word: &str) -> String {
        self.apply(word, &self.singulars)
    }

    /// Adds the rules of an initializer's `ActiveSupport::Inflector.inflections`
    /// blocks (`config/initializers/inflections.rb`): `irregular`,
    /// `uncountable`, and `plural` and `singular` with a string or a regular
    /// expression Rust's regex engine accepts. Anything else is kept in `unread`.
    pub fn read(&mut self, statements: &[Stmt]) {
        for statement in statements {
            let Stmt::Expr(expr) = statement else { continue };
            let Some(call) = expr.call() else { continue };
            match &call.block {
                Some(block) if call.name == "inflections" => {
                    let param = block.params.first().cloned().unwrap_or_default();
                    for statement in &block.body {
                        self.rule(statement, &param);
                    }
                }
                _ => {}
            }
        }
    }

    fn rule(&mut self, statement: &Stmt, param: &str) {
        let unread = |text: String, inflections: &mut Self| inflections.unread.push(text);
        let (Stmt::Expr(expr), false) = (statement, param.is_empty()) else {
            if let Stmt::Other { text, .. } = statement {
                unread(text.clone(), self);
            }
            return;
        };
        let Some(call) = expr.call().filter(|c| c.receiver.as_ref().is_some_and(|r| r.text == param)) else {
            return unread(expr.text.clone(), self);
        };
        let args: Vec<&Expr> = call.positional().collect();
        let read = match (call.name.as_str(), args.as_slice()) {
            ("irregular", [singular, plural]) => match (singular.name(), plural.name()) {
                (Some(s), Some(p)) => {
                    self.irregular(s, p);
                    true
                }
                _ => false,
            },
            ("uncountable", words) => {
                let words: Option<Vec<String>> = words.iter().map(|w| w.names()).collect::<Option<Vec<_>>>().map(|w| w.concat());
                words.map(|words| words.iter().for_each(|w| self.uncountable(w))).is_some()
            }
            (name @ ("plural" | "singular"), [pattern, replacement]) => self.custom(name, pattern, replacement),
            // Acronyms and human forms change how words are cased and shown, not their number.
            ("acronym" | "human", _) => true,
            _ => false,
        };
        if !read {
            unread(expr.text.clone(), self);
        }
    }

    fn custom(&mut self, name: &str, pattern: &Expr, replacement: &Expr) -> bool {
        let Some(replacement) = replacement.string() else { return false };
        let regex = match &pattern.kind {
            Kind::Regex(source) => {
                let insensitive = pattern.text.rsplit('/').next().is_some_and(|flags| flags.contains('i'));
                RegexBuilder::new(&source.replace("\\Z", "$").replace("\\A", "^"))
                    .case_insensitive(insensitive)
                    .build()
            }
            Kind::Str {
                value,
                interpolated: false,
            } => {
                self.uncountables.retain(|word| word != value);
                RegexBuilder::new(&format!("^{}$", regex::escape(value)))
                    .case_insensitive(true)
                    .build()
            }
            _ => return false,
        };
        let Ok(regex) = regex else { return false };
        let replacement = backreferences(replacement);
        let rules = if name == "plural" { &mut self.plurals } else { &mut self.singulars };
        rules.push((regex, replacement));
        true
    }
}

/// Ruby's `\1` replacement references as Rust's `${1}`.
fn backreferences(replacement: &str) -> String {
    let mut result = String::new();
    let mut chars = replacement.chars().peekable();
    while let Some(c) = chars.next() {
        match (c, chars.peek()) {
            ('\\', Some(d)) if d.is_ascii_digit() => {
                result.push_str(&format!("${{{d}}}"));
                chars.next();
            }
            ('$', _) => result.push_str("$$"),
            _ => result.push(c),
        }
    }
    result
}

#[cfg(test)]
mod tests;
