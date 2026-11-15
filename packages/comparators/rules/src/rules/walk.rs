use cel::common::ast::{Expr, IdedExpr};
use std::collections::BTreeSet;

/// The identifiers and function names an expression mentions.
pub fn names(expr: &IdedExpr, out: &mut BTreeSet<String>) {
    let mut visit = |child: &IdedExpr| names(child, out);
    match &expr.expr {
        Expr::Ident(name) => {
            out.insert(name.clone());
        }
        Expr::Call(call) => {
            if let Some(target) = &call.target {
                visit(target);
            }
            call.args.iter().for_each(&mut visit);
            out.insert(call.func_name.clone());
        }
        Expr::Comprehension(c) => {
            for child in [&c.iter_range, &c.accu_init, &c.loop_cond, &c.loop_step, &c.result] {
                visit(child);
            }
        }
        Expr::List(items) => items.elements.iter().for_each(&mut visit),
        Expr::Map(map) => {
            for entry in &map.entries {
                if let cel::common::ast::EntryExpr::MapEntry(entry) = &entry.expr {
                    visit(&entry.key);
                    visit(&entry.value);
                }
            }
        }
        Expr::Select(select) => visit(&select.operand),
        _ => {}
    }
}

/// The author functions an expression calls, by name: global calls only, since
/// `graph.entity(…)` is a library function, not an author `entity`.
pub fn calls(expr: &IdedExpr, out: &mut BTreeSet<String>) {
    let mut visit = |child: &IdedExpr| calls(child, out);
    match &expr.expr {
        Expr::Call(call) => {
            if let Some(target) = &call.target {
                visit(target);
            }
            call.args.iter().for_each(&mut visit);
            if call.target.is_none() {
                out.insert(call.func_name.clone());
            }
        }
        Expr::Comprehension(c) => {
            for child in [&c.iter_range, &c.accu_init, &c.loop_cond, &c.loop_step, &c.result] {
                visit(child);
            }
        }
        Expr::List(items) => items.elements.iter().for_each(&mut visit),
        Expr::Map(map) => {
            for entry in &map.entries {
                if let cel::common::ast::EntryExpr::MapEntry(entry) = &entry.expr {
                    visit(&entry.key);
                    visit(&entry.value);
                }
            }
        }
        Expr::Select(select) => visit(&select.operand),
        _ => {}
    }
}
