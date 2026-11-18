//! The syntax tree of the Ruby the DSL readers understand. Every expression
//! keeps its line and source text, so a reader can quote what it can't
//! evaluate rather than guess.

#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    Nil,
    Bool(bool),
    Str {
        value: String,
        interpolated: bool,
    },
    Symbol(String),
    /// A number as written, without `_` separators; negative numbers start with `-`.
    Number(String),
    Regex(String),
    Array(Vec<Expr>),
    Hash(Vec<(Expr, Expr)>),
    /// `-> { ... }`, `lambda { ... }` or `proc { ... }`.
    Lambda(Block),
    /// A constant path, such as `Foo::Bar`.
    Const(String),
    Call(Call),
    /// Anything else: operators, assignments, control flow inside expressions.
    Other,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Expr {
    pub kind: Kind,
    pub line: usize,
    /// The source text, as written.
    pub text: String,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Arg {
    Positional(Expr),
    /// `key: value` or `key => value`.
    Pair(Expr, Expr),
    /// `*value`, `**value` or `&value`.
    Splat(Expr),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Call {
    pub receiver: Option<Box<Expr>>,
    pub name: String,
    pub args: Vec<Arg>,
    pub block: Option<Block>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Block {
    pub params: Vec<String>,
    pub body: Vec<Stmt>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Stmt {
    Expr(Expr),
    /// `if`/`unless`/`elsif`, or a modifier `if`/`unless`: the condition's
    /// text, whether it is negated (`unless`), the statements run when the
    /// keyword's test passes and the others.
    If {
        condition: String,
        negated: bool,
        line: usize,
        then: Vec<Stmt>,
        otherwise: Vec<Stmt>,
    },
    /// A statement the reader doesn't model (`case`, `def`, `class`, loops,
    /// `begin`), kept as text.
    Other {
        line: usize,
        text: String,
    },
}

impl Expr {
    /// A literal string or symbol's text.
    pub fn name(&self) -> Option<&str> {
        match &self.kind {
            Kind::Str {
                value,
                interpolated: false,
            }
            | Kind::Symbol(value) => Some(value),
            _ => None,
        }
    }

    /// A literal string's value.
    pub fn string(&self) -> Option<&str> {
        match &self.kind {
            Kind::Str {
                value,
                interpolated: false,
            } => Some(value),
            _ => None,
        }
    }

    pub fn call(&self) -> Option<&Call> {
        match &self.kind {
            Kind::Call(call) => Some(call),
            _ => None,
        }
    }

    pub fn is_nil(&self) -> bool {
        self.kind == Kind::Nil
    }

    /// Literal strings or symbols: one, or an array of them (including `%w[]` and `%i[]`).
    pub fn names(&self) -> Option<Vec<String>> {
        match &self.kind {
            Kind::Array(items) => items.iter().map(|item| item.name().map(str::to_owned)).collect(),
            _ => self.name().map(|name| vec![name.to_owned()]),
        }
    }

    /// Whether the expression is made only of literals: no calls, constants,
    /// interpolation or operators.
    pub fn literal(&self) -> bool {
        match &self.kind {
            Kind::Nil | Kind::Bool(_) | Kind::Symbol(_) | Kind::Number(_) | Kind::Regex(_) => true,
            Kind::Str { interpolated, .. } => !interpolated,
            Kind::Array(items) => items.iter().all(Expr::literal),
            Kind::Hash(pairs) => pairs.iter().all(|(k, v)| k.literal() && v.literal()),
            _ => false,
        }
    }

    /// The value at `key` in a literal hash, by symbol or string key.
    pub fn get(&self, key: &str) -> Option<&Expr> {
        match &self.kind {
            Kind::Hash(pairs) => pairs.iter().find(|(k, _)| k.name() == Some(key)).map(|(_, v)| v),
            _ => None,
        }
    }
}

impl Call {
    pub fn positional(&self) -> impl Iterator<Item = &Expr> {
        self.args.iter().filter_map(|arg| match arg {
            Arg::Positional(expr) => Some(expr),
            _ => None,
        })
    }

    /// The keyword arguments and hash pairs, in order.
    pub fn pairs(&self) -> impl Iterator<Item = (&Expr, &Expr)> {
        self.args.iter().filter_map(|arg| match arg {
            Arg::Pair(key, value) => Some((key, value)),
            _ => None,
        })
    }

    /// The keyword argument `key`.
    pub fn option(&self, key: &str) -> Option<&Expr> {
        self.pairs().find(|(k, _)| k.name() == Some(key)).map(|(_, v)| v)
    }

    pub fn has_splat(&self) -> bool {
        self.args.iter().any(|arg| matches!(arg, Arg::Splat(_)))
    }

    /// Whether the call is `name` without a receiver.
    pub fn is(&self, name: &str) -> bool {
        self.receiver.is_none() && self.name == name
    }
}
