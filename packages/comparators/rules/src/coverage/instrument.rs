//! Instrumenting an expression for coverage: probes around its decisions,
//! and around the expression itself when it is a function's body or an
//! expression of its own (not a function's variable).

use super::source::{Text, exclusions};
use super::{BRANCH, Category, Entry, Inventory, REACH};
use cel::common::ast::{CallExpr, Expr, IdedExpr, LiteralValue};
use cel::common::types::CelInt;
use std::collections::BTreeMap;

pub(super) const CONDITIONAL: &str = "_?_:_";
pub(super) const AND: &str = "_&&_";
pub(super) const OR: &str = "_||_";
/// The accumulator CEL's macros (`exists`, `all`, `exists_one`, `filter`,
/// `map`) fold into; no other comprehension can name it.
pub(super) const ACCUMULATOR: &str = "@result";

/// Collects a rules file's coverage entries as its expressions compile.
pub struct Builder {
    inventory: Inventory,
    excluded: BTreeMap<usize, String>,
}

/// One expression being instrumented.
pub struct Site<'a> {
    /// The rules file's JSON pointer of the expression.
    pub path: &'a str,
    pub text: Text<'a>,
    /// The conditionals a `match` or `cond` expanded into, by node.
    pub branches: &'a BTreeMap<u64, &'static str>,
}

impl Builder {
    /// A builder for the rules file `text`, reading its `coverage-ignore:` comments.
    pub fn new(text: &str) -> Self {
        Builder {
            inventory: Inventory::default(),
            excluded: exclusions(text),
        }
    }

    pub fn finish(self) -> Inventory {
        self.inventory
    }

    /// `expr` with probes; new nodes are numbered above `next`.
    pub fn instrument(&mut self, expr: &IdedExpr, site: &Site, next: &mut u64) -> IdedExpr {
        let mut walk = Walk { builder: self, site, next };
        let body = walk.expr(expr);
        let (category, name) = match site.path.strip_prefix("/functions/") {
            None => (Category::Expression, ""),
            Some(rest) => match rest.strip_suffix("/body") {
                Some(name) if !name.contains('/') => (Category::Function, name),
                // A function's variables run whenever it is called.
                _ => return body,
            },
        };
        let counter = walk.single(category, name, None, None);
        walk.reached(counter, body)
    }
}

pub(super) struct Walk<'b, 'a> {
    pub(super) builder: &'b mut Builder,
    pub(super) site: &'b Site<'a>,
    next: &'b mut u64,
}

pub(super) fn is_call<'e>(expr: &'e IdedExpr, name: &str, arity: usize) -> Option<&'e CallExpr> {
    match &expr.expr {
        Expr::Call(call) if call.target.is_none() && call.func_name == name && call.args.len() == arity => Some(call),
        _ => None,
    }
}

impl Walk<'_, '_> {
    pub(super) fn node(&mut self, expr: Expr) -> IdedExpr {
        *self.next += 1;
        IdedExpr { id: *self.next, expr }
    }

    fn call(&mut self, name: &str, args: Vec<IdedExpr>) -> IdedExpr {
        self.node(Expr::Call(CallExpr {
            func_name: name.to_owned(),
            target: None,
            args,
        }))
    }

    fn counter(&mut self, counter: usize) -> IdedExpr {
        let number = i64::try_from(counter).expect("counters fit an int");
        self.node(Expr::Literal(LiteralValue::Int(CelInt::from(number))))
    }

    /// `@reach(counter) ? expr : null`: counts `expr`'s evaluation, before it
    /// runs, so an expression that fails still counts.
    pub(super) fn reached(&mut self, counter: usize, expr: IdedExpr) -> IdedExpr {
        let probe = self.counter(counter);
        let probe = self.call(REACH, vec![probe]);
        let null = self.node(Expr::Literal(LiteralValue::Null));
        self.call(CONDITIONAL, vec![probe, expr, null])
    }

    /// `@branch(counter, expr)`.
    pub(super) fn branch(&mut self, counter: usize, expr: IdedExpr) -> IdedExpr {
        let probe = self.counter(counter);
        self.call(BRANCH, vec![probe, expr])
    }

