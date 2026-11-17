//! What `init` says about the agent skill.

use super::{Action, Installed, and_list};

/// Where the agent skill is, what init did there and which agents read it;
/// that it wasn't written, with `--no-skill`.
pub fn text(installed: Option<&Installed>) -> String {
    let Some(installed) = installed else {
        return "Agent skill: not written (--no-skill)\n".to_owned();
    };
    let mut text = String::from("Agent skill:\n");
    for placement in &installed.placements {
        let action = match &placement.action {
            Action::Created => "created".to_owned(),
            Action::Updated => "updated".to_owned(),
            Action::Unchanged => "up to date".to_owned(),
            Action::Kept(why) => format!("kept: {why}"),
            Action::Linked(_) => "linked".to_owned(),
            Action::Removed => "removed, so agents see one copy".to_owned(),
        };
        text.push_str(&format!("  {} ({action})\n", placement.path));
        if !placement.agents.is_empty() {
            text.push_str(&format!("    read by {}\n", and_list(&placement.agents)));
        }
    }
    for note in &installed.notes {
        text.push_str(&format!("  {note}\n"));
    }
    if installed.placements.iter().any(|placement| placement.action == Action::Created) {
        text.push_str("  Agents load it to build projections. --skills-dir DIR writes it elsewhere; --no-skill doesn't write it\n");
    }
    text
}
