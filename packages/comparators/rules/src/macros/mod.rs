//! Rules macros: `match`, `cond`, `collect` and `template`, expanded into
//! plain CEL when a rules file loads, after parsing and before checking and
//! cost instrumentation. They are AST rewrites, never text substitution:
//!
//! - `match(subject, {'key': value, …}, default)`: a table keyed by one value.
//!   Expands to `subject == 'key' ? value : … : default`. Keys are string or
//!   int literals, each once.
//! - `cond({condition: value, …}, default)`: ordered conditions, the first
//!   that holds wins. Expands to `condition ? value : … : default`.
//! - `collect({condition: value, …})`: the values whose conditions hold, in
//!   order. Expands to `(condition ? [value] : []) + …`.
//! - `template('… {name} …', {'name': value, …})`: named fields in a format
//!   string. Without the map, `{name}` is the function parameter `name`, or
//!   else `variables.name`. Expands to
//!   `'… %s …'.format([value, …])`; `{{` and `}}` are literal braces.
//!
//! CEL's grammar has no `=>`, so conditions are written as the keys of a map
//! literal, whose entries keep their written order. As with any conditional,
//! only the chosen branch is evaluated, and the expansion costs exactly what
//! the equivalent CEL costs.
//!
//! The expander also measures chains of conditionals as written: a chain of
//! three or more `? :` is a lint warning, since one of the macros, or a named
//! function, almost always reads better.

use cel::common::ast::{CallExpr, EntryExpr, Expr, IdedExpr, ListExpr, LiteralValue, SelectExpr, SourceInfo};
mod template;

use std::collections::{BTreeMap, BTreeSet};

/// The macros' names, which rules functions can't use.
pub const MACROS: [&str; 4] = ["match", "cond", "collect", "template"];

/// A conditional chain this long or longer is a lint warning.
pub const CHAIN_WARNING: usize = 3;

/// A `match` as written, for checking its keys against a declared domain.
pub struct MatchSite {
    /// The `match` call's node, for positions.
    pub id: u64,
    /// The subject, when it is a name (`kind`, `variables.kind`).
    pub subject: Option<String>,
    pub keys: Vec<String>,
}

/// What expanding one expression found.
#[derive(Default)]
pub struct Expansion {
    pub matches: Vec<MatchSite>,
    /// The conditionals a `match` or `cond` produced, by the macro's name:
    /// their branches must have one type.
    pub branches: BTreeMap<u64, &'static str>,
    /// Problems, by node.
    pub errors: Vec<(u64, String)>,
    /// Every maximal chain of two or more conditionals as written: (node, length).
    pub chains: Vec<(u64, usize)>,
}

/// A macro call's arguments.
type Args = std::vec::IntoIter<IdedExpr>;

struct Expander<'a> {
    info: &'a mut SourceInfo,
    params: &'a [String],
    next: u64,
    found: Expansion,
}

/// Expands the macros in `expr`, giving new nodes the position of the macro
/// call they come from.
pub fn expand(expr: IdedExpr, info: &mut SourceInfo, params: &[String]) -> (IdedExpr, Expansion) {
    let mut found = Expansion::default();
    chains(&expr, false, &mut found.chains);
    let mut expander = Expander {
        next: crate::cost::max_id(&expr) + 1,
        info,
        params,
        found,
    };
    let expr = expander.expr(expr);
    (expr, expander.found)
}

/// The length of the conditional chain starting at `expr`: it continues
/// through either branch.
fn chain(expr: &IdedExpr) -> usize {
    match &expr.expr {
        Expr::Call(call) if call.func_name == "_?_:_" && call.args.len() == 3 => 1 + chain(&call.args[1]).max(chain(&call.args[2])),
        _ => 0,
    }
}