    fn entry(&mut self, category: Category, name: &str, condition: Option<String>, at: Option<u32>, outcome: Option<bool>, counter: usize) {
        let (line, column) = self.site.text.line_column(at);
        self.builder.inventory.entries.push(Entry {
            category,
            path: self.site.path.to_owned(),
            line,
            column,
            name: name.to_owned(),
            condition,
            outcome,
            counter,
            excluded: self.builder.excluded.get(&line).cloned(),
        });
    }

    /// One counter and its entry.
    pub(super) fn single(&mut self, category: Category, name: &str, condition: Option<String>, at: Option<u32>) -> usize {
        let counter = self.builder.inventory.counters;
        self.builder.inventory.counters += 1;
        self.entry(category, name, condition, at, None, counter);
        counter
    }

    /// Two counters, true and false, for the decision `expr`, and an entry
    /// for each outcome listed, at `expr`, or the false one at `otherwise`.
    pub(super) fn decision(&mut self, name: &str, expr: &IdedExpr, condition: String, listed: [bool; 2]) -> usize {
        self.decision_at(name, [expr, expr], condition, listed)
    }

    fn decision_at(&mut self, name: &str, at: [&IdedExpr; 2], condition: String, listed: [bool; 2]) -> usize {
        let base = self.builder.inventory.counters;
        self.builder.inventory.counters += 2;
        for (index, outcome) in [true, false].into_iter().enumerate() {
            if listed[index] {
                let start = self.site.text.start(at[index]);
                self.entry(Category::Branch, name, Some(condition.clone()), start, Some(outcome), base + index);
            }
        }
        base
    }

    pub(super) fn expr(&mut self, expr: &IdedExpr) -> IdedExpr {
        if let Some(call) = is_call(expr, CONDITIONAL, 3) {
            return self.conditional(expr.id, call);
        }
        if is_call(expr, AND, 2).is_some() {
            return self.logical(expr, AND);
        }
        if is_call(expr, OR, 2).is_some() {
            return self.logical(expr, OR);
        }
        match &expr.expr {
            Expr::Comprehension(c) if c.accu_var == ACCUMULATOR => self.comprehension(expr),
            _ => self.children(expr),
        }
    }

    fn conditional(&mut self, id: u64, call: &CallExpr) -> IdedExpr {
        let kind = self.site.branches.get(&id).copied().unwrap_or("conditional");
        // A `match` case's condition is `subject == key`: it is about its key.
        let (decided, condition) = match is_call(&call.args[0], "_==_", 2) {
            Some(test) if kind == "match" => (&test.args[1], self.site.text.of(&test.args[1])),
            _ => (&call.args[0], self.site.text.of(&call.args[0])),
        };
        let chained = is_call(&call.args[2], CONDITIONAL, 3).is_some();
        // A `match` or `cond` falls to its default, which is where that outcome is.
        let otherwise = if kind == "conditional" { decided } else { &call.args[2] };
        let base = self.decision_at(kind, [decided, otherwise], condition, [true, !chained]);
        let test = self.expr(&call.args[0]);
        let test = self.branch(base, test);
        let args = vec![test, self.expr(&call.args[1]), self.expr(&call.args[2])];
        IdedExpr {
            id,
            expr: Expr::Call(CallExpr {
                func_name: CONDITIONAL.to_owned(),
                target: None,
                args,
            }),
        }
    }

    /// A chain of one logical operator: each operand that isn't the same
    /// operator is a decision.
    fn logical(&mut self, expr: &IdedExpr, operator: &str) -> IdedExpr {
        if let Some(call) = is_call(expr, operator, 2) {
            let args = call.args.iter().map(|arg| self.logical(arg, operator)).collect();
            return IdedExpr {
                id: expr.id,
                expr: Expr::Call(CallExpr {
                    func_name: operator.to_owned(),
                    target: None,
                    args,
                }),
            };
        }
        let condition = self.site.text.of(expr);
        let base = self.decision(if operator == AND { "and" } else { "or" }, expr, condition, [true, true]);
        let operand = self.expr(expr);
        self.branch(base, operand)
    }

    pub(super) fn predicate(&mut self, kind: &str, predicate: &IdedExpr) -> IdedExpr {
        let condition = self.site.text.of(predicate);
        let base = self.decision(kind, predicate, condition, [true, true]);
        let inner = self.expr(predicate);
        self.branch(base, inner)
    }
}
