//! Which hooks, and which `Override` actions, each kernel profile can't support.

use super::finding;
use super::kernels::Profile;
use crate::hooks::syscall;
use crate::policy::{Model, Site};
use crate::terms::Terms;
use std::collections::{BTreeMap, BTreeSet};

/// Each hook's ID, type and target.
fn attached(model: &Model) -> Vec<(String, String, String)> {
    model
        .hooks
        .values()
        .map(|hook| {
            let data = &hook["data"];
            (
                hook["id"].as_str().unwrap().to_owned(),
                data["hookType"].as_str().unwrap_or_default().to_owned(),
                data["target"].as_str().unwrap_or_default().to_owned(),
            )
        })
        .collect()
}

/// Whether `set` holds `target`, or the same syscall under another wrapper or
/// architecture prefix (`sys_write` and `__x64_sys_write`).
fn has(set: &BTreeSet<String>, target: &str) -> bool {
    set.contains(target) || syscall(target).is_some_and(|call| set.iter().any(|symbol| syscall(symbol) == Some(call)))
}

/// The profiles that give a reason, grouped by reason in reason order.
fn grouped(profiles: &[Profile], reason: impl Fn(&Profile) -> Option<Terms>) -> Vec<(Terms, Vec<String>)> {
    let mut reasons: BTreeMap<String, (Terms, Vec<String>)> = BTreeMap::new();
    for profile in profiles {
        if let Some(reason) = reason(profile) {
            reasons
                .entry(reason.display())
                .or_insert_with(|| (reason, vec![]))
                .1
                .push(profile.name.clone());
        }
    }
    reasons.into_values().collect()
}

fn hook_reason(profile: &Profile, kind: &str, target: &str) -> Option<Terms> {
    let generated = target.starts_with("generated:");
    match kind {
        "lsm" if profile.disabled("CONFIG_BPF_LSM") => Some(Terms::new().text("BPF LSM is not enabled (").code("CONFIG_BPF_LSM").text(")")),
        "lsm" if !profile.at_least(5, 7) => Some(Terms::new().text("BPF LSM needs kernel 5.7 or later")),
        "fentry" if profile.disabled("CONFIG_DEBUG_INFO_BTF") => Some(
            Terms::new()
                .code("fentry")
                .text(" needs kernel BTF (")
                .code("CONFIG_DEBUG_INFO_BTF")
                .text(")"),
        ),
        "kprobe" | "fentry" if !generated && profile.symbols.as_ref().is_some_and(|symbols| !has(symbols, target)) => {
            Some(Terms::new().code(target).text(" is not a kernel symbol there"))
        }
        _ => None,
    }
}

/// Hooks some profiles can't attach.
pub(super) fn hooks(model: &mut Model, profiles: &[Profile]) {
    for (id, kind, target) in &attached(model) {
        for (reason, names) in grouped(profiles, |profile| hook_reason(profile, kind, target)) {
            let message = Terms::new()
                .text("Unavailable on ")
                .alternatives(&names, " and ")
                .text(": ")
                .extend(reason)
                .text(".");
            finding(model, id, "hook-unavailable", message, Some(&names));
        }
    }
}

fn override_reason(profile: &Profile, target: &str) -> Option<Terms> {
    if profile.disabled("CONFIG_BPF_KPROBE_OVERRIDE") {
        Some(Terms::new().text("the kernel lacks ").code("CONFIG_BPF_KPROBE_OVERRIDE"))
    } else if let Some(injectable) = &profile.injectable {
        (!has(injectable, target)).then(|| Terms::new().code(target).text(" doesn't allow error injection there"))
    } else if target.starts_with("security_") && !profile.at_least(5, 7) {
        Some(
            Terms::new()
                .text("overriding ")
                .code("security_")
                .text(" hooks needs kernel 5.7 or later"),
        )
    } else {
        None
    }
}

/// Selectors whose `Override` some profiles can't run.
pub(super) fn overrides(model: &mut Model, profiles: &[Profile]) {
    let kinds: BTreeMap<String, (String, String)> = attached(model).into_iter().map(|(id, kind, target)| (id, (kind, target))).collect();
    let sites: Vec<Site> = model.sites.clone();
    for site in sites {
        if !site.actions.iter().any(|action| action == "Override") {
            continue;
        }
        let Some((kind, target)) = kinds.get(&site.hook) else {
            continue;
        };
        if !matches!(kind.as_str(), "kprobe" | "fentry") {
            continue;
        }
        for (reason, names) in grouped(profiles, |profile| override_reason(profile, target)) {
            let message = Terms::new()
                .code("Override")
                .text(" can't run on ")
                .alternatives(&names, " and ")
                .text(": ")
                .extend(reason)
                .text(".");
            finding(model, &site.selector, "override-unavailable", message, Some(&names));
        }
    }
}