/// Records each maximal chain of two or more conditionals.
fn chains(expr: &IdedExpr, in_chain: bool, out: &mut Vec<(u64, usize)>) {
    let conditional = matches!(&expr.expr, Expr::Call(call) if call.func_name == "_?_:_");
    if conditional && !in_chain {
        let length = chain(expr);
        if length >= 2 {
            out.push((expr.id, length));
        }
    }
    let mut visit = |child: &IdedExpr, continues: bool| chains(child, continues, out);
    match &expr.expr {
        Expr::Call(call) => {
            if let Some(target) = &call.target {
                visit(target, false);
            }
            for (index, arg) in call.args.iter().enumerate() {
                // A branch of a conditional continues its chain; its condition doesn't.
                visit(arg, conditional && index > 0);
            }
        }
        Expr::Comprehension(c) => {
            for child in [&c.iter_range, &c.accu_init, &c.loop_cond, &c.loop_step, &c.result] {
                visit(child, false);
            }
        }
        Expr::List(list) => list.elements.iter().for_each(|child| visit(child, false)),
        Expr::Map(map) => {
            for entry in &map.entries {
                if let EntryExpr::MapEntry(entry) = &entry.expr {
                    visit(&entry.key, false);
                    visit(&entry.value, false);
                }
            }
        }
        Expr::Select(select) => visit(&select.operand, false),
        _ => {}
    }
}

/// A name an expression spells: `kind`, `variables.kind`.
fn name(expr: &IdedExpr) -> Option<String> {
    match &expr.expr {
        Expr::Ident(name) => Some(name.clone()),
        Expr::Select(select) if !select.test => Some(format!("{}.{}", name(&select.operand)?, select.field)),
        _ => None,
    }
}

