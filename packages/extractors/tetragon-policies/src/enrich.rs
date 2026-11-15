//! Facts beyond the policies that change what they mean in practice, each from
//! a file in the repository: the agent's Helm values, kernel profiles of the
//! nodes, and the workloads the repository deploys.

mod agent;
mod availability;
mod kernels;
mod workloads;

use crate::policy::Model;
use crate::terms::Terms;
use serde_json::{Value, json};

pub use agent::agent;
pub use kernels::kernels;
pub use workloads::workloads;

fn finding(model: &mut Model, id: &str, kind: &str, message: Terms, profiles: Option<&[String]>) {
    let Some(entity) = model
        .entities
        .iter_mut()
        .chain(model.hooks.values_mut())
        .find(|entity| entity["id"] == id)
    else {
        return;
    };
    let mut item = json!({"kind":kind,"message":message.prose()});
    if let Some(profiles) = profiles {
        item["profiles"] = json!(profiles);
    }
    let data = entity["data"].as_object_mut().expect("model entities have data");
    let findings = data.entry("findings").or_insert_with(|| json!([]));
    findings.as_array_mut().expect("findings are a list").push(item);
}

fn lookup<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter()
        .try_fold(value, |value, key| value.get(*key))
        .filter(|value| !value.is_null())
}
