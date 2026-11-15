//! Evaluating compiled expressions.
//!
//! The root scope holds the inputs, lent through a resolver (binding a large
//! value as a variable or passing it by value would copy it), the library,
//! the file's functions and `@cost`. Sections evaluate in child scopes with
//! their own variables. A function body runs in a child of the root with only
//! its parameters and its own variables, so it can't see its caller's.

use crate::rules::{Expression, Function, Variable};
use crate::value::to_json;
use cel::common::ast::IdedExpr;
use cel::common::types::{CelBool, CelDouble, CelInt, CelList, CelMap, CelMapKey, CelNull, CelString, CelUInt};
use cel::common::value::{CowVal, Val};
use cel::context::VariableResolver;
use cel::extractors::Arguments;
use cel::{Context, ExecutionError, FunctionContext, Value as Cel};
use projections_engine::Failure;
use std::collections::HashMap;
use std::sync::Arc;

/// Variables lent to expressions without copying.
#[derive(Default)]
pub struct Vars(HashMap<String, Box<dyn Val>>);

impl Vars {
    pub fn new<'a>(values: impl IntoIterator<Item = (&'a str, Cel)>) -> Self {
        let mut vars = Vars::default();
        for (name, value) in values {
            vars.insert(name, value);
        }
        vars
    }

    pub fn insert(&mut self, name: &str, value: Cel) {
        let value: Box<dyn Val> = value.try_into().expect("JSON values convert");
        self.0.insert(name.to_owned(), value);
    }
}

impl VariableResolver for Vars {
    fn resolve<'b>(&'b self, variable: &str) -> Option<CowVal<'b, 'b>> {
        self.0.get(variable).map(|value| CowVal::Borrowed(value.as_ref()))
    }
}

/// A function's parameters, bound to its arguments without copying them.
struct Params<'a, 'b, 'v> {
    names: &'a [String],
    args: &'a [CowVal<'b, 'v>],
}

impl VariableResolver for Params<'_, '_, '_> {
    fn resolve<'c>(&'c self, variable: &str) -> Option<CowVal<'c, 'c>> {
        let index = self.names.iter().position(|name| name == variable)?;
        Some(CowVal::Borrowed(self.args[index].as_ref()))
    }
}

/// Runs `expression` in `scope`.
pub fn run(scope: &Context, expression: &Expression) -> Result<Cel, Failure> {
    Cel::resolve(&expression.program, scope).map_err(|error| expression.fail("rules-evaluation", &error.to_string()))
}

/// Runs `expression` in a child of `scope` with `small` values bound.
pub fn evaluate(scope: &Context, small: &[(&str, Cel)], expression: &Expression) -> Result<Cel, Failure> {
    if small.is_empty() {
        return run(scope, expression);
    }
    let mut child = scope.new_inner_scope();
    for (name, value) in small {
        child.add_variable_from_value(*name, value.clone());
    }
    run(&child, expression)
}

/// Evaluates `variables` in order, adding each to `scope` as `variables.<name>`.
pub fn bind(scope: &mut Context, variables: &[Variable]) -> Result<(), Failure> {
    for variable in variables {
        let fail = |error: ExecutionError| variable.expression.fail("rules-evaluation", &error.to_string());
        let value = resolve(&variable.expression.program, scope)
            .and_then(|value| detach(value.as_ref()))
            .map_err(fail)?;
        scope.add_variable_as_val(format!("variables.{}", variable.name), value);
    }
    Ok(())
}

/// `Value::resolve_val`, kept out of line: it is `#[inline(always)]`, and
/// inlined into a function call's closure it would make every nested call's
/// stack frame as large as the whole evaluator's.
#[inline(never)]
fn resolve<'e, 'p, 'v>(expression: &'e IdedExpr, scope: &'e Context<'p, 'v>) -> Result<CowVal<'e, 'v>, ExecutionError> {
    Cel::resolve_val(expression, scope)
}

