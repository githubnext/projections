use super::suggest::suggestion;
use super::walker::Walker;
use super::{CEL, Signature, concrete, known, numeric};
use crate::library;
use crate::types::{self, Ty, join, list};

impl Walker<'_> {
    pub(super) fn call(&mut self, id: u64, name: &str, target: Option<Ty>, args: &[Ty]) -> Ty {
        if let Some(signature) = self.checker.functions.get(name).cloned() {
            if target.is_some() {
                self.error(id, &format!("`{name}` is a function, not a method"));
            }
            return self.signature(id, name, args, &signature);
        }
        if let Some(function) = library::function(name) {
            let signature = Signature {
                params: (function.params)(),
                returns: (function.returns)(),
            };
            return self.signature(id, name, args, &signature);
        }
        if let Some(ty) = self.operator(id, name, args) {
            return ty;
        }
        if let Some(ty) = builtin(name, target, args) {
            return ty;
        }
        match name {
            name if known(name) || name.starts_with('@') => Ty::Dyn,
            name => {
                let candidates = self
                    .checker
                    .functions
                    .keys()
                    .cloned()
                    .chain(library::LIBRARY.iter().map(|function| function.name.to_owned()))
                    .chain(CEL.iter().map(|name| name.to_string()));
                let hint = suggestion(name, candidates);
                self.call_error(id, name, &format!("Undeclared function `{name}`{hint}"));
                Ty::Dyn
            }
        }
    }

    /// The type of an operator call (`_+_`, `_[_]`, `_?_:_` and so on),
    /// reporting operands it has no overload for; none for other names.
    fn operator(&mut self, id: u64, name: &str, args: &[Ty]) -> Option<Ty> {
        let first = || args.first().cloned().unwrap_or(Ty::Dyn);
        let second = || args.get(1).cloned().unwrap_or(Ty::Dyn);
        Some(match name {
            "_+_" => {
                let (a, b) = (first(), second());
                match (&a, &b) {
                    (Ty::List(_), Ty::List(_)) => join(&a, &b),
                    (a, b) if a == b && matches!(a, Ty::String | Ty::Int | Ty::UInt | Ty::Double | Ty::Bytes) => a.clone(),
                    (a, b) if concrete(a) && concrete(b) => {
                        self.error(id, &format!("No overload for `+` on ({a}, {b})"));
                        Ty::Dyn
                    }
                    (a, b) => join(a, b),
                }
            }
            "_-_" | "_*_" | "_/_" | "_%_" => {
                let (a, b) = (first(), second());
                if concrete(&a) && concrete(&b) && (a != b || !numeric(&a)) {
                    let operator = &name[1..name.len() - 1];
                    self.error(id, &format!("No overload for `{operator}` on ({a}, {b})"));
                    return Some(Ty::Dyn);
                }
                join(&a, &b)
            }
            "-_" => first(),
            "!_" | "_&&_" | "_||_" | "@not_strictly_false" => Ty::Bool,
            "_==_" | "_!=_" | "@in" => Ty::Bool,
            "_<_" | "_<=_" | "_>_" | "_>=_" => {
                let (a, b) = (first(), second());
                let comparable = |ty: &Ty| numeric(ty) || matches!(ty, Ty::String | Ty::Bool | Ty::Bytes);
                if concrete(&a) && concrete(&b) && (!comparable(&a) || !comparable(&b) || (a != b && !(numeric(&a) && numeric(&b)))) {
                    self.error(id, &format!("No overload for `{}` on ({a}, {b})", &name[1..name.len() - 1]));
                }
                Ty::Bool
            }
            "_?_:_" => {
                let condition = first();
                if concrete(&condition) && condition != Ty::Bool {
                    self.error(id, &format!("A condition must be a bool, not {condition}"));
                }
                let (then, otherwise) = (second(), args.get(2).cloned().unwrap_or(Ty::Dyn));
                let joined = join(&then, &otherwise);
                // A `match` or `cond` has one result type: its branches must agree.
                if let Some(macro_name) = self.expression.branches.get(&id) {
                    if concrete(&then) && concrete(&otherwise) && joined == Ty::Dyn {
                        self.error(id, &format!("`{macro_name}` branches have different types: {then} and {otherwise}"));
                    }
                }
                joined
            }
            "_[_]" => {
                let (container, key) = (first(), second());
                match &container {
                    Ty::List(item) => {
                        if concrete(&key) && key != Ty::Int && key != Ty::UInt {
                            self.error(id, &format!("A list index must be an int, not {key}"));
                        }
                        (**item).clone()
                    }
                    Ty::Map(_, value) => (**value).clone(),
                    Ty::Object(object) => types::fields(object)
                        .unwrap_or_default()
                        .into_iter()
                        .fold(Ty::Never, |acc, (_, ty)| join(&acc, &ty)),
                    Ty::Record(fields) => fields.values().fold(Ty::Never, |acc, ty| join(&acc, ty)),
                    _ => Ty::Dyn,
                }
            }
            "_[?_]" => Ty::Optional(Box::new(match first() {
                Ty::List(item) => *item,
                Ty::Map(_, value) => *value,
                _ => Ty::Dyn,
            })),
            "_?._" => Ty::Optional(Box::new(Ty::Dyn)),
            _ => return None,
        })
    }
}

