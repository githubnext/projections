//! Deterministic cost.
//!
//! CEL terminates, but a terminating expression can still take 10¹² steps or
//! build a value of gigabytes. Every expression is instrumented when it is
//! compiled: each call (operators, functions, and the steps of `map`,
//! `filter`, `all` and `exists`, which are calls too) is wrapped in `@cost`,
//! which charges one unit plus the size of the value the call produced
//! (characters of a string, entries of a list or map). The interpreter adds
//! one unit per expression it evaluates. The total depends only on the rules
//! and the input, never on the host or its speed, and a comparison that
//! exceeds its budget fails with `cost-limit`.

use cel::common::ast::{CallExpr, EntryExpr, Expr, IdedExpr};
use cel::common::value::{CowVal, Val};
use cel::{Context, ExecutionError, FunctionContext};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

/// The cost units one comparison may spend.
pub const DEFAULT_BUDGET: u64 = 200_000_000;

/// The name of the instrumentation function; CEL can't spell it.
pub const COST: &str = "@cost";

#[derive(Debug)]
pub struct Meter {
    used: AtomicU64,
    budget: u64,
}

impl Meter {
    pub fn new(budget: u64) -> Arc<Self> {
        Arc::new(Meter {
            used: AtomicU64::new(0),
            budget,
        })
    }

    pub fn used(&self) -> u64 {
        self.used.load(Ordering::Relaxed)
    }

    pub fn exceeded(&self) -> bool {
        self.used() > self.budget
    }

    /// Charges `units`; past the budget, every charge fails.
    pub fn charge(&self, units: u64) -> Result<(), String> {
        let used = self.used.fetch_add(units, Ordering::Relaxed).saturating_add(units);
        if used > self.budget {
            Err(format!("The rules exceeded their cost budget of {} units", self.budget))
        } else {
            Ok(())
        }
    }
}

fn size(value: &dyn Val) -> u64 {
    if let Some(text) = value.downcast_ref::<cel::common::types::CelString>() {
        return text.inner().len() as u64;
    }
    if value.as_iterable().is_some() {
        if let Some(sizer) = value.as_sizer() {
            return u64::try_from(sizer.size().into_inner()).unwrap_or(0);
        }
    }
    0
}

/// Registers `@cost` on a root scope.
pub fn register(scope: &mut Context, meter: Arc<Meter>) {
    type Native = Box<dyn for<'c, 'v> Fn(&mut FunctionContext<'c, 'v>) -> Result<CowVal<'c, 'v>, ExecutionError> + Send + Sync>;
    let native: Native = Box::new(move |ftx| {
        let value = ftx.args.pop().ok_or_else(|| ftx.error("expected one argument"))?;
        meter.charge(1 + size(value.as_ref())).map_err(|message| ftx.error(message))?;
        Ok(value)
    });
    scope
        .add_function(COST, native)
        .expect("`@cost` doesn't clash with CEL's functions");
}

/// `expr` with every call wrapped in `@cost`. New nodes get IDs above `next`.
pub fn instrument(expr: &IdedExpr, next: &mut u64) -> IdedExpr {
    let mut walk = |expr: &IdedExpr| instrument(expr, next);
    let inner = match &expr.expr {
        Expr::Call(call) => Expr::Call(CallExpr {
            func_name: call.func_name.clone(),
            target: call.target.as_ref().map(|target| Box::new(walk(target))),
            args: call.args.iter().map(&mut walk).collect(),
        }),
        Expr::Comprehension(comprehension) => {
            let mut comprehension = comprehension.as_ref().clone();
            comprehension.iter_range = walk(&comprehension.iter_range);
            comprehension.accu_init = walk(&comprehension.accu_init);
            comprehension.loop_cond = walk(&comprehension.loop_cond);
            comprehension.loop_step = walk(&comprehension.loop_step);
            comprehension.result = walk(&comprehension.result);
            Expr::Comprehension(Box::new(comprehension))
        }
        Expr::List(items) => {
            let mut items = items.clone();
            items.elements = items.elements.iter().map(&mut walk).collect();
            Expr::List(items)
        }
        Expr::Map(map) => {
            let mut map = map.clone();
            for entry in &mut map.entries {
                if let EntryExpr::MapEntry(entry) = &mut entry.expr {
                    entry.key = walk(&entry.key);
                    entry.value = walk(&entry.value);
                }
            }
            Expr::Map(map)
        }
        Expr::Struct(structure) => {
            let mut structure = structure.clone();
            for entry in &mut structure.entries {
                if let EntryExpr::StructField(field) = &mut entry.expr {
                    field.value = walk(&field.value);
                }
            }
            Expr::Struct(structure)
        }
        Expr::Select(select) => {
            let mut select = select.clone();
            select.operand = Box::new(walk(&select.operand));
            Expr::Select(select)
        }
        other => other.clone(),
    };
    let node = IdedExpr { id: expr.id, expr: inner };
    if !matches!(&node.expr, Expr::Call(call) if !unmetered(call)) {
        return node;
    }
    *next += 1;
    IdedExpr {
        id: *next,
        expr: Expr::Call(CallExpr {
            func_name: COST.to_owned(),
            target: None,
            args: vec![node],
        }),
    }
}

/// Coverage probes, and the conditional `@reach(n) ? e : null` that counts
/// `e`, cost nothing, so a covered comparison costs what a normal one does.
fn unmetered(call: &CallExpr) -> bool {
    crate::coverage::is_probe(&call.func_name)
        || call.func_name == "_?_:_" && matches!(&call.args[0].expr, Expr::Call(test) if test.func_name == crate::coverage::REACH)
}

/// The highest node ID in `expr`.
pub fn max_id(expr: &IdedExpr) -> u64 {
    let mut max = expr.id;
    let mut visit = |child: &IdedExpr| max = max.max(max_id(child));
    match &expr.expr {
        Expr::Call(call) => {
            if let Some(target) = &call.target {
                visit(target);
            }
            call.args.iter().for_each(&mut visit);
        }
        Expr::Comprehension(c) => {
            for child in [&c.iter_range, &c.accu_init, &c.loop_cond, &c.loop_step, &c.result] {
                visit(child);
            }
        }
        Expr::List(items) => items.elements.iter().for_each(&mut visit),
        Expr::Map(map) => {
            for entry in &map.entries {
                if let EntryExpr::MapEntry(entry) = &entry.expr {
                    visit(&entry.key);
                    visit(&entry.value);
                }
            }
        }
        Expr::Struct(structure) => {
            for entry in &structure.entries {
                if let EntryExpr::StructField(field) = &entry.expr {
                    visit(&field.value);
                }
            }
        }
        Expr::Select(select) => visit(&select.operand),
        _ => {}
    }
    max
}
