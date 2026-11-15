//! Adopting explore candidates for the repository.

use axum::http::Method;
use serde_json::{Value, json};

use super::{Answer, Failure, Host, Outcome, api, confirm_hint, post, refusal, text, token};
use crate::service::Service;

/// The token for an onboarding write: the files' current digest and what each would hold.
fn files_token(tool: &str, result: &Value) -> String {
    let mut parts = vec![text(&result["digest"]).to_owned()];
    for file in result["files"].as_array().into_iter().flatten() {
        parts.push(text(&file["path"]).to_owned());
        parts.push(text(&file["after"]).to_owned());
    }
    token(tool, &parts.iter().map(String::as_str).collect::<Vec<_>>())
}

fn files_summary(result: &Value) -> Vec<Value> {
    result["files"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|file| json!({"path": file["path"], "created": file["created"], "changed": file["changed"]}))
        .collect()
}

/// `adopt`: preview with the service's `dryRun`, then write with its digest.
pub(super) async fn onboarding(service: &Service, host: Host, tool: &str, input: &Value) -> Answer {
    let path = format!("/api/{tool}");
    let mut body = json!({"dryRun": true});
    for key in ["projections", "bookmarks"] {
        if !input[key].is_null() {
            body[key] = input[key].clone();
        }
    }
    let preview = post(service, &path, &body).await?;
    let confirm = files_token(tool, &preview);
    let mut structured = json!({"written": false, "files": files_summary(&preview),
        "adopted": preview["adopted"], "bookmarked": preview["bookmarked"]});
    let unchanged = preview["files"]
        .as_array()
        .into_iter()
        .flatten()
        .all(|file| file["changed"] == false);
    let previewed = |heading: &str| format!("{heading}{}", crate::onboard::text(&preview, true));
    if unchanged {
        return Ok(Outcome::new(previewed("Nothing to change:\n"), structured));
    }
    match input["confirm"].as_str() {
        None => {
            structured["confirm"] = json!(confirm);
            let text = previewed(&format!("{} would write:\n", title(tool))) + &confirm_hint(host, tool, &confirm);
            Ok(Outcome::new(text, structured))
        }
        Some(given) if given != confirm => {
            structured["confirm"] = json!(confirm);
            let text = previewed(&format!(
                "Not written: what {tool} would write changed since the preview that was confirmed. It would now write:\n"
            )) + &confirm_hint(host, tool, &confirm);
            let mut outcome = Outcome::new(text, structured);
            outcome.error = true;
            Ok(outcome)
        }
        Some(_) => {
            body["dryRun"] = json!(false);
            body["digest"] = preview["digest"].clone();
            let written = match api(service, Method::POST, &path, Some(&body)).await? {
                (200..=299, written) => written,
                (409, _) => {
                    return Err(Failure(format!(
                        "Not written: the files changed since the preview. Call {tool} again without confirm to preview the new difference."
                    )));
                }
                (status, body) => return Err(refusal(status, &body)),
            };
            let mut text = crate::onboard::text(&written, false);
            text.push_str(
                "Commit these files when the person is happy with them. To add them to CI, read the repository's workflows and propose where the Projections step goes (projections help agents ci); change CI only once the person agrees.\n",
            );
            structured["written"] = json!(true);
            structured["files"] = json!(files_summary(&written));
            Ok(Outcome::new(text, structured))
        }
    }
}

pub(super) fn title(tool: &str) -> String {
    let mut characters = tool.chars();
    characters
        .next()
        .map(|first| first.to_uppercase().chain(characters).collect())
        .unwrap_or_default()
}
