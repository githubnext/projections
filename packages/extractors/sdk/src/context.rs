use crate::source::{FileEntry, GitObjects, Reader, scope_path, within};
use crate::{Output, parse_json, spawn, strings};
use anyhow::{Context as _, Result, bail, ensure};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// The largest request an extractor reads, apart from its upstream extractions.
pub const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024;
/// Room for upstream extractions: up to eight, each within the 8 MiB bound on
/// an extractor's output.
pub const MAX_UPSTREAM_BYTES: usize = 8 * 8 * 1024 * 1024;
/// Diagnostics stay well inside the runner's 64 KiB stderr bound.
const MAX_DIAGNOSTIC_BYTES: usize = 32 * 1024;

/// One tool run: what [`Context::run`] hands to the tool runner.
pub struct Invocation<'a> {
    pub argv: &'a [String],
    pub cwd: &'a Path,
    pub stdin: Option<&'a str>,
    pub environment: &'a BTreeMap<String, String>,
}

type Tools = dyn Fn(&Invocation<'_>) -> Result<Output> + Send + Sync;
type Helpers = dyn Fn() -> Result<Option<PathBuf>> + Send + Sync;

/// One extractor invocation: the public extractor request and what this process
/// was given. An extractor reads everything it needs from here, so it works the
/// same whoever starts it.
pub struct Context {
    extractor: String,
    request: Value,
    reader: Reader,
    /// The definition's project, relative to the repository's root; empty for the root.
    project: String,
    /// The project's directory, when the revision is on disk.
    project_root: Option<PathBuf>,
    scope: Option<Vec<String>>,
    environment: BTreeMap<String, String>,
    /// The revision's files in the scope, repository-relative.
    repository_files: OnceLock<Vec<String>>,
    /// Those in the project, project-relative.
    files: OnceLock<Vec<String>>,
    tools: Box<Tools>,
    helpers: Box<Helpers>,
    diagnostics: Mutex<String>,
    missing: Mutex<BTreeSet<String>>,
}

impl Context {
    /// The context for `request`, run by the extractor named `extractor`, with
    /// this process's environment, running tools as child processes and with no
    /// helper directory.
    pub fn new(extractor: &str, mut request: Value) -> Result<Self> {
        ensure!(request["protocolVersion"] == 0, "Unsupported extractor request version");
        ensure!(
            request["projection"]["definition"].is_object(),
            "Extractor request has no projection definition"
        );
        let mode = request["repository"]["mode"].as_str().unwrap_or("materialized").to_owned();
        let reader = if mode == "git-objects" {
            let git = &request["repository"]["git"];
            let directory = git["directory"]
                .as_str()
                .context("A git-objects request names no repository.git.directory")?;
            let tree = git["tree"].as_str().context("A git-objects request names no repository.git.tree")?;
            Reader::Objects(GitObjects::open(Path::new(directory), tree)?)
        } else {
            ensure!(
                ["materialized", "in-place", "workspace"].contains(&mode.as_str()),
                "Unknown repository.mode {mode}"
            );
            let root = request["repository"]["root"]
                .as_str()
                .context("Extractor request has no repository root")?;
            ensure!(Path::new(root).is_absolute(), "Extractor repository root must be absolute");
            let root = crate::canonical(Path::new(root)).context("Cannot resolve extractor repository root")?;
            // Tools resolve paths to their canonical spelling, so the request a helper
            // receives names the canonical root too.
            request["repository"]["root"] = Value::String(root.to_str().context("Extractor repository root is not UTF-8")?.to_owned());
            Reader::Directory {
                root,
                listed: mode != "materialized",
            }
        };
        let project = match request["repository"].get("project") {
            None | Some(Value::Null) => String::new(),
            Some(value) => {
                let text = value.as_str().context("repository.project must be a string")?;
                let project = crate::project_path("", text)?;
                ensure!(
                    project == text,
                    "repository.project must be a normalized repository-relative directory: {text}"
                );
                project
            }
        };
        let project_root = reader.root().map(|root| project_directory(root, &project));
        let scope = match request["repository"].get("scope") {
            None | Some(Value::Null) => None,
            Some(value) => Some(
                strings(value, "repository.scope")?
                    .iter()
                    .map(|path| scope_path(path))
                    .collect::<Result<Vec<_>>>()?,
            ),
        };
        Ok(Self {
            extractor: extractor.to_owned(),
            request,
            reader,
            project,
            project_root,
            scope,
            environment: std::env::vars().collect(),
            repository_files: OnceLock::new(),
            files: OnceLock::new(),
            tools: Box::new(|invocation| spawn(invocation.argv, invocation.cwd, invocation.stdin, invocation.environment)),
            helpers: Box::new(|| Ok(None)),
            diagnostics: Mutex::default(),
            missing: Mutex::default(),
        })
    }

    /// The context for the request on stdin.
    pub fn read(extractor: &str) -> Result<Self> {
        let mut raw = Vec::new();
        let limit = MAX_REQUEST_BYTES + MAX_UPSTREAM_BYTES;
        std::io::stdin().lock().take(limit as u64 + 1).read_to_end(&mut raw)?;
        ensure!(raw.len() <= limit, "Extractor request exceeds 66 MiB");
        let request =
            parse_json(std::str::from_utf8(&raw).context("Extractor request is not UTF-8")?).context("Invalid extractor request")?;
        Self::new(extractor, request)
    }

    /// Replaces the environment variables this extractor reads.
    pub fn with_environment(mut self, environment: BTreeMap<String, String>) -> Self {
        self.environment = environment;
        self
    }

    /// Runs tools with `tools` instead of as child processes.
    pub fn with_tools(mut self, tools: impl Fn(&Invocation<'_>) -> Result<Output> + Send + Sync + 'static) -> Self {
        self.tools = Box::new(tools);
        self
    }

    /// Locates the extractor's own helper files: `resolve` returns their
    /// directory, or `None` when they are in their source locations. It runs on
    /// each [`Context::helper`] lookup, so it can verify the files every time.
    pub fn with_helpers(mut self, resolve: impl Fn() -> Result<Option<PathBuf>> + Send + Sync + 'static) -> Self {
        self.helpers = Box::new(resolve);
        self
    }

    /// Uses `files` (repository-relative) as the revision's files instead of
    /// walking the root.
    pub fn with_files(self, files: Vec<String>) -> Self {
        let _ = self.repository_files.set(files);
        self
    }

    /// The extraction of the upstream built-in the definition's
    /// `extractor.upstream` names `name`, normalized, of the same revision.
    pub fn upstream(&self, name: &str) -> Option<&Value> {
        self.request["upstream"].get(name)
    }

    /// The name of the extractor this process runs.
    pub fn extractor(&self) -> &str {
        &self.extractor
    }

    /// The request, with its repository root canonicalized.
    pub fn request(&self) -> &Value {
        &self.request
    }

    /// The project's directory in the examined revision, canonicalized: in a
    /// temporary materialization, a workspace or the user's checkout read in
    /// place. It is the revision's root unless the definition belongs to a
    /// nested project (`repository.project`).
    ///
    /// # Panics
    ///
    /// When the revision is read from Git's object store (`repository.mode`
    /// `git-objects`), which the runner does only for a built-in that declares
    /// `access: files`. Such an extractor reads through [`Context::read_source`],
    /// [`Context::entry`] and [`Context::files`] instead.
    pub fn root(&self) -> &Path {
        self.project_root.as_deref().unwrap_or_else(|| {
            panic!(
                "{} reads the revision from Git objects, with no directory on disk; read files through the Context",
                self.extractor
            )
        })
    }

    /// The project's directory, or `None` when the revision is read from Git objects.
    pub fn directory(&self) -> Option<&Path> {
        self.project_root.as_deref()
    }

    /// The examined revision's root directory, or `None` when it is read from Git objects.
    pub fn repository_root(&self) -> Option<&Path> {
        self.reader.root()
    }

    /// The definition's project, relative to the repository's root
    /// (`repository.project`); empty for the root.
    pub fn project(&self) -> &str {
        &self.project
    }

    /// `relative`, a path in the project (`..` may leave it, but not the
    /// repository), as a repository-relative path.
    pub fn repository_path(&self, relative: &str) -> Result<String> {
        crate::project_path(&self.project, relative)
    }

    /// How the runner gave this extractor the revision: `materialized`,
    /// `in-place`, `workspace` or `git-objects`.
    pub fn mode(&self) -> &str {
        self.request["repository"]["mode"].as_str().unwrap_or("materialized")
    }

    /// The projection definition.
    pub fn definition(&self) -> &Value {
        &self.request["projection"]["definition"]
    }

    /// The declared scope, when the runner enforces one: repository-relative
    /// files and directories. Files outside it aren't listed and can't be read.
    pub fn scope(&self) -> Option<&[String]> {
        self.scope.as_deref()
    }

    /// The project's files, as project-relative POSIX paths in byte order:
    /// everything materialized under it, what Git lists in a checkout (tracked
    /// and untracked, not ignored), or the Git tree's blobs; only those in the
    /// scope when one is declared. Files outside the project aren't listed, but
    /// a scope that includes them lets them be read with `..` paths.
    pub fn files(&self) -> Result<&[String]> {
        if let Some(files) = self.files.get() {
            return Ok(files);
        }
        let all = self.repository_files()?;
        let files = if self.project.is_empty() {
            all.to_vec()
        } else {
            let prefix = format!("{}/", self.project);
            all.iter()
                .filter_map(|file| file.strip_prefix(&prefix).map(str::to_owned))
                .collect()
        };
        Ok(self.files.get_or_init(|| files))
    }

    /// The examined revision's files in the scope, repository-relative, in byte order.
    pub fn repository_files(&self) -> Result<&[String]> {
        if let Some(files) = self.repository_files.get() {
            return Ok(files);
        }
        let mut files = self.reader.list()?;
        if let Some(scope) = &self.scope {
            files.retain(|file| within(scope, file));
        }
        Ok(self.repository_files.get_or_init(|| files))
    }

    /// Fails when a scope is declared and `normalized` is outside it.
    fn in_scope(&self, normalized: &str) -> Result<()> {
        if let Some(scope) = &self.scope
            && !within(scope, normalized)
        {
            bail!(
                "{} read {normalized}, outside its declared scope ({}); declare it in the definition's scope",
                self.extractor,
                scope.join(", ")
            );
        }
        Ok(())
    }

    /// Fails unless `relative` (in the project) is one of the revision's files,
    /// naming it; returns its repository-relative path.
    fn readable(&self, relative: &str) -> Result<String> {
        let normalized = self.repository_path(relative)?;
        self.in_scope(&normalized)?;
        let listed = !matches!(self.reader, Reader::Directory { listed: false, .. }) || self.scope.is_some();
        if listed && self.repository_files()?.binary_search(&normalized).is_err() {
            bail!("{normalized} is not a file of the examined revision (it doesn't exist, or Git ignores it)");
        }
        Ok(normalized)
    }

    /// Whether `relative` is a file or directory of the examined revision: one
    /// of its files, or a directory some file is inside. A path Git ignores in a
    /// checkout isn't part of the revision.
    pub fn exists(&self, relative: &str) -> Result<bool> {
        let normalized = self.repository_path(relative)?;
        if normalized.is_empty() || normalized == self.project {
            return Ok(true);
        }
        // Outside a declared scope the revision's files aren't known: that's an error, not absence.
        self.in_scope(&normalized)?;
        if let (Reader::Directory { root, listed: false }, None) = (&self.reader, &self.scope) {
            return Ok(std::fs::symlink_metadata(crate::path(root, &normalized, true, true)?).is_ok());
        }
        Ok(self.repository_files()?.binary_search(&normalized).is_ok() || self.is_repository_dir(&normalized)?)
    }

    /// Whether the declared input `relative` (a file or folder an input names)
    /// exists at the examined revision. One that doesn't is recorded as missing:
    /// the revision predates it, or it was removed, so the extraction describes the
    /// revision without it and says so ([`Context::finish`]) rather than failing.
    pub fn input_exists(&self, relative: &str) -> Result<bool> {
        let exists = self.exists(relative)?;
        if !exists {
            self.missing_input(relative);
        }
        Ok(exists)
    }

    /// Records a declared input the examined revision lacks: a path that doesn't
    /// exist, or a glob that matches no file.
    pub fn missing_input(&self, input: &str) {
        let input = input.trim_start_matches("./").trim_end_matches('/');
        self.missing.lock().expect("missing inputs lock").insert(input.to_owned());
    }

    /// The declared inputs recorded as missing, in byte order.
    pub fn missing_inputs(&self) -> Vec<String> {
        self.missing.lock().expect("missing inputs lock").iter().cloned().collect()
    }

    /// `extraction` with the missing inputs recorded during the run, as its
    /// `missingInputs`. [`crate::serve`] applies it to what an extractor returns.
    pub fn finish(&self, mut extraction: Value) -> Value {
        let missing = self.missing_inputs();
        if !missing.is_empty() && extraction.is_object() {
            extraction["missingInputs"] = Value::from(missing);
        }
        extraction
    }

    /// One of the revision's files: whether it is a symlink, and its size.
    pub fn entry(&self, relative: &str) -> Result<FileEntry> {
        let relative = self.readable(relative)?;
        self.reader.entry(&relative)
    }

    /// Whether `relative` (in the project) is a directory of the revision: some file is inside it.
    pub fn is_dir(&self, relative: &str) -> Result<bool> {
        let normalized = self.repository_path(relative)?;
        self.is_repository_dir(&normalized)
    }

    /// Whether the repository-relative `normalized` is a directory of the revision.
    fn is_repository_dir(&self, normalized: &str) -> Result<bool> {
        if let (Reader::Directory { root, listed: false }, None) = (&self.reader, &self.scope) {
            return Ok(crate::path(root, normalized, false, false)?.is_dir());
        }
        if normalized.is_empty() {
            return Ok(true);
        }
        let prefix = format!("{normalized}/");
        Ok(self.repository_files()?.iter().any(|file| file.starts_with(&prefix)))
    }

    /// The bytes of a regular file of the revision, at most `maximum`; never
    /// through a symlink.
    pub fn read_bytes(&self, relative: &str, maximum: usize) -> Result<Vec<u8>> {
        let relative = self.readable(relative)?;
        self.reader.read(&relative, maximum)
    }

    /// A UTF-8 file of the revision (at most 32 MiB), as [`crate::read_source`] reads one.
    pub fn read_source(&self, relative: &str) -> Result<String> {
        String::from_utf8(self.read_bytes(relative, 32 * 1024 * 1024)?)
            .with_context(|| format!("Cannot read UTF-8 extractor input {relative}"))
    }

    /// A JSON file of the revision, parsed by the Engine.
    pub fn read_json(&self, relative: &str) -> Result<Value> {
        parse_json(&self.read_source(relative)?).with_context(|| format!("Cannot read JSON input {relative}"))
    }

    /// The generation store's snapshot the runner handed this run
    /// (`request.generations.file`), or an empty one: the first run,
    /// `--regenerate`, or an unreadable file. Reuse a value for an equal
    /// basis with [`crate::Generations::generate`].
    pub fn generations(&self) -> crate::Generations {
        self.request["generations"]["file"]
            .as_str()
            .and_then(|file| std::fs::read_to_string(file).ok())
            .map(|text| crate::Generations::parse(&text))
            .unwrap_or_default()
    }

    /// Whether the invocation explicitly trusts repository code and ecosystem tools.
    pub fn trusted(&self) -> bool {
        self.request["capabilities"]["trusted"] == true
    }

    /// Fails unless the invocation is trusted; call it immediately before running
    /// ecosystem tools or repository code.
    pub fn require_trust(&self) -> Result<()> {
        ensure!(
            self.trusted(),
            "{} executes ecosystem tools or repository code; review it and pass --trust.",
            self.definition()["id"].as_str().unwrap_or("Extractor")
        );
        Ok(())
    }

    /// Where the project's dependencies (such as `node_modules`) are installed
    /// for this run: the project's directory in the root itself in place or in
    /// a prepared workspace, or in the user's working checkout when a
    /// materialized revision borrows them.
    pub fn checkout(&self) -> Result<PathBuf> {
        match self.request["repository"]["checkout"].as_str() {
            Some(checkout) => Ok(project_directory(Path::new(checkout), &self.project)),
            None => bail!(
                "{} resolves the project's installed packages, which this run does not provide (container isolation and Git-object reads omit them)",
                self.extractor
            ),
        }
    }

    /// The base tool environment (a UTF-8 locale, UTC, `PATH` and `SystemRoot`)
    /// plus each of `names` this process received.
    pub fn environment(&self, names: &[String]) -> BTreeMap<String, String> {
        let mut environment = BTreeMap::from([
            ("LANG".into(), "C.UTF-8".into()),
            ("LC_ALL".into(), "C.UTF-8".into()),
            ("TZ".into(), "UTC".into()),
        ]);
        for name in ["PATH", "SystemRoot"].into_iter().chain(names.iter().map(String::as_str)) {
            if let Some(value) = self.environment.get(name) {
                environment.insert(name.into(), value.clone());
            }
        }
        environment
    }

    /// The names the definition grants through `execution.environment`.
    pub fn granted(&self) -> Result<Vec<String>> {
        match self.definition()["execution"].get("environment") {
            Some(names) => strings(names, "execution.environment"),
            None => Ok(vec![]),
        }
    }

    /// Runs a tool without a shell and records its stderr as a diagnostic.
    pub fn run(&self, cwd: &Path, argv: &[String], stdin: Option<&str>, environment: &BTreeMap<String, String>) -> Result<Output> {
        ensure!(
            !argv.is_empty() && !argv[0].is_empty() && argv.iter().all(|part| !part.contains('\0')),
            "Extractor command must be a nonempty argv without NULs"
        );
        let output = (self.tools)(&Invocation {
            argv,
            cwd,
            stdin,
            environment,
        })?;
        self.diagnose(&output.stderr);
        Ok(output)
    }

    /// The extractor's helper directory, or `None` when its helpers are in their
    /// source locations.
    pub fn helper_directory(&self) -> Result<Option<PathBuf>> {
        (self.helpers)()
    }

    /// Locates a helper file or directory: `installed` relative to the helper
    /// directory, or `source`, its location in a source checkout.
    pub fn helper(&self, installed: &str, source: PathBuf) -> Result<PathBuf> {
        Ok(match self.helper_directory()? {
            Some(directory) => directory.join(installed),
            None => source,
        })
    }

    /// Adds text to the diagnostics written to stderr when the extractor finishes.
    pub fn diagnose(&self, text: &str) {
        if text.is_empty() {
            return;
        }
        let mut diagnostics = self.diagnostics.lock().expect("diagnostics lock");
        if diagnostics.len() <= MAX_DIAGNOSTIC_BYTES {
            diagnostics.push_str(text);
            if !text.ends_with('\n') {
                diagnostics.push('\n');
            }
        }
    }

    /// The diagnostics recorded so far, bounded.
    pub fn diagnostics(&self) -> String {
        bounded(&self.diagnostics.lock().expect("diagnostics lock"), MAX_DIAGNOSTIC_BYTES)
    }
}

/// `project` (repository-relative) in the directory `root`; `root` itself for the root.
fn project_directory(root: &Path, project: &str) -> PathBuf {
    if project.is_empty() {
        root.to_path_buf()
    } else {
        root.join(project)
    }
}

/// `text`, cut at `maximum` bytes with a marker.
pub(crate) fn bounded(text: &str, maximum: usize) -> String {
    if text.len() <= maximum {
        return text.to_owned();
    }
    let mut end = maximum;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n[truncated]\n", &text[..end])
}

/// Runs a tool with the base environment, the definition's granted variables and
/// `overrides`, after checking trust when `requires_trust`, and returns its stdout.
pub fn execute(
    cx: &Context,
    cwd: &Path,
    argv: Vec<String>,
    stdin: Option<&str>,
    overrides: BTreeMap<String, String>,
    requires_trust: bool,
) -> Result<String> {
    let tool = argv.first().cloned().unwrap_or_default();
    execute_reporting(cx, cwd, argv, stdin, overrides, requires_trust)
        .with_context(|| format!("Extractor tool {tool} failed; install the selected ecosystem's required tool explicitly"))
}

/// [`execute`] without its generic tool-installation advice, for helpers whose own
/// error output already says what is missing.
pub fn execute_reporting(
    cx: &Context,
    cwd: &Path,
    argv: Vec<String>,
    stdin: Option<&str>,
    overrides: BTreeMap<String, String>,
    requires_trust: bool,
) -> Result<String> {
    if requires_trust {
        cx.require_trust()?;
    }
    let mut environment = cx.environment(&cx.granted()?);
    environment.extend(overrides);
    Ok(cx.run(cwd, &argv, stdin, &environment)?.stdout)
}

/// [`execute`] for a tool that writes JSON, parsed by the Engine.
pub fn run(cx: &Context, cwd: &Path, argv: Vec<String>, stdin: Option<&str>, environment: BTreeMap<String, String>) -> Result<Value> {
    let output = execute(cx, cwd, argv, stdin, environment, true)?;
    parse_json(&output).context("Extractor tool did not produce valid JSON")
}