/// The result type of one of CEL's own functions, by its target and
/// arguments; none for other names.
fn builtin(name: &str, target: Option<Ty>, args: &[Ty]) -> Option<Ty> {
    let first = || args.first().cloned().unwrap_or(Ty::Dyn);
    Some(match name {
        "size" => Ty::Int,
        "type" => Ty::Type,
        "int" => Ty::Int,
        "uint" => Ty::UInt,
        "double" => Ty::Double,
        "string" => Ty::String,
        "bool" => Ty::Bool,
        "bytes" => Ty::Bytes,
        "dyn" => first(),
        "matches" | "contains" | "startsWith" | "endsWith" | "hasValue" | "math.isInf" | "math.isNaN" | "math.isFinite" => Ty::Bool,
        "charAt" | "lowerAscii" | "upperAscii" | "trim" | "replace" | "substring" | "format" | "strings.quote" => Ty::String,
        "indexOf" | "lastIndexOf" => Ty::Int,
        "split" => list(Ty::String),
        "join" => Ty::String,
        "reverse" => match &target {
            Some(Ty::String) => Ty::String,
            Some(ty) => ty.clone(),
            None => Ty::Dyn,
        },
        "distinct" | "sort" | "slice" | "@sortByAssociatedKeys" => target.unwrap_or(Ty::Dyn),
        "flatten" => match target {
            Some(Ty::List(item)) => match *item {
                Ty::List(inner) => Ty::List(inner),
                Ty::Never => list(Ty::Never),
                _ => list(Ty::Dyn),
            },
            _ => list(Ty::Dyn),
        },
        "lists.range" => list(Ty::Int),
        "math.@max" | "math.@min" => match args {
            [Ty::List(item)] => (**item).clone(),
            args => args.iter().fold(Ty::Never, |acc, ty| join(&acc, ty)),
        },
        "math.abs" | "math.sign" | "math.ceil" | "math.floor" | "math.round" | "math.trunc" => first(),
        "math.sqrt" => Ty::Double,
        "optional.of" | "optional.ofNonZeroValue" => Ty::Optional(Box::new(first())),
        "optional.none" => Ty::Optional(Box::new(Ty::Never)),
        "value" => match target {
            Some(Ty::Optional(inner)) => *inner,
            _ => Ty::Dyn,
        },
        "orValue" => match target {
            Some(Ty::Optional(inner)) => join(&inner, &first()),
            _ => Ty::Dyn,
        },
        "or" => target.unwrap_or(Ty::Dyn),
        _ => return None,
    })
}