/// An owned copy of a value that may borrow its scope's data, made in one
/// pass. (Converting through `Value` and back copies, and rehashes maps, twice.)
pub fn detach(value: &dyn Val) -> Result<Box<dyn Val>, ExecutionError> {
    if let Some(text) = value.downcast_ref::<CelString>() {
        return Ok(Box::new(CelString::from(text.inner().to_owned())));
    }
    if let Some(list) = value.downcast_ref::<CelList>() {
        let items = list
            .inner()
            .iter()
            .map(|item| detach(item.as_ref()))
            .collect::<Result<Vec<_>, _>>()?;
        return Ok(Box::new(CelList::from(items)));
    }
    if let Some(map) = value.downcast_ref::<CelMap>() {
        let mut entries = HashMap::with_capacity(map.inner().len());
        for (key, item) in map.inner() {
            let key = match key {
                CelMapKey::String(text) => CelMapKey::String(CelString::from(text.inner().to_owned())),
                CelMapKey::Bool(flag) => CelMapKey::Bool(CelBool::from(*flag.inner())),
                CelMapKey::Int(number) => CelMapKey::Int(CelInt::from(*number.inner())),
                CelMapKey::UInt(number) => CelMapKey::UInt(CelUInt::from(*number.inner())),
            };
            entries.insert(key, detach(item.as_ref())?);
        }
        return Ok(Box::new(CelMap::from(entries)));
    }
    if let Some(flag) = value.downcast_ref::<CelBool>() {
        return Ok(Box::new(CelBool::from(*flag.inner())));
    }
    if let Some(number) = value.downcast_ref::<CelInt>() {
        return Ok(Box::new(CelInt::from(*number.inner())));
    }
    if let Some(number) = value.downcast_ref::<CelDouble>() {
        return Ok(Box::new(CelDouble::from(*number.inner())));
    }
    if let Some(number) = value.downcast_ref::<CelUInt>() {
        return Ok(Box::new(CelUInt::from(*number.inner())));
    }
    if value.downcast_ref::<CelNull>().is_some() {
        return Ok(Box::new(CelNull));
    }
    // Optionals, types and the rest: through `Value`.
    Cel::try_from(value)?.try_into()
}

pub fn json(expression: &Expression, value: &Cel) -> Result<serde_json::Value, Failure> {
    to_json(value).map_err(|error| expression.fail("rules-evaluation", &error))
}

fn root<'a, 'v>(mut scope: &'a Context<'a, 'v>) -> &'a Context<'a, 'v> {
    while let Context::Child { parent, .. } = scope {
        scope = parent;
    }
    scope
}

type Native = Box<dyn for<'c, 'v> Fn(&mut FunctionContext<'c, 'v>) -> Result<CowVal<'c, 'v>, ExecutionError> + Send + Sync>;

struct Compiled {
    name: String,
    params: Vec<String>,
    variables: Vec<(String, Arc<IdedExpr>)>,
    body: Arc<IdedExpr>,
}

/// Registers a rules function on the root scope.
pub fn define(scope: &mut Context, function: &Function) {
    let compiled = Compiled {
        name: function.name.clone(),
        params: function.params.iter().map(|param| param.name.clone()).collect(),
        variables: function
            .variables
            .iter()
            .map(|variable| (format!("variables.{}", variable.name), variable.expression.program.clone()))
            .collect(),
        body: function.body.program.clone(),
    };
    let native: Native = Box::new(move |ftx| {
        if ftx.this.is_some() || ftx.args.len() != compiled.params.len() {
            return Err(ftx.error(format!(
                "{} takes {} arguments, not {}",
                compiled.name,
                compiled.params.len(),
                ftx.args.len() + usize::from(ftx.this.is_some())
            )));
        }
        let resolver = Params {
            names: &compiled.params,
            args: &ftx.args,
        };
        let mut child = root(ftx.ptx).new_inner_scope();
        child.set_variable_resolver(&resolver);
        for (name, expression) in &compiled.variables {
            let value = detach(resolve(expression, &child)?.as_ref())?;
            child.add_variable_as_val(name.clone(), value);
        }
        Ok(CowVal::Owned(detach(resolve(&compiled.body, &child)?.as_ref())?))
    });
    scope
        .add_function(&function.name, native)
        .expect("the parser rejects names that clash with CEL's");
}

/// Registers a library function on the root scope.
pub fn operator(scope: &mut Context, name: &'static str, operator: impl Fn(&[Cel]) -> Result<Cel, String> + Send + Sync + 'static) {
    scope
        .add_function(
            name,
            move |ftx: &FunctionContext, Arguments(args): Arguments| -> Result<Cel, ExecutionError> {
                operator(&args).map_err(|message| ftx.error(message))
            },
        )
        .unwrap_or_else(|error| panic!("{error:?}"));
}
