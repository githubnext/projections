//! What a comparison asks of its reviewer: the one classification of its
//! changes. A comparison is `changed` when it has a reviewable change, one
//! whose status or identity changed; expected variation alone (`unchanged`
//! with `varied`) leaves it `unchanged`. The CLI's batch and artifact
//! statuses come from here, and JavaScript hosts reach it through the
//! `review` operation (`engine.review`).

use crate::model::{Correspondence, Status};
use crate::parse::{choice, object};
use crate::{Failure, pointer};
use serde_json::{Value, json};

/// How many of a comparison's changes are of each kind. A change can be both
/// a content and an identity change (a renamed, modified item).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Review {
    /// Changes a person reviews: a content or an identity change.
    pub reviewable: usize,
    /// Changes whose status is `added`, `removed` or `modified`.
    pub content: usize,
    /// Changes whose identity changed: `declared`, `split` or `merge`.
    pub identity: usize,
    /// Changes that are only expected variation: `unchanged`, `exact`, with `varied`.
    pub variation: usize,
}

/// Whether a change's content changed: `added`, `removed` or `modified`.
pub fn is_content_change(status: Status) -> bool {
    status != Status::Unchanged
}

/// Whether a change's identity changed: a rename, split or merge.
pub fn is_identity_change(correspondence: Correspondence) -> bool {
    matches!(
        correspondence,
        Correspondence::Declared | Correspondence::Split | Correspondence::Merge
    )
}

/// Whether a change is one a person reviews: its content or its identity changed.
pub fn is_reviewable(status: Status, correspondence: Correspondence) -> bool {
    is_content_change(status) || is_identity_change(correspondence)
}

/// Whether a change is only expected variation: an exact pair whose every
/// difference is within tolerance.
pub fn is_variation(status: Status, correspondence: Correspondence, varied: bool) -> bool {
    status == Status::Unchanged && correspondence == Correspondence::Exact && varied
}

impl Review {
    fn count(&mut self, status: Status, correspondence: Correspondence, varied: bool) {
        self.content += usize::from(is_content_change(status));
        self.identity += usize::from(is_identity_change(correspondence));
        self.reviewable += usize::from(is_reviewable(status, correspondence));
        self.variation += usize::from(is_variation(status, correspondence, varied));
    }

    /// `changed` when a change is reviewable, else `unchanged`.
    pub fn status(&self) -> &'static str {
        if self.reviewable > 0 { "changed" } else { "unchanged" }
    }

    pub fn to_json(&self) -> Value {
        json!({"status": self.status(), "reviewable": self.reviewable, "content": self.content,
            "identity": self.identity, "variation": self.variation})
    }
}

/// The review of a comparison (`comparison/v0`) the engine has validated. It
/// reads only each change's `status`, `correspondence` and `varied`, and fails
/// when one is missing or mistyped.
pub fn review(comparison: &Value) -> Result<Review, Failure> {
    object(comparison, "/comparison")?;
    let changes = comparison["changes"]
        .as_array()
        .ok_or_else(|| crate::fail("invalid-type", "/comparison/changes", "Expected an array"))?;
    let mut review = Review::default();
    for (index, change) in changes.iter().enumerate() {
        let path = pointer("/comparison/changes", &index.to_string());
        let status = choice(
            &change["status"],
            &Status::ALL,
            Status::name,
            &pointer(&path, "status"),
            "Expected added, removed, modified or unchanged",
        )?;
        let correspondence = choice(
            &change["correspondence"],
            &Correspondence::ALL,
            Correspondence::name,
            &pointer(&path, "correspondence"),
            "Expected exact, declared, split, merge or none",
        )?;
        let varied = match &change["varied"] {
            Value::Null => false,
            Value::Array(entries) => !entries.is_empty(),
            _ => return Err(crate::fail("invalid-type", &pointer(&path, "varied"), "Expected an array")),
        };
        review.count(status, correspondence, varied);
    }
    Ok(review)
}
