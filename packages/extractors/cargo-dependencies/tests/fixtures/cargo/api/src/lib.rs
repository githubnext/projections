mod hidden {
    pub struct Reexported {
        pub value: u32,
    }
    pub fn not_exported() {}
}

pub use hidden::Reexported as Exported;
mod extra { pub fn exported_glob() {} }
pub use extra::*;
pub mod empty {}
pub use std::fmt::Debug as Debuggable;

pub struct Service {
    pub name: String,
    secret: u32,
}

impl Service {
    pub fn new(name: String) -> Self {
        Self { name, secret: example_support::answer() }
    }
    pub fn answer(&self) -> u32 { self.secret }
    fn private_method(&self) {}
}

pub trait Store<T> {
    fn put(&self, value: T) -> bool;
}

impl Store<String> for Service {
    fn put(&self, _value: String) -> bool { true }
}

trait PrivateTrait { fn hidden(&self); }
impl PrivateTrait for Service { fn hidden(&self) {} }

pub enum Status { Ready, Failed(String) }

pub union Bits { pub integer: u32, pub float: f32 }
#[non_exhaustive]
pub struct Extensible {}

#[macro_export]
macro_rules! identity { ($value:expr) => { $value }; }

pub fn greet(name: &str) -> String { format!("Hello {name}") }
fn private_function() {}
