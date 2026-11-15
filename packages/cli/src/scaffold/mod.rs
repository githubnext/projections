//! `projections init`: scaffolds a projection, or adds parts to one, and the
//! agent skill. Each part is optional and separate:
//!
//! - an extractor: a starter program in the project's own toolchain (Node,
//!   Python or Go, never assumed), a built-in extractor or an existing command;
//! - a renderer: a built-in one (`graph` by default) or a custom renderer, an
//!   ordinary TypeScript, Vite and React package using the renderer SDK and kit;
//! - a comparator, rarely needed: a starter comparator file and the tests beside it.
//!
//! Every run also writes or updates the agent skill (`crate::skill::install`).

use crate::artifact;
use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

pub use crate::skill::authoring_guide;
#[cfg(test)]
use package::checkout_for;
pub use package::{
    CHECKOUT_TARBALL, PackageSource, RENDERER_PACKAGE, RENDERER_PACKAGES_VARIABLE, file_specifier, release_tarball,
    renderer_package_version, source_checkout, version_mismatch,
};
use parts::Draft;

mod package;
mod parts;

const EXTRACT_NODE: &str = include_str!("../../templates/extract.mjs");
const EXTRACT_PYTHON: &str = include_str!("../../templates/extract.py");
const EXTRACT_GO: &str = include_str!("../../templates/extract.go");
const COMPARATOR: &str = include_str!("../../templates/starter.comparator.yaml");
const COMPARATOR_TESTS: &str = include_str!("../../templates/starter.comparator.test.yaml");
/// The custom renderer package, relative to its directory.
const RENDERER: &[(&str, &str)] = &[
    ("package.json", include_str!("../../templates/renderer/package.json")),
    ("vite.config.ts", include_str!("../../templates/renderer/vite.config.ts")),
    ("tsconfig.json", include_str!("../../templates/renderer/tsconfig.json")),
    (".gitignore", include_str!("../../templates/renderer/gitignore")),
    ("scenarios.json", include_str!("../../templates/renderer/scenarios.json")),
    ("src/view.tsx", include_str!("../../templates/renderer/src/view.tsx")),
    ("src/diff.tsx", include_str!("../../templates/renderer/src/diff.tsx")),
    (
        "playwright.config.ts",
        include_str!("../../templates/renderer/playwright.config.ts"),
    ),
    (
        "browser/renderer.spec.ts",
        include_str!("../../templates/renderer/browser/renderer.spec.ts"),
    ),
];

const VERSION: &str = env!("CARGO_PKG_VERSION");
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Language {
    Node,
    Python,
    Go,
}

impl Language {
    fn file(self) -> &'static str {
        match self {
            Self::Node => "extract.mjs",
            Self::Python => "extract.py",
            Self::Go => "extract.go",
        }
    }
    fn command(self, program: &str) -> Value {
        match self {
            Self::Node => json!(["node", program]),
            Self::Python => json!(["python3", program]),
            Self::Go => json!(["go", "run", program]),
        }
    }
    fn template(self) -> &'static str {
        match self {
            Self::Node => EXTRACT_NODE,
            Self::Python => EXTRACT_PYTHON,
            Self::Go => EXTRACT_GO,
        }
    }
}

pub enum Extractor {
    /// A starter program in this language, or the project's.
    Starter(Option<Language>),
    Builtin(String),
    /// A built-in extractor with these inputs over its template's.
    BuiltinWith(String, serde_json::Map<String, Value>),
    Command(Value),
}

pub enum Renderer {
    Builtin(String),
    /// A custom renderer package.
    Custom,
}

pub struct Options {
    pub root: PathBuf,
    pub id: Option<String>,
    pub title: Option<String>,
    /// `None` keeps an existing projection's extractor; a new projection gets a starter.
    pub extractor: Option<Extractor>,
    /// `None` keeps an existing projection's renderer; a new projection gets `graph`.
    pub renderer: Option<Renderer>,
    pub comparator: bool,
    pub definition_directory: String,
    /// The source checkout of a development build (see `source_checkout`): a
    /// custom renderer then installs the package packed there.
    pub checkout: Option<PathBuf>,
    /// Where the agent skill goes.
    pub skills: crate::skill::install::Options,
}

/// What `init` did, relative to the repository root.
#[derive(Default)]
pub struct Report {
    pub created: Vec<String>,
    pub updated: Vec<String>,
    pub kept: Vec<String>,
    pub definition: Option<Value>,
    /// The custom renderer package directory, when one was created.
    pub renderer: Option<String>,
    pub renderer_package: PackageSource,
    /// Where the agent skill was written, linked or kept.
    pub skill: Option<crate::skill::install::Installed>,
}

/// The project's toolchain, from the manifests at the repository root.
pub fn detect_language(root: &Path) -> Option<Language> {
    let exists = |name: &str| root.join(name).is_file();
    if exists("package.json") {
        Some(Language::Node)
    } else if ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"]
        .iter()
        .any(|name| exists(name))
    {
        Some(Language::Python)
    } else if exists("go.mod") {
        Some(Language::Go)
    } else {
        None
    }
}

