//! The check report as text.

use crate::diagnostics;
use serde_json::Value;

/// The report as text: one line per check, status first, in words.
pub fn text(report: &Value) -> String {
    let mut text = String::new();
    for projection in report["projections"].as_array().into_iter().flatten() {
        text.push_str(&format!(
            "{} [{}]\n",
            projection["title"].as_str().unwrap_or_default(),
            projection["id"].as_str().unwrap_or_default()
        ));
        for step in projection["steps"].as_array().into_iter().flatten() {
            step_text(&mut text, step);
        }
    }
    text.push_str(if report["ok"] == true {
        "All checks passed.\n"
    } else {
        "Some checks failed.\n"
    });
    text
}

fn step_text(text: &mut String, step: &Value) {
    text.push_str(&format!(
        "  {:<4} {}: {}\n",
        step["status"].as_str().unwrap_or_default(),
        step["title"].as_str().unwrap_or_default(),
        step["message"].as_str().unwrap_or_default()
    ));
    text.push_str(&crate::comparator_tests::text(step));
    for detail in step["details"].as_array().into_iter().flatten() {
        text.push_str(&format!("         - {}\n", detail.as_str().unwrap_or_default()));
    }
    let Some(error) = step.get("error") else {
        return;
    };
    for line in diagnostics::text(error).lines().skip(1) {
        text.push_str(&format!("         {line}\n"));
    }
    if let Some(stderr) = error["stderr"].as_str() {
        text.push_str("         stderr:\n");
        for line in stderr.trim_end().lines().rev().take(20).collect::<Vec<_>>().into_iter().rev() {
            text.push_str(&format!("           {line}\n"));
        }
    }
}
