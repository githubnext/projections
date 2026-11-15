//! Rule coverage: which parts of a rules file a set of comparisons exercised.
//!
//! Coverage is opt-in ([`crate::Comparator::with_coverage`]). A comparator
//! read for it compiles every expression with probes ([`Builder`]); a normal
//! one has none, so ordinary comparisons pay nothing. Three things are
//! counted:
//!
//! - **functions**: each of the file's functions, when its body runs;
//! - **expressions**: every expression outside a function (checks, variables,
//!   identity passes, classify, steps, metadata) when it is evaluated; a
//!   check's `message` only runs when the check fails;
//! - **branches**: each outcome of every decision: a conditional's (and so a
//!   `match`, `cond` or `collect` arm's) condition true and false, each operand
//!   of `&&` and `||` true and false, the predicate of `exists`, `all`,
//!   `exists_one` and `filter` true and false, and `map` evaluating its
//!   body. A conditional's false outcome isn't listed when its else branch is
//!   another conditional: reaching that one is the same thing.
//!
//! Probes are calls of functions CEL can't spell (`@reach`, `@branch`) that
//! count and pass their value through, so a covered comparison is the same as
//! a normal one and costs the same units. Counts are sums, so they don't
//! depend on threads or timing. A line whose comment says
//! `coverage-ignore: <reason>` (a YAML `#` comment, or a CEL `//` comment in a
//! block) excludes what is on it, or on the next line when the comment is a
//! line of its own.

mod comprehension;
mod instrument;
mod source;

pub(crate) use instrument::{Builder, Site};
pub(crate) use source::Text;

use cel::common::types::{CelBool, CelInt};
use cel::common::value::CowVal;
use cel::{Context, ExecutionError, FunctionContext};
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::yaml::coverage::FORMAT;

/// `@reach(n)`: counts `n` and is `true`; `@reach(n) ? e : null` counts `e`.
pub(crate) const REACH: &str = "@reach";
/// `@branch(n, b)`: counts `n` when `b` is true, `n + 1` when false, and is `b`.
pub(crate) const BRANCH: &str = "@branch";

/// Whether a call is a probe, which cost instrumentation leaves unwrapped.
pub(crate) fn is_probe(name: &str) -> bool {
    name == REACH || name == BRANCH
}

/// What an entry counts.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Category {
    Function,
    Expression,
    Branch,
}

/// One thing coverage counts, where it is in the rules file.
#[derive(Clone)]
pub struct Entry {
    pub category: Category,
    /// The rules file's JSON pointer of the expression it is in.
    pub path: String,
    pub line: usize,
    pub column: usize,
    /// A function's name; a branch's decision: `conditional`, `match`,
    /// `cond`, `collect`, `and`, `or`, `exists`, `all`, `exists_one`,
    /// `filter` or `map`; empty for an expression.
    pub name: String,
    /// A branch's condition as written (shortened), or a `match` case's key.
    pub condition: Option<String>,
    /// The branch's outcome; `None` for `map` and the other categories.
    pub outcome: Option<bool>,
    pub counter: usize,
    /// Why it is excluded, from a `coverage-ignore:` comment.
    pub excluded: Option<String>,
}

/// Every entry of a rules file, and how many counters they use.
#[derive(Default)]
pub struct Inventory {
    pub entries: Vec<Entry>,
    pub counters: usize,
}

/// A rules file's inventory with its counts.
pub struct Counters {
    inventory: Inventory,
    counts: Vec<AtomicU64>,
}

type Native = Box<dyn for<'c, 'v> Fn(&mut FunctionContext<'c, 'v>) -> Result<CowVal<'c, 'v>, ExecutionError> + Send + Sync>;

fn counter(ftx: &FunctionContext, index: usize) -> Result<usize, ExecutionError> {
    ftx.args
        .get(index)
        .and_then(|value| value.downcast_ref::<CelInt>())
        .and_then(|number| usize::try_from(*number.inner()).ok())
        .ok_or_else(|| ftx.error("a coverage probe takes its counter first"))
}

impl Counters {
    pub fn new(inventory: Inventory) -> Arc<Self> {
        let counts = (0..inventory.counters).map(|_| AtomicU64::new(0)).collect();
        Arc::new(Counters { inventory, counts })
    }

    fn count(&self, index: usize) {
        if let Some(count) = self.counts.get(index) {
            count.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Registers the probes on a root scope.
    pub fn register(self: &Arc<Self>, scope: &mut Context) {
        let counters = self.clone();
        let reach: Native = Box::new(move |ftx| {
            counters.count(counter(ftx, 0)?);
            Ok(CowVal::Owned(Box::new(CelBool::from(true))))
        });
        let counters = self.clone();
        let branch: Native = Box::new(move |ftx| {
            let index = counter(ftx, 0)?;
            if ftx.args.len() != 2 {
                return Err(ftx.error("a branch probe takes a counter and a value"));
            }
            let value = ftx.args.pop().expect("two arguments");
            if let Some(flag) = value.downcast_ref::<CelBool>() {
                counters.count(index + usize::from(!*flag.inner()));
            }
            Ok(value)
        });
        scope
            .add_function(REACH, reach)
            .expect("`@reach` doesn't clash with CEL's functions");
        scope
            .add_function(BRANCH, branch)
            .expect("`@branch` doesn't clash with CEL's functions");
    }

    /// The report: `{format, version, functions, expressions, branches}`,
    /// each a list of entries with their `count`.
    pub fn to_json(&self) -> Value {
        let list = |category: Category| -> Vec<Value> {
            self.inventory
                .entries
                .iter()
                .filter(|entry| entry.category == category)
                .map(|entry| self.entry_json(entry))
                .collect()
        };
        json!({"format": FORMAT, "version": 0, "functions": list(Category::Function),
            "expressions": list(Category::Expression), "branches": list(Category::Branch)})
    }

    fn entry_json(&self, entry: &Entry) -> Value {
        let mut value = json!({"path": entry.path, "line": entry.line, "column": entry.column});
        match entry.category {
            Category::Function => value["name"] = json!(entry.name),
            Category::Branch => value["kind"] = json!(entry.name),
            Category::Expression => {}
        }
        if let Some(condition) = &entry.condition {
            value["condition"] = json!(condition);
        }
        if let Some(outcome) = entry.outcome {
            value["outcome"] = json!(outcome);
        }
        if let Some(reason) = &entry.excluded {
            value["excluded"] = json!(reason);
        }
        value["count"] = json!(self.counts[entry.counter].load(Ordering::Relaxed));
        value
    }
}
