//! The view state the agent viewer's server owns: what every open page shows.
//! Pages render it and report the person's interactions back; the newest
//! report from a page that shows the current generation wins, so several
//! pages mirror one another.

use anyhow::{Result, bail};
use serde_json::{Value, json};

/// The comparison modes, in the order hosts offer them.
pub const MODES: [&str; 4] = ["side-by-side", "animated", "swipe", "diff"];

/// The choices `open_projection` names, besides two revisions.
pub const CHOICES: [&str; 5] = ["branch", "uncommitted", "last-commit", "now", "release"];

const WORKING_TREE: &str = "working-tree";

/// Who chose the projection a viewer shows: the agent (`open_projection`), or the person, from the page's title menu.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Chooser {
    #[default]
    Agent,
    Person,
}

impl Chooser {
    pub fn name(self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Person => "person",
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ViewState {
    /// Bumped on every change, so pages long-poll for the next one.
    pub generation: u64,
    pub projection: Option<String>,
    pub title: Option<String>,
    /// The choice it shows (`branch`, `uncommitted`, …), or none for two named revisions.
    pub choice: Option<String>,
    pub before: Option<String>,
    pub after: Option<String>,
    /// What is compared, in words: "Branch changes", or the revisions' subjects.
    pub compared: String,
    /// Two named revisions' own names, which the page's header shows short, in full on hover.
    pub sides: Option<Sides>,
    pub mode: Option<String>,
    /// The selected entity, relationship or change, by ID.
    pub selection: Option<String>,
    /// A scenario from the projection's `scenarios.json`, shown instead of the pair.
    pub scenario: Option<String>,
    /// Bumped by `refresh`: pages extract the pair again.
    pub refresh: u64,
    /// The revision whose definition extracts every side (`view --definition-revision`); the working tree's when none.
    pub definition_revision: Option<String>,
    /// Who chose the projection shown.
    pub chosen_by: Chooser,
    /// The page whose report made this generation, so that page knows the generation is its own report's echo.
    pub reported_by: Option<String>,
}

/// What `open_projection` asks the viewer to show, resolved to revisions and words.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Shown {
    pub projection: String,
    pub title: String,
    pub choice: Option<String>,
    pub before: Option<String>,
    pub after: String,
    pub compared: String,
    pub sides: Option<Sides>,
    pub mode: Option<String>,
    pub selection: Option<String>,
    pub scenario: Option<String>,
    pub chosen_by: Chooser,
}

/// Each named revision in words: its commit subject in full, "Your files" for
/// the working tree, or "A commit" without a subject.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Sides {
    pub before: Option<String>,
    pub after: String,
}

impl ViewState {
    pub fn json(&self) -> Value {
        json!({
            "generation": self.generation,
            "projection": self.projection,
            "title": self.title,
            "choice": self.choice,
            "before": self.before,
            "after": self.after,
            "compared": self.compared,
            "sides": self.sides.as_ref().map(|sides| json!({"before": sides.before, "after": sides.after})),
            "mode": self.mode,
            "selection": self.selection,
            "scenario": self.scenario,
            "refresh": self.refresh,
            "definitionRevision": self.definition_revision,
            "chosenBy": self.projection.as_ref().map(|_| self.chosen_by.name()),
            "reportedBy": self.reported_by,
        })
    }

    /// Shows what `open_projection` asked for. A mode or selection it leaves out
    /// stays as it is when the projection stays the same.
    pub fn show(&mut self, shown: Shown) {
        let same = self.projection.as_deref() == Some(shown.projection.as_str());
        self.generation += 1;
        self.reported_by = None;
        self.projection = Some(shown.projection);
        self.title = Some(shown.title);
        self.choice = shown.choice;
        self.before = shown.before;
        self.after = Some(shown.after);
        self.compared = shown.compared;
        self.sides = shown.sides;
        self.scenario = shown.scenario;
        self.chosen_by = shown.chosen_by;
        let (mode, selection) = (self.mode.take(), self.selection.take());
        self.mode = shown.mode.or(if same { mode } else { None });
        self.selection = shown.selection.or(if same { selection } else { None });
    }

    /// Extracts the shown pair again.
    pub fn refresh(&mut self) {
        self.generation += 1;
        self.reported_by = None;
        self.refresh += 1;
    }

