use super::suggest::suggestion;
use super::{Checker, NAMESPACES, Scope, Signature, concrete, element};
use crate::rules::Expression;
use crate::types::{self, Ty, assignable, join, list, map};
use cel::common::ast::{CallExpr, ComprehensionExpr, EntryExpr, Expr, IdedExpr, LiteralValue, MapExpr, SelectExpr};
use std::collections::BTreeMap;

pub(super) struct Walker<'a> {
    pub(super) checker: &'a mut Checker,
    pub(super) expression: &'a Expression,
    /// Comprehension variables, innermost last.
    pub(super) locals: Vec<(String, Ty)>,
}

impl Walker<'_> {
    pub(super) fn error(&mut self, id: u64, message: &str) {
        self.checker.diagnostics.push(self.expression.at("invalid-rules", id, message));
    }

    pub(super) fn call_error(&mut self, id: u64, name: &str, message: &str) {
        self.checker
            .diagnostics
            .push(self.expression.at_name("invalid-rules", id, name, message));
    }

    pub(super) fn local(&self, name: &str) -> Option<Ty> {
        self.locals.iter().rev().find(|(local, _)| local == name).map(|(_, ty)| ty.clone())
    }

    pub(super) fn ty(&mut self, expr: &IdedExpr, scope: &Scope) -> Ty {
        match &expr.expr {
            Expr::Literal(literal) => match literal {
                LiteralValue::Boolean(_) => Ty::Bool,
                LiteralValue::Bytes(_) => Ty::Bytes,
                LiteralValue::Double(_) => Ty::Double,
                LiteralValue::Int(_) => Ty::Int,
                LiteralValue::Null => Ty::Null,
                LiteralValue::String(_) => Ty::String,
                LiteralValue::UInt(_) => Ty::UInt,
            },
            Expr::Ident(name) => self.ident(expr.id, name, scope),
            Expr::List(items) => {
                let mut ty = Ty::Never;
                for item in &items.elements {
                    let item = self.ty(item, scope);
                    ty = join(&ty, &item);
                }
                list(ty)
            }
            Expr::Map(entries) => self.map(entries, scope),
            Expr::Struct(_) | Expr::Unspecified => Ty::Dyn,
            Expr::Select(select) => self.select(expr.id, select, scope),
            Expr::Call(call) => self.call_expr(expr.id, call, scope),
            Expr::Comprehension(comprehension) => self.comprehension(comprehension, scope),
        }
    }

    /// A map literal: a record when every key is a string literal, else a map.
    fn map(&mut self, entries: &MapExpr, scope: &Scope) -> Ty {
        let mut record = BTreeMap::new();
        let mut keys = Ty::Never;
        let mut values = Ty::Never;
        let mut literal = true;
        for entry in &entries.entries {
            if let EntryExpr::MapEntry(entry) = &entry.expr {
                let key = self.ty(&entry.key, scope);
                let mut value = self.ty(&entry.value, scope);
                if entry.optional {
                    value = match value {
                        Ty::Optional(inner) => *inner,
                        other => other,
                    };
                }
                keys = join(&keys, &key);
                values = join(&values, &value);
                match &entry.key.expr {
                    Expr::Literal(LiteralValue::String(text)) if !entry.optional => {
                        record.insert(text.inner().to_owned(), value);
                    }
                    _ => literal = false,
                }
            }
        }
        if literal { Ty::Record(record) } else { map(keys, values) }
    }

    /// A selection: `variables.<name>`, or a field of an operand.
    fn select(&mut self, id: u64, select: &SelectExpr, scope: &Scope) -> Ty {
        // `variables.name` and qualified names.
        if let Expr::Ident(root) = &select.operand.expr {
            if root == "variables" && self.local(root).is_none() {
                let name = format!("variables.{}", select.field);
                return match scope.names.get(&name) {
                    Some(ty) if select.test => {
                        let _ = ty;
                        Ty::Bool
                    }
                    Some(ty) => ty.clone(),
                    None => {
                        let hint = suggestion(&name, scope.names.keys().filter(|n| n.starts_with("variables.")).cloned());
                        self.error(id, &format!("Undeclared variable `{name}`{hint}"));
                        Ty::Dyn
                    }
                };
            }
        }
        let operand = self.ty(&select.operand, scope);
        let ty = self.field(id, &operand, &select.field, select.test);
        if select.test { Ty::Bool } else { ty }
    }

    /// A call, its namespace-qualified name resolved.
    fn call_expr(&mut self, id: u64, call: &CallExpr, scope: &Scope) -> Ty {
        // `math.greatest(...)` parses as a call on the identifier `math`.
        let qualified = match call.target.as_deref().map(|target| &target.expr) {
            Some(Expr::Ident(namespace))
                if NAMESPACES.contains(&namespace.as_str()) && self.local(namespace).is_none() && !scope.names.contains_key(namespace) =>
            {
                Some(format!("{namespace}.{}", call.func_name))
            }
            _ => None,
        };
        let target = match (&qualified, &call.target) {
            (None, Some(target)) => Some(self.ty(target, scope)),
            _ => None,
        };
        let args: Vec<Ty> = call.args.iter().map(|arg| self.ty(arg, scope)).collect();
        let name = qualified.as_deref().unwrap_or(&call.func_name);
        self.call(id, name, target, &args)
    }

    /// A comprehension (a macro's expansion): its result's type, with its
    /// variables and accumulator bound.
    fn comprehension(&mut self, comprehension: &ComprehensionExpr, scope: &Scope) -> Ty {
        let range = self.ty(&comprehension.iter_range, scope);
        let (first, second) = match (&range, &comprehension.iter_var2) {
            (Ty::List(item), Some(_)) => (Ty::Int, (**item).clone()),
            (Ty::Map(key, value), Some(_)) => ((**key).clone(), (**value).clone()),
            (Ty::Record(fields), Some(_)) => (Ty::String, fields.values().fold(Ty::Never, |acc, ty| join(&acc, ty))),
            (Ty::Record(_), None) => (Ty::String, Ty::Dyn),
            (ty, _) => (element(ty), Ty::Dyn),
        };
        let mut accumulator = self.ty(&comprehension.accu_init, scope);
        let depth = self.locals.len();
        self.locals.push((comprehension.iter_var.clone(), first));
        if let Some(second_var) = &comprehension.iter_var2 {
            self.locals.push((second_var.clone(), second));
        }
        // Two rounds find the accumulator's type: an empty list's
        // element type comes from the first step.
        for _ in 0..2 {
            self.locals.push((comprehension.accu_var.clone(), accumulator.clone()));
            let errors = self.checker.diagnostics.len();
            let step = self.ty(&comprehension.loop_step, scope);
            self.ty(&comprehension.loop_cond, scope);
            self.checker.diagnostics.truncate(errors);
            self.locals.pop();
            accumulator = join(&accumulator, &step);
        }
        self.locals.push((comprehension.accu_var.clone(), accumulator.clone()));
        self.ty(&comprehension.loop_step, scope);
        self.ty(&comprehension.loop_cond, scope);
        let result = self.ty(&comprehension.result, scope);
        self.locals.truncate(depth);
        result
    }

    pub(super) fn ident(&mut self, id: u64, name: &str, scope: &Scope) -> Ty {
        if let Some(ty) = self.local(name) {
            return ty;
        }
        if let Some(ty) = scope.names.get(name) {
            return ty.clone();
        }
        match name {
            "int" | "uint" | "double" | "string" | "bool" | "bytes" | "list" | "map" | "null_type" | "type" | "dyn" => Ty::Type,
            "variables" => {
                self.error(id, "Use `variables.<name>`");
                Ty::Dyn
            }
            // Names the macros bind internally.
            name if name.starts_with('@') => Ty::Dyn,
            _ => {
                let hint = suggestion(name, scope.names.keys().chain(self.locals.iter().map(|(name, _)| name)).cloned());
                self.error(id, &format!("Undeclared reference `{name}`{hint}"));
                Ty::Dyn
            }
        }
    }

    pub(super) fn field(&mut self, id: u64, operand: &Ty, field: &str, test: bool) -> Ty {
        match operand {
            Ty::Object(name) => match types::field(name, field) {
                Some(ty) => ty,
                None => {
                    let hint = suggestion(
                        field,
                        types::fields(name)
                            .unwrap_or_default()
                            .into_iter()
                            .map(|(field, _)| field.to_owned()),
                    );
                    self.error(id, &format!("No field `{field}` on {name}{hint}"));
                    Ty::Dyn
                }
            },
            Ty::Record(fields) => match fields.get(field) {
                Some(ty) => ty.clone(),
                None if test => Ty::Dyn,
                None => {
                    let hint = suggestion(field, fields.keys().cloned());
                    self.error(id, &format!("No field `{field}` on {operand}{hint}"));
                    Ty::Dyn
                }
            },
            Ty::Map(_, value) => (**value).clone(),
            Ty::Optional(inner) => {
                self.error(
                    id,
                    &format!("`{field}` is selected from an optional<{inner}>; use `.?{field}` or `.orValue(...)`"),
                );
                Ty::Dyn
            }
            ty if concrete(ty) && *ty != Ty::Type => {
                self.error(id, &format!("{ty} has no fields; `{field}` can't be selected"));
                Ty::Dyn
            }
            _ => Ty::Dyn,
        }
    }

    pub(super) fn arity(&mut self, id: u64, name: &str, args: &[Ty], expected: usize) -> bool {
        if args.len() == expected {
            return true;
        }
        self.call_error(
            id,
            name,
            &format!(
                "`{name}` takes {expected} argument{}, not {}",
                if expected == 1 { "" } else { "s" },
                args.len()
            ),
        );
        false
    }

    pub(super) fn signature(&mut self, id: u64, name: &str, args: &[Ty], signature: &Signature) -> Ty {
        if self.arity(id, name, args, signature.params.len()) {
            for (index, (arg, param)) in args.iter().zip(&signature.params).enumerate() {
                if !assignable(arg, param) {
                    self.call_error(id, name, &format!("Argument {} of `{name}` is {arg}, not {param}", index + 1));
                }
            }
        }
        signature.returns.clone()
    }
}
