//! Instrumenting what isn't a decision itself: the macros' comprehensions,
//! whose predicates and `map` bodies are decisions, and every other node,
//! whose children may hold some.

use super::Category;
use super::instrument::{ACCUMULATOR, AND, CONDITIONAL, OR, Walk, is_call};
use cel::common::ast::{CallExpr, ComprehensionExpr, EntryExpr, Expr, IdedExpr, ListExpr};

fn is_accumulator(expr: &IdedExpr) -> bool {
    matches!(&expr.expr, Expr::Ident(name) if name == ACCUMULATOR)
}

fn call(id: u64, name: &str, args: Vec<IdedExpr>) -> IdedExpr {
    IdedExpr {
        id,
        expr: Expr::Call(CallExpr {
            func_name: name.to_owned(),
            target: None,
            args,
        }),
    }
}

impl Walk<'_, '_> {
    /// A macro's comprehension. Its loop step is the macro's: `@result || p`
    /// (`exists`), `@result && p` (`all`), `p ? @result + 1 : @result`
    /// (`exists_one`), `p ? @result + [x] : @result` (`filter`, and `map`
    /// with a filter) or `@result + [f]` (`map`). The step's own operators
    /// aren't decisions; `p` is, and `map`'s `f` is counted when it runs.
    pub(super) fn comprehension(&mut self, expr: &IdedExpr) -> IdedExpr {
        let Expr::Comprehension(c) = &expr.expr else {
            unreachable!("a comprehension")
        };
        let mut walked: ComprehensionExpr = c.as_ref().clone();
        walked.iter_range = self.expr(&c.iter_range);
        let step = &c.loop_step;
        walked.loop_step = match [OR, AND]
            .into_iter()
            .find_map(|operator| is_call(step, operator, 2).map(|found| (operator, found)))
        {
            Some((operator, found)) if is_accumulator(&found.args[0]) => {
                let predicate = self.predicate(if operator == OR { "exists" } else { "all" }, &found.args[1]);
                call(step.id, operator, vec![found.args[0].clone(), predicate])
            }
            _ => match is_call(step, CONDITIONAL, 3) {
                Some(found) if is_accumulator(&found.args[2]) => {
                    let counts = matches!(is_call(&found.args[1], "_+_", 2), Some(add) if matches!(add.args[1].expr, Expr::Literal(_)));
                    let predicate = self.predicate(if counts { "exists_one" } else { "filter" }, &found.args[0]);
                    let append = self.append(&found.args[1], false);
                    call(step.id, CONDITIONAL, vec![predicate, append, found.args[2].clone()])
                }
                _ => self.append(step, true),
            },
        };
        IdedExpr {
            id: expr.id,
            expr: Expr::Comprehension(Box::new(walked)),
        }
    }

    /// `@result + [items]` with each item instrumented, and counted as a `map`
    /// body when `counted`; any other step as it is.
    fn append(&mut self, step: &IdedExpr, counted: bool) -> IdedExpr {
        let Some(add) = is_call(step, "_+_", 2).filter(|add| is_accumulator(&add.args[0])) else {
            return step.clone();
        };
        let Expr::List(list) = &add.args[1].expr else {
            return step.clone();
        };
        let mut elements = Vec::new();
        for item in &list.elements {
            let walked = self.expr(item);
            elements.push(if counted {
                let condition = self.site.text.of(item);
                let at = self.site.text.start(item);
                let counter = self.single(Category::Branch, "map", Some(condition), at);
                self.reached(counter, walked)
            } else {
                walked
            });
        }
        let items = IdedExpr {
            id: add.args[1].id,
            expr: Expr::List(ListExpr {
                elements,
                optional_indices: list.optional_indices.clone(),
            }),
        };
        call(step.id, "_+_", vec![add.args[0].clone(), items])
    }

    /// A node that isn't a decision, with its children instrumented.
    pub(super) fn children(&mut self, expr: &IdedExpr) -> IdedExpr {
        let inner = match &expr.expr {
            Expr::Call(found) => Expr::Call(CallExpr {
                func_name: found.func_name.clone(),
                target: found.target.as_ref().map(|target| Box::new(self.expr(target))),
                args: found.args.iter().map(|arg| self.expr(arg)).collect(),
            }),
            Expr::Comprehension(c) => {
                let mut walked = c.as_ref().clone();
                for (to, from) in [
                    (&mut walked.iter_range, &c.iter_range),
                    (&mut walked.accu_init, &c.accu_init),
                    (&mut walked.loop_cond, &c.loop_cond),
                    (&mut walked.loop_step, &c.loop_step),
                    (&mut walked.result, &c.result),
                ] {
                    *to = self.expr(from);
                }
                Expr::Comprehension(Box::new(walked))
            }
            Expr::List(list) => Expr::List(ListExpr {
                elements: list.elements.iter().map(|item| self.expr(item)).collect(),
                optional_indices: list.optional_indices.clone(),
            }),
            Expr::Map(map) => {
                let mut map = map.clone();
                for entry in &mut map.entries {
                    if let EntryExpr::MapEntry(entry) = &mut entry.expr {
                        entry.key = self.expr(&entry.key);
                        entry.value = self.expr(&entry.value);
                    }
                }
                Expr::Map(map)
            }
            Expr::Struct(structure) => {
                let mut structure = structure.clone();
                for entry in &mut structure.entries {
                    if let EntryExpr::StructField(field) = &mut entry.expr {
                        field.value = self.expr(&field.value);
                    }
                }
                Expr::Struct(structure)
            }
            Expr::Select(select) => {
                let mut select = select.clone();
                select.operand = Box::new(self.expr(&select.operand));
                Expr::Select(select)
            }
            other => other.clone(),
        };
        IdedExpr { id: expr.id, expr: inner }
    }
}