impl Expander<'_> {
    fn node(&mut self, at: u64, expr: Expr) -> IdedExpr {
        let id = self.next;
        self.next += 1;
        if let Some((start, stop)) = self.info.offset_for(at) {
            self.info.add_offset(id, start, stop);
        }
        IdedExpr { id, expr }
    }

    fn call(&mut self, at: u64, func_name: &str, target: Option<IdedExpr>, args: Vec<IdedExpr>) -> IdedExpr {
        self.node(
            at,
            Expr::Call(CallExpr {
                func_name: func_name.to_owned(),
                target: target.map(Box::new),
                args,
            }),
        )
    }

    fn error(&mut self, id: u64, message: impl Into<String>) {
        self.found.errors.push((id, message.into()));
    }

    /// Expands children first, then the node itself.
    fn expr(&mut self, expr: IdedExpr) -> IdedExpr {
        let IdedExpr { id, expr } = expr;
        let expr = match expr {
            Expr::Call(call) => Expr::Call(CallExpr {
                func_name: call.func_name,
                target: call.target.map(|target| Box::new(self.expr(*target))),
                args: call.args.into_iter().map(|arg| self.expr(arg)).collect(),
            }),
            Expr::Comprehension(mut c) => {
                c.iter_range = self.expr(c.iter_range);
                c.accu_init = self.expr(c.accu_init);
                c.loop_cond = self.expr(c.loop_cond);
                c.loop_step = self.expr(c.loop_step);
                c.result = self.expr(c.result);
                Expr::Comprehension(c)
            }
            Expr::List(list) => Expr::List(ListExpr {
                elements: list.elements.into_iter().map(|child| self.expr(child)).collect(),
                optional_indices: list.optional_indices,
            }),
            Expr::Map(mut map) => {
                for entry in &mut map.entries {
                    if let EntryExpr::MapEntry(entry) = &mut entry.expr {
                        entry.key = self.expr(std::mem::take(&mut entry.key));
                        entry.value = self.expr(std::mem::take(&mut entry.value));
                    }
                }
                Expr::Map(map)
            }
            Expr::Select(select) => Expr::Select(SelectExpr {
                operand: Box::new(self.expr(*select.operand)),
                field: select.field,
                test: select.test,
            }),
            other => other,
        };
        match expr {
            Expr::Call(call) if call.target.is_none() && MACROS.contains(&call.func_name.as_str()) => self.macro_call(id, call),
            expr => IdedExpr { id, expr },
        }
    }

    /// A map literal's entries, in written order, or an error.
    fn entries(&mut self, id: u64, macro_name: &str, arg: Option<IdedExpr>) -> Option<Vec<(IdedExpr, IdedExpr)>> {
        match arg.map(|arg| arg.expr) {
            Some(Expr::Map(map)) => {
                let mut entries = Vec::new();
                for entry in map.entries {
                    match entry.expr {
                        EntryExpr::MapEntry(entry) if !entry.optional => entries.push((entry.key, entry.value)),
                        _ => {
                            self.error(entry.id, format!("`{macro_name}` entries are `key: value`"));
                            return None;
                        }
                    }
                }
                Some(entries)
            }
            _ => {
                self.error(id, format!("`{macro_name}` takes a map literal: `{{key: value, …}}`"));
                None
            }
        }
    }

    fn invalid(&mut self, id: u64) -> IdedExpr {
        IdedExpr {
            id,
            expr: Expr::Literal(LiteralValue::Null),
        }
    }

    fn macro_call(&mut self, id: u64, call: CallExpr) -> IdedExpr {
        let args = call.args.into_iter();
        match call.func_name.as_str() {
            "match" => self.expand_match(id, args),
            "cond" => self.expand_cond(id, args),
            "collect" => self.expand_collect(id, args),
            "template" => self.expand_template(id, args),
            _ => unreachable!("only macros are expanded"),
        }
    }

    /// `match(subject, {'key': value, …}, default)`.
    fn expand_match(&mut self, id: u64, mut args: Args) -> IdedExpr {
        let (Some(subject), map, Some(default), None) = (args.next(), args.next(), args.next(), args.next()) else {
            self.error(
                id,
                "`match` takes a subject, a map of cases and a default: `match(subject, {'key': value, …}, default)`",
            );
            return self.invalid(id);
        };
        let Some(entries) = self.entries(id, "match", map) else {
            return self.invalid(id);
        };
        let mut keys = BTreeSet::new();
        let mut written = Vec::new();
        for (key, _) in &entries {
            let text = match &key.expr {
                Expr::Literal(LiteralValue::String(text)) => format!("'{}'", text.inner()),
                Expr::Literal(LiteralValue::Int(number)) => number.inner().to_string(),
                _ => {
                    self.error(key.id, "A `match` key is a string or int literal");
                    continue;
                }
            };
            if !keys.insert(text.clone()) {
                self.error(key.id, format!("The `match` key {text} appears twice"));
            }
            written.push(text);
        }
        self.found.matches.push(MatchSite {
            id,
            subject: name(&subject),
            keys: written,
        });
        let mut result = default;
        for (key, value) in entries.into_iter().rev() {
            let test = self.call(id, "_==_", None, vec![subject.clone(), key]);
            result = self.call(id, "_?_:_", None, vec![test, value, result]);
            self.found.branches.insert(result.id, "match");
        }
        result
    }

    /// `cond({condition: value, …}, default)`.
    fn expand_cond(&mut self, id: u64, mut args: Args) -> IdedExpr {
        let (map, Some(default), None) = (args.next(), args.next(), args.next()) else {
            self.error(
                id,
                "`cond` takes a map of conditions and a default: `cond({condition: value, …}, default)`",
            );
            return self.invalid(id);
        };
        let Some(entries) = self.entries(id, "cond", map) else {
            return self.invalid(id);
        };
        let mut result = default;
        for (condition, value) in entries.into_iter().rev() {
            result = self.call(id, "_?_:_", None, vec![condition, value, result]);
            self.found.branches.insert(result.id, "cond");
        }
        result
    }

    /// `collect({condition: value, …})`.
    fn expand_collect(&mut self, id: u64, mut args: Args) -> IdedExpr {
        let (map, None) = (args.next(), args.next()) else {
            self.error(id, "`collect` takes one map of conditions: `collect({condition: value, …})`");
            return self.invalid(id);
        };
        let Some(entries) = self.entries(id, "collect", map) else {
            return self.invalid(id);
        };
        let mut parts = Vec::new();
        for (condition, value) in entries {
            let one = self.node(id, Expr::List(ListExpr::new(vec![value])));
            let none = self.node(id, Expr::List(ListExpr::new(Vec::new())));
            parts.push(self.call(id, "_?_:_", None, vec![condition, one, none]));
        }
        let mut parts = parts.into_iter();
        match parts.next() {
            None => self.node(id, Expr::List(ListExpr::new(Vec::new()))),
            Some(first) => parts.fold(first, |sum, part| self.call(id, "_+_", None, vec![sum, part])),
        }
    }
}