/// Words a title keeps in capitals.
const ACRONYMS: [&str; 34] = [
    "ai", "api", "apis", "aws", "cd", "ci", "cli", "cpu", "css", "db", "di", "dns", "erd", "gcp", "gpu", "grpc", "html", "http", "https",
    "id", "ids", "io", "json", "jwt", "llm", "mcp", "orm", "rpc", "sdk", "sql", "ui", "url", "ux", "xml",
];

/// "service-map" → "Service map"; "contracts-api" → "Contracts API".
pub(crate) fn title_for(id: &str) -> String {
    let words: Vec<String> = id
        .split(['-', '_', '.'])
        .filter(|word| !word.is_empty())
        .enumerate()
        .map(|(index, word)| {
            let lower = word.to_ascii_lowercase();
            if ACRONYMS.contains(&lower.as_str()) {
                // A plural keeps its `s` lowercase: "APIs".
                return match lower.strip_suffix('s').filter(|stem| ACRONYMS.contains(stem)) {
                    Some(stem) => format!("{}s", stem.to_ascii_uppercase()),
                    None => lower.to_ascii_uppercase(),
                };
            }
            let mut characters = word.chars();
            match characters.next() {
                Some(first) if index == 0 => first.to_uppercase().chain(characters).collect(),
                _ => word.to_owned(),
            }
        })
        .collect();
    words.join(" ")
}

/// A renderer name (a lowercase identifier) for a projection ID.
fn renderer_name(id: &str) -> String {
    let name: String = id
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .take(64)
        .collect();
    name.trim_matches('-').to_owned()
}

fn fill(template: &str, values: &[(&str, &str)]) -> String {
    values.iter().fold(template.to_owned(), |text, (key, value)| {
        text.replace(&format!("{{{{{key}}}}}"), value)
    })
}

/// Creates `relative` under `root` (and its parents), refusing symlinked
/// directories and existing files.
pub(crate) fn create(root: &Path, relative: &str, contents: &str) -> Result<()> {
    let mut path = root.to_path_buf();
    let parts: Vec<_> = relative.split('/').collect();
    for part in &parts[..parts.len() - 1] {
        path.push(part);
        match fs::create_dir(&path) {
            Ok(()) => (),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => (),
            Err(error) => return Err(error).with_context(|| format!("Cannot create {relative}")),
        }
        let metadata = fs::symlink_metadata(&path)?;
        ensure!(
            metadata.is_dir() && !metadata.is_symlink(),
            "{} must be a directory, not a symlink",
            path.display()
        );
    }
    path.push(parts[parts.len() - 1]);
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .with_context(|| format!("Cannot create {relative}"))?
        .write_all(contents.as_bytes())?;
    Ok(())
}

fn exists(root: &Path, relative: &str) -> bool {
    fs::symlink_metadata(root.join(relative)).is_ok()
}

/// Writes or updates the agent skill. Agents load it by its description.
fn skill(root: &Path, options: &crate::skill::install::Options, report: &mut Report) -> Result<()> {
    report.skill = Some(crate::skill::install::install(root, options)?);
    Ok(())
}

fn read_definition(path: &Path) -> Result<Value> {
    let raw = fs::read_to_string(path).with_context(|| format!("Cannot read {}", path.display()))?;
    let definition = artifact::parse(&raw)?;
    artifact::validate_definition(&definition).with_context(|| format!("{} is not a valid definition", path.display()))?;
    Ok(definition)
}

