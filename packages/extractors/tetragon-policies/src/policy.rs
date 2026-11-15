//! Maps one Tetragon `TracingPolicy` or `TracingPolicyNamespaced` to the
//! runtime policy vocabulary (docs/models/runtime-policy-model.md).
//!
//! Field names follow Tetragon's CRD types:
//! <https://github.com/cilium/tetragon/blob/main/pkg/k8s/apis/cilium.io/v1alpha1/types.go>.

mod actions;
mod conditions;
mod declarations;
mod emit;
mod fields;
mod probes;
mod resource;
mod selector;
mod subjects;
mod values;

use crate::scope::Workloads;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub use resource::add;

pub const ENGINE: &str = "tetragon";

/// One parsed policy document and where it came from.
pub struct Document<'a> {
    pub value: &'a Value,
    pub source: &'a str,
    pub line: Option<usize>,
    /// The YAML text of this document, to locate items for evidence.
    pub text: &'a str,
    pub templated: bool,
    /// Violations of the repository's own CRD, when one is given.
    pub invalid: Vec<String>,
}

/// Where a selector acts and what it does, for kernel profile checks.
#[derive(Clone)]
pub struct Site {
    pub selector: String,
    pub hook: String,
    pub actions: Vec<String>,
}

/// Everything the policies of one revision contribute.
#[derive(Default)]
pub struct Model {
    pub entities: Vec<Value>,
    pub hooks: BTreeMap<String, Value>,
    pub subjects: BTreeMap<String, Value>,
    pub relationships: Vec<Value>,
    pub limitations: BTreeSet<String>,
    pub identities: BTreeSet<String>,
    /// Each policy's workload scope, for agent and workload checks.
    pub scopes: Vec<(String, Workloads)>,
    pub sites: Vec<Site>,
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Enforce,
    Monitor,
}

/// A declared list: its type, values and generation pattern.
type List = (Option<String>, Vec<String>, Option<String>);

struct Policy<'a> {
    policy: &'a str,
    name: &'a str,
    mode: Mode,
    lists: BTreeMap<String, List>,
    macros: BTreeMap<String, Map<String, Value>>,
    document: &'a Document<'a>,
    namespace: Option<String>,
}

#[derive(Default)]
struct Summary {
    probes: usize,
    selectors: usize,
    enforcing: usize,
    observing: usize,
    unknown: usize,
}

impl Summary {
    fn effect(&self) -> &'static str {
        if self.enforcing > 0 {
            "enforce"
        } else if self.unknown > 0 {
            "unknown"
        } else if self.observing > 0 {
            "observe"
        } else {
            "none"
        }
    }
}

struct Probe {
    hook: String,
    hook_label: String,
    hook_data: Value,
    data: Value,
    line: Option<usize>,
}