    /// A page's report of the person's selection and mode. Applied only when the
    /// page shows the current generation, so a page that hasn't caught up with
    /// the agent's last change never undoes it. The generation it makes names
    /// the page (`reportedBy`). Returns whether it changed.
    pub fn report(&mut self, page: &str, generation: u64, selection: Option<&str>, mode: Option<&str>) -> bool {
        if generation != self.generation || self.projection.is_none() {
            return false;
        }
        let selection = selection.map(str::to_owned);
        let mode = mode.filter(|mode| MODES.contains(mode)).map(str::to_owned);
        let changed_mode = mode.is_some() && mode != self.mode;
        if selection == self.selection && !changed_mode {
            return false;
        }
        self.selection = selection;
        if changed_mode {
            self.mode = mode;
        }
        self.generation += 1;
        self.reported_by = Some(page.to_owned());
        true
    }
}

/// The pair a choice shows, from `GET /api/pairs`, and its name: `(before, after, words)`.
pub fn choice_pair(choice: &str, pairs: &Value) -> Result<(Option<String>, String, String)> {
    let suggestion = |source: &str| {
        pairs["suggestions"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|item| item["source"] == source && item.get("error").is_none())
    };
    let pair = |item: &Value| {
        (
            item["before"].as_str().map(str::to_owned),
            item["after"].as_str().unwrap_or(WORKING_TREE).to_owned(),
        )
    };
    let head = pairs["head"]["commit"].as_str().is_some();
    Ok(match choice {
        "now" => (None, WORKING_TREE.to_owned(), "Current state".to_owned()),
        "uncommitted" if head => (Some("HEAD".to_owned()), WORKING_TREE.to_owned(), "Uncommitted changes".to_owned()),
        "uncommitted" => bail!("Uncommitted changes don't apply here: there are no commits yet"),
        "branch" => match pairs["mergeBase"].as_str() {
            Some(base) => (Some(base.to_owned()), WORKING_TREE.to_owned(), "Branch changes".to_owned()),
            None => bail!("Branch changes don't apply here: the checkout isn't on a branch ahead of the default branch"),
        },
        "last-commit" => match suggestion("parent") {
            Some(item) => {
                let (before, after) = pair(item);
                (before, after, "Last commit".to_owned())
            }
            None => bail!("Last commit doesn't apply here: HEAD has no parent"),
        },
        "release" => match suggestion("tag") {
            Some(item) => {
                let (before, after) = pair(item);
                let words = format!("Since {}", before.as_deref().unwrap_or("the last release"));
                (before, after, words)
            }
            None => bail!("Release doesn't apply here: there is no earlier tag"),
        },
        _ => match choice.strip_prefix("bookmark:") {
            Some(id) => match pairs["bookmarks"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|bookmark| bookmark["id"] == id)
            {
                Some(bookmark) => {
                    let (before, after) = pair(bookmark);
                    let words = bookmark["title"].as_str().unwrap_or("A bookmark").to_owned();
                    (before, after, words)
                }
                None => bail!("There is no bookmark {id}"),
            },
            None => bail!("Unknown choice {choice}: use {}, or bookmark:<id>", CHOICES.join(", ")),
        },
    })
}

/// The pair Projections suggests (`GET /api/pairs`' default): its choice, pair and name.
pub fn suggested(pairs: &Value) -> (Option<String>, Option<String>, String, String) {
    let default = &pairs["default"];
    let before = default["before"].as_str().map(str::to_owned);
    let after = default["after"].as_str().unwrap_or(WORKING_TREE).to_owned();
    let (choice, words) = match default["source"].as_str().unwrap_or_default() {
        "merge-base" => (Some("branch".to_owned()), "Branch changes".to_owned()),
        "working-tree" => (Some("uncommitted".to_owned()), "Uncommitted changes".to_owned()),
        "parent" => (Some("last-commit".to_owned()), "Last commit".to_owned()),
        "tag" => (
            Some("release".to_owned()),
            format!("Since {}", before.as_deref().unwrap_or("the last release")),
        ),
        "bookmark" => (
            default["bookmark"].as_str().map(|id| format!("bookmark:{id}")),
            default["label"].as_str().unwrap_or("A bookmark").to_owned(),
        ),
        _ if after == WORKING_TREE => (Some("now".to_owned()), "Current state".to_owned()),
        _ => (None, "The latest commit".to_owned()),
    };
    (choice, before, after, words)
}