/// Scaffolds what `options` asks for, creating a projection or adding parts to an
/// existing one. Files are never overwritten: if any file a part needs exists,
/// nothing is written. An existing definition only gets the fields of the parts
/// added. The skill is updated if Projections wrote it, else kept.
pub fn init(options: Options) -> Result<Report> {
    // A built-in renderer must be one this executable ships, when it embeds them.
    if let Some(Renderer::Builtin(builtin)) = &options.renderer {
        let names = crate::skill::renderer_names();
        ensure!(
            names.is_empty() || names.contains(builtin),
            "There is no built-in renderer {builtin}. Built-in renderers: {}; or --renderer custom to write one",
            names.into_iter().collect::<Vec<_>>().join(", ")
        );
    }
    let root = &options.root;
    ensure!(
        crate::project::directories().contains(&options.definition_directory),
        "--definition-directory must be .github/projections or .projections"
    );
    let mut report = Report::default();
    let Some(id) = options.id.as_deref() else {
        skill(root, &options.skills, &mut report)?;
        return Ok(report);
    };
    ensure!(
        format!("{id}.json") != crate::environment::FILE,
        "{} is the environment file, not a definition; choose another projection ID",
        crate::environment::FILE
    );
    let directory = &options.definition_directory;
    let component = format!("{directory}/{id}");
    let definition_path = format!("{directory}/{id}.json");
    let existing = exists(root, &definition_path);
    let mut definition = if existing {
        ensure!(
            options.extractor.is_some() || options.renderer.is_some() || options.comparator,
            "Projection {id} already exists at {definition_path}. To add a part, pass --renderer custom, --comparator custom, or an extractor option"
        );
        read_definition(&root.join(&definition_path))?
    } else {
        json!({"id": id})
    };
    let title = match (&options.title, definition.get("title")) {
        (Some(title), _) => title.clone(),
        (None, Some(Value::String(title))) => title.clone(),
        _ => title_for(id),
    };
    definition["title"] = json!(title);
    let name = renderer_name(id);
    // Escaped for both a JSON string and a JavaScript string in either quotes.
    let quoted = serde_json::to_string(&title)?;
    let escaped = quoted[1..quoted.len() - 1].replace('\'', "\\u0027");
    let values = [
        ("id", id),
        ("name", name.as_str()),
        ("title", escaped.as_str()),
        ("version", VERSION),
    ];
    let mut draft = Draft {
        root,
        id,
        component,
        project: crate::project::prefix(),
        existing,
        values: &values,
        definition,
        files: Vec::new(),
    };
    if let Some(extractor) = options.extractor.or_else(|| (!existing).then_some(Extractor::Starter(None))) {
        draft.extractor(extractor)?;
    }
    let renderer = options
        .renderer
        .or_else(|| (!existing && draft.definition.get("renderer").is_none()).then(|| Renderer::Builtin("graph".into())));
    if let Some(renderer) = renderer {
        draft.renderer(renderer, &name, options.checkout.as_deref(), &mut report)?;
    }
    if options.comparator {
        draft.comparator();
    }
    let Draft { definition, files, .. } = draft;

    artifact::validate_definition(&definition).context("The scaffolded definition is invalid")?;

    let conflicts: Vec<&str> = files
        .iter()
        .map(|(path, _)| path.as_str())
        .chain(report.renderer.as_deref())
        .filter(|path| exists(root, path))
        .collect();
    if !conflicts.is_empty() {
        bail!(
            "Projection {id} already has files, so nothing was written: {}. Choose another ID, or edit them",
            conflicts.join(", ")
        );
    }
    for (path, contents) in &files {
        create(root, path, contents)?;
        report.created.push(path.clone());
    }
    // An existing definition keeps its indentation and field order.
    let current = if existing {
        fs::read_to_string(root.join(&definition_path)).ok()
    } else {
        None
    };
    let serialized = crate::json_text::render(&definition, current.as_deref(), &crate::json_text::DEFINITION_ORDER)?;
    if existing {
        fs::write(root.join(&definition_path), serialized)?;
        report.updated.push(definition_path);
    } else {
        create(root, &definition_path, &serialized)?;
        report.created.insert(0, definition_path);
    }
    skill(root, &options.skills, &mut report)?;
    report.definition = Some(definition);
    Ok(report)
}

/// A prompt to paste into a coding agent, for a new projection `id` scaffolded
/// in `.github/projections/<id>/`, or for starting one.
pub fn agent_prompt(id: Option<&str>) -> String {
    let scaffold = id.map(|id| format!(".github/projections/{id}"));
    project_prompt(id, scaffold.as_deref(), "")
}

/// A prompt to paste into a coding agent. `scaffold` is the directory init
/// created for the projection's own code, if any, and `definition` its
/// definition file.
pub fn project_prompt(id: Option<&str>, scaffold: Option<&str>, definition: &str) -> String {
    match (id, scaffold) {
        (Some(id), Some(scaffold)) => format!(
            "Build the \"{id}\" projection in this repository so it shows <what this projection should show>. Start from the scaffold in {scaffold}/, follow the projections skill, and verify it with `projections check -p {id} --trust` before you finish."
        ),
        (Some(id), None) => format!(
            "Tune the \"{id}\" projection in this repository so it shows <what this projection should show>. Its definition is {definition}: adjust its inputs and execution.scope, follow the projections skill, and verify it with `projections check -p {id}` before you finish."
        ),
        (None, _) => "Use Projections to show <the system in this codebase you want to see> without showing code. Follow the projections skill: scaffold with `projections init <id>`, write the extractor, and verify it with `projections check --trust` before you finish.".to_owned(),
    }
}

/// The prompt for parts added to an existing projection: a custom renderer
/// in `renderer` (its package directory) and, with `comparator`, a comparator.
pub fn parts_prompt(id: &str, renderer: Option<&str>, comparator: bool) -> String {
    let mut parts = Vec::new();
    if let Some(package) = renderer {
        parts.push(format!(
            "write the custom renderer in {package}/ so it draws <what the picture should show>, then build it with npm run build"
        ));
    }
    if comparator {
        parts.push(
            format!("write its custom comparator (the new {id}.comparator.yaml) so a change is described as <how changes should be matched or explained>, with cases in {id}.comparator.test.yaml that state that intended output"),
        );
    }
    if parts.is_empty() {
        return agent_prompt(Some(id));
    }
    format!(
        "For the \"{id}\" projection in this repository, {}. Follow the projections skill, and verify it with `projections check -p {id} --trust` before you finish.",
        parts.join(", and ")
    )
}

#[cfg(test)]
mod tests;