/// Two named revisions' names: their commit subjects in full, "Your files" for
/// the working tree, or "A commit".
pub fn revision_sides(before: Option<&str>, after: &str, subject: impl Fn(&str) -> Option<String>) -> Sides {
    let name = |reference: &str| {
        if reference == WORKING_TREE {
            "Your files".to_owned()
        } else {
            match subject(reference) {
                Some(subject) if !subject.is_empty() => subject,
                _ => "A commit".to_owned(),
            }
        }
    };
    Sides {
        before: before.map(name),
        after: name(after),
    }
}

/// A commit's name from `git log --format=%h%x09%p%x09%s` (`commit`): its
/// subject, or, for a merge, whose subject only names the branch it merged,
/// its short hash and the subject of the latest change it brings (`change`,
/// the newest commit that isn't a merge).
pub fn commit_name(commit: &str, change: Option<&str>) -> String {
    let mut fields = commit.trim_end().splitn(3, '\t');
    let (short, parents, subject) = (
        fields.next().unwrap_or(""),
        fields.next().unwrap_or(""),
        fields.next().unwrap_or(""),
    );
    match change.map(str::trim) {
        Some(change) if parents.split_whitespace().count() > 1 && !change.is_empty() => format!("{short} · {change}"),
        _ => subject.to_owned(),
    }
}

/// Two named revisions in words: their commit subjects, quoted, or "your files"
/// for the working tree.
pub fn revisions_words(sides: &Sides) -> String {
    let word = |name: &str, first: bool| match name {
        "Your files" | "A commit" if !first => name.to_lowercase(),
        "Your files" | "A commit" => name.to_owned(),
        _ => format!("“{}”", shorten(name, 60)),
    };
    match &sides.before {
        Some(before) => format!("{} → {}", word(before, true), word(&sides.after, false)),
        None => word(&sides.after, true),
    }
}

fn shorten(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_owned();
    }
    let mut short: String = text.chars().take(limit - 1).collect();
    short.push('…');
    short
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shown(projection: &str) -> Shown {
        Shown {
            projection: projection.to_owned(),
            title: projection.to_owned(),
            after: WORKING_TREE.to_owned(),
            compared: "Current state".to_owned(),
            ..Shown::default()
        }
    }

    #[test]
    fn showing_keeps_mode_and_selection_only_for_the_same_projection() {
        let mut state = ViewState::default();
        state.show(Shown {
            mode: Some("animated".to_owned()),
            selection: Some("a".to_owned()),
            ..shown("map")
        });
        assert_eq!(state.generation, 1);
        state.show(shown("map"));
        assert_eq!(state.mode.as_deref(), Some("animated"));
        assert_eq!(state.selection.as_deref(), Some("a"));
        state.show(shown("other"));
        assert_eq!((state.mode.as_deref(), state.selection.as_deref()), (None, None));
        assert_eq!(state.generation, 3);
        assert_eq!(state.json()["chosenBy"], "agent");
        state.show(Shown {
            chosen_by: Chooser::Person,
            ..shown("map")
        });
        assert_eq!(state.json()["chosenBy"], "person");
        assert!(ViewState::default().json()["chosenBy"].is_null(), "nothing is shown");
    }

    #[test]
    fn reports_apply_only_at_the_current_generation() {
        let mut state = ViewState::default();
        assert!(!state.report("p", 0, Some("a"), None), "nothing is shown yet");
        state.show(shown("map"));
        assert!(!state.report("p", 0, Some("a"), None), "a page behind the agent");
        assert!(state.report("p", 1, Some("a"), Some("swipe")));
        assert_eq!(state.selection.as_deref(), Some("a"));
        assert_eq!(state.mode.as_deref(), Some("swipe"));
        assert_eq!(state.generation, 2);
        assert!(!state.report("q", 2, Some("a"), Some("swipe")), "unchanged");
        assert!(!state.report("q", 2, Some("a"), Some("sideways")), "not a mode");
        assert!(state.report("q", 2, None, None), "cleared");
        assert_eq!(state.selection, None);
        assert_eq!(state.mode.as_deref(), Some("swipe"));
    }

    #[test]
    fn a_generation_a_report_made_names_its_page_until_the_next_change() {
        let mut state = ViewState::default();
        state.show(shown("map"));
        assert!(state.json()["reportedBy"].is_null(), "the agent's change");
        assert!(state.report("p", 1, Some("a"), None));
        assert_eq!(state.json()["reportedBy"], "p");
        assert!(
            !state.report("q", 1, Some("b"), None),
            "another page's report of the generation before"
        );
        assert_eq!(state.json()["reportedBy"], "p");
        state.refresh();
        assert!(state.json()["reportedBy"].is_null());
    }

    #[test]
    fn refreshing_bumps_the_generation() {
        let mut state = ViewState::default();
        state.refresh();
        assert_eq!((state.generation, state.refresh), (1, 1));
    }

    fn pairs() -> Value {
        json!({
            "head": {"commit": "c"}, "mergeBase": "m",
            "suggestions": [
                {"source": "merge-base", "before": "m", "after": "working-tree"},
                {"source": "tag", "before": "v1", "after": "HEAD"},
                {"source": "parent", "before": "HEAD~1", "after": "HEAD"},
            ],
            "bookmarks": [{"id": "b1", "title": "The big rename", "before": "x", "after": "y"}],
            "default": {"source": "merge-base", "before": "m", "after": "working-tree"},
        })
    }

    #[test]
    fn choices_resolve_to_pairs_and_words() {
        let pairs = pairs();
        let resolve = |choice| choice_pair(choice, &pairs).unwrap();
        assert_eq!(
            resolve("branch"),
            (Some("m".into()), "working-tree".into(), "Branch changes".into())
        );
        assert_eq!(
            resolve("uncommitted"),
            (Some("HEAD".into()), "working-tree".into(), "Uncommitted changes".into())
        );
        assert_eq!(resolve("last-commit"), (Some("HEAD~1".into()), "HEAD".into(), "Last commit".into()));
        assert_eq!(resolve("release").2, "Since v1");
        assert_eq!(resolve("now"), (None, "working-tree".into(), "Current state".into()));
        assert_eq!(resolve("bookmark:b1").2, "The big rename");
        assert!(choice_pair("bookmark:nope", &pairs).is_err());
        assert!(choice_pair("sideways", &pairs).is_err());
        assert!(choice_pair("branch", &json!({"head": {"commit": "c"}})).is_err());
        assert!(choice_pair("uncommitted", &json!({"head": {}})).is_err());
    }

    #[test]
    fn the_suggested_pair_is_named_as_its_choice() {
        let (choice, before, after, words) = suggested(&pairs());
        assert_eq!(choice.as_deref(), Some("branch"));
        assert_eq!((before.as_deref(), after.as_str()), (Some("m"), "working-tree"));
        assert_eq!(words, "Branch changes");
        let (choice, _, _, words) = suggested(&json!({"default": {"source": "head", "after": "HEAD"}}));
        assert_eq!((choice, words.as_str()), (None, "The latest commit"));
    }

    #[test]
    fn a_merge_is_named_by_its_hash_and_the_change_it_brings() {
        assert_eq!(commit_name("abc1234\tp1\tAdd auth\n", Some("Add auth")), "Add auth");
        assert_eq!(
            commit_name("def5678\tp1 p2\tMerge remote-tracking branch 'origin/x'", Some("Count proofs\n")),
            "def5678 · Count proofs"
        );
        assert_eq!(commit_name("def5678\tp1 p2\tMerge branch 'x'", None), "Merge branch 'x'");
    }

    #[test]
    fn revisions_are_named_by_their_subjects() {
        let subject = |reference: &str| (reference == "a").then(|| "Add auth".to_owned());
        let words = |before, after| revisions_words(&revision_sides(before, after, subject));
        assert_eq!(words(Some("a"), "working-tree"), "“Add auth” → your files");
        assert_eq!(words(None, "working-tree"), "Your files");
        assert_eq!(words(Some("b"), "a"), "A commit → “Add auth”");
        let long = "x".repeat(80);
        let sides = revision_sides(None, "a", |_| Some(long.clone()));
        assert_eq!(
            sides.after, long,
            "the page shortens a side's name itself, and shows it in full on hover"
        );
        assert_eq!(revisions_words(&sides).chars().count(), 62);
    }
}
