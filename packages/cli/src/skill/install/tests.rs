use super::*;

fn repository() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

fn read(root: &Path, relative: &str) -> String {
    fs::read_to_string(root.join(relative)).unwrap()
}

fn write(root: &Path, relative: &str, contents: &str) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

/// A skill Projections wrote, as an older version would have.
const OLD: &str = "---\nname: projections\ndescription: old\nmetadata:\n  projections-version: \"0.0.1\"\n---\n\nOld guide\n";
const OTHERS: &str = "---\nname: other\ndescription: someone else's\n---\n\nTheirs\n";

fn options(directory: Option<&str>, claude: Option<Claude>) -> Options {
    Options {
        directory: directory.map(str::to_owned),
        claude,
        ..Options::default()
    }
}

fn action<'a>(installed: &'a Installed, path: &str) -> &'a Action {
    &installed
        .placements
        .iter()
        .find(|placement| placement.path == path)
        .unwrap_or_else(|| panic!("no placement {path} in {installed:?}"))
        .action
}

#[test]
fn the_skill_records_the_version_that_wrote_it() {
    assert_eq!(written_by(&crate::skill::skill()).as_deref(), Some(env!("CARGO_PKG_VERSION")));
    assert_eq!(written_by(&OLD.replace('\n', "\r\n")).as_deref(), Some("0.0.1"));
    assert_eq!(written_by(OTHERS), None);
    assert_eq!(written_by("no front matter\nprojections-version: 1\n"), None);
}

#[test]
fn it_defaults_to_agents_skills_and_says_who_reads_it() {
    let repo = repository();
    let root = repo.path();
    let installed = install(root, &Options::default()).unwrap();
    assert_eq!(installed.directory, DEFAULT);
    let placement = &installed.placements[0];
    assert_eq!(placement.path, ".agents/skills/projections/SKILL.md");
    assert_eq!(placement.action, Action::Created);
    assert_eq!(placement.agents, ["GitHub Copilot", "OpenAI Codex", "Cursor", "Gemini CLI"]);
    assert!(installed.notes.iter().any(|note| note.contains("--claude")), "{installed:?}");
    assert_eq!(read(root, ".agents/skills/projections/SKILL.md"), crate::skill::skill());
    assert!(!root.join(".claude").exists() && !root.join(".github").exists());
}

#[test]
fn it_uses_an_existing_skills_directory_and_leaves_its_skills_alone() {
    for directory in [".claude/skills", ".github/skills"] {
        let repo = repository();
        let root = repo.path();
        let theirs = format!("{directory}/other/SKILL.md");
        write(root, &theirs, OTHERS);
        let installed = install(root, &Options::default()).unwrap();
        assert_eq!(installed.directory, directory);
        assert_eq!(action(&installed, &format!("{directory}/projections/SKILL.md")), &Action::Created);
        assert!(installed.notes.iter().all(|note| !note.starts_with("Several")), "{installed:?}");
        assert_eq!(read(root, &theirs), OTHERS);
        assert!(!root.join(".agents").exists());
    }
}

#[test]
fn among_several_directories_it_prefers_the_most_widely_read_and_says_so() {
    let repo = repository();
    let root = repo.path();
    write(root, ".github/skills/other/SKILL.md", OTHERS);
    write(root, ".claude/skills/other/SKILL.md", OTHERS);
    let installed = install(root, &Options::default()).unwrap();
    assert_eq!(installed.directory, ".claude/skills");
    assert!(
        installed.notes.iter().any(|note| note.contains("chose .claude/skills")),
        "{installed:?}"
    );
    // An empty directory the repository doesn't use loses to the ones holding its skills.
    fs::create_dir_all(root.join(".agents/skills")).unwrap();
    fs::remove_dir_all(root.join(".claude/skills/projections")).unwrap();
    let installed = install(root, &Options::default()).unwrap();
    assert_eq!(installed.directory, ".claude/skills");
    assert!(
        installed.notes.iter().any(|note| note.contains(
            "(.agents/skills, .claude/skills, .github/skills); chose .claude/skills, which holds as many of this repository's skills as any"
        )),
        "{installed:?}"
    );
    // The one holding the most of them wins, however widely read.
    fs::remove_dir_all(root.join(".claude/skills/projections")).unwrap();
    write(root, ".github/skills/another/SKILL.md", OTHERS);
    let installed = install(root, &Options::default()).unwrap();
    assert_eq!(installed.directory, ".github/skills");
    assert!(
        installed
            .notes
            .iter()
            .any(|note| note.contains("chose .github/skills, which holds the most of this repository's skills")),
        "{installed:?}"
    );
    // With none of the repository's skills anywhere, the most widely read.
    let repo = repository();
    let root = repo.path();
    for directory in [".github/skills", ".agents/skills"] {
        fs::create_dir_all(root.join(directory)).unwrap();
    }
    let installed = install(root, &Options::default()).unwrap();
    assert_eq!(installed.directory, DEFAULT);
    assert!(
        installed
            .notes
            .iter()
            .any(|note| note.contains("chose .agents/skills, which the most agents read")),
        "{installed:?}"
    );
}

#[test]
fn it_stays_where_the_skill_already_is() {
    let repo = repository();
    let root = repo.path();
    write(root, ".github/skills/projections/SKILL.md", OLD);
    fs::create_dir_all(root.join(".agents/skills")).unwrap();
    let installed = install(root, &Options::default()).unwrap();
    assert_eq!(installed.directory, ".github/skills");
    assert_eq!(action(&installed, ".github/skills/projections/SKILL.md"), &Action::Updated);
    assert!(!root.join(".agents/skills/projections").exists());
}

#[test]
fn reruns_update_its_skill_and_keep_anyone_elses() {
    let repo = repository();
    let root = repo.path();
    write(root, ".agents/skills/projections/SKILL.md", OLD);
    let installed = install(root, &Options::default()).unwrap();
    assert_eq!(installed.placements[0].action, Action::Updated);
    assert_eq!(read(root, ".agents/skills/projections/SKILL.md"), crate::skill::skill());
    let installed = install(root, &Options::default()).unwrap();
    assert_eq!(installed.placements[0].action, Action::Unchanged);

    // Without the version key it isn't Projections' skill any more.
    write(root, ".agents/skills/projections/SKILL.md", "customized\n");
    let installed = install(root, &Options::default()).unwrap();
    assert!(matches!(installed.placements[0].action, Action::Kept(_)), "{installed:?}");
    assert_eq!(read(root, ".agents/skills/projections/SKILL.md"), "customized\n");
}

#[test]
fn skills_dir_chooses_the_directory_and_moves_its_own_copy_there() {
    let repo = repository();
    let root = repo.path();
    write(root, ".github/skills/projections/SKILL.md", OLD);
    write(root, ".github/skills/other/SKILL.md", OTHERS);
    let installed = install(root, &options(Some("./.agents/skills/"), None)).unwrap();
    assert_eq!(installed.directory, DEFAULT);
    assert_eq!(action(&installed, ".agents/skills/projections/SKILL.md"), &Action::Created);
    assert_eq!(action(&installed, ".github/skills/projections/SKILL.md"), &Action::Removed);
    assert!(!root.join(".github/skills/projections").exists());
    assert_eq!(read(root, ".github/skills/other/SKILL.md"), OTHERS);

    // Someone else's copy elsewhere stays, with a warning.
    write(root, ".github/skills/projections/SKILL.md", "theirs\n");
    let installed = install(root, &options(Some(".agents/skills"), None)).unwrap();
    assert!(
        installed
            .notes
            .iter()
            .any(|note| note.contains(".github/skills/projections also holds"))
    );
    assert_eq!(read(root, ".github/skills/projections/SKILL.md"), "theirs\n");

    let installed = install(root, &options(Some("tools/skills"), None)).unwrap();
    assert!(root.join("tools/skills/projections/SKILL.md").is_file());
    assert!(installed.placements[0].agents.is_empty());
    assert!(installed.notes.iter().any(|note| note.starts_with("No agent reads tools/skills")));
    let installed = install(root, &options(Some(".cursor/skills"), None)).unwrap();
    assert_eq!(installed.placements[0].agents, ["Cursor"]);

    for invalid in ["", "/abs/skills", "../skills", "a/../b", "C:\\skills"] {
        let error = install(root, &options(Some(invalid), None)).unwrap_err();
        assert!(error.to_string().contains("--skills-dir"), "{invalid}: {error}");
    }
}

#[test]
fn claude_is_a_no_op_where_claude_code_already_reads_the_skill() {
    let repo = repository();
    let root = repo.path();
    let installed = install(root, &options(Some(".claude/skills"), Some(Claude::Auto))).unwrap();
    assert_eq!(installed.placements.len(), 1);
    assert_eq!(installed.placements[0].agents, ["Claude Code", "GitHub Copilot", "Cursor"]);
    assert!(
        installed
            .notes
            .iter()
            .any(|note| note == "Claude Code already reads .claude/skills")
    );
}

#[test]
fn claude_copy_writes_a_copy_that_reruns_keep_in_sync() {
    let repo = repository();
    let root = repo.path();
    let installed = install(root, &options(None, Some(Claude::Copy))).unwrap();
    assert_eq!(action(&installed, ".claude/skills/projections/SKILL.md"), &Action::Created);
    let mirror = root.join(".claude/skills/projections");
    assert!(!fs::symlink_metadata(&mirror).unwrap().is_symlink());
    assert_eq!(read(root, ".claude/skills/projections/SKILL.md"), crate::skill::skill());

    // A later run, without --claude, updates the copy with the skill.
    write(root, ".claude/skills/projections/SKILL.md", OLD);
    let installed = install(root, &Options::default()).unwrap();
    assert_eq!(installed.directory, DEFAULT, "a .claude copy beside the skill is the mirror");
    assert_eq!(action(&installed, ".claude/skills/projections/SKILL.md"), &Action::Updated);
    assert_eq!(read(root, ".claude/skills/projections/SKILL.md"), crate::skill::skill());
    assert!(installed.notes.iter().any(|note| note.contains("keeps it in sync")));

    // Someone else's skill there is left alone.
    write(root, ".claude/skills/projections/SKILL.md", "theirs\n");
    let installed = install(root, &options(None, Some(Claude::Copy))).unwrap();
    assert!(matches!(action(&installed, ".claude/skills/projections/SKILL.md"), Action::Kept(_)));
    assert_eq!(read(root, ".claude/skills/projections/SKILL.md"), "theirs\n");
}

#[cfg(unix)]
#[test]
fn claude_links_the_skill_relatively_and_switches_between_link_and_copy() {
    let repo = repository();
    let root = repo.path();
    write(root, ".claude/skills/other/SKILL.md", OTHERS);
    write(root, ".agents/skills/mine/SKILL.md", OTHERS);
    let installed = install(root, &options(None, Some(Claude::Auto))).unwrap();
    assert_eq!(installed.directory, DEFAULT);
    let link = ".claude/skills/projections → ../../.agents/skills/projections";
    assert_eq!(action(&installed, link), &Action::Linked("../../.agents/skills/projections".into()));
    let mirror = root.join(".claude/skills/projections");
    assert_eq!(fs::read_link(&mirror).unwrap(), Path::new("../../.agents/skills/projections"));
    assert_eq!(read(root, ".claude/skills/projections/SKILL.md"), crate::skill::skill());

    // Reruns check the link, with or without --claude.
    for claude in [None, Some(Claude::Auto), Some(Claude::Link)] {
        let installed = install(root, &options(None, claude)).unwrap();
        assert_eq!(action(&installed, link), &Action::Unchanged);
    }

    // --claude copy turns the link into a copy, and --claude link back.
    let installed = install(root, &options(None, Some(Claude::Copy))).unwrap();
    assert_eq!(action(&installed, ".claude/skills/projections/SKILL.md"), &Action::Created);
    assert!(!fs::symlink_metadata(&mirror).unwrap().is_symlink());
    let installed = install(root, &options(None, Some(Claude::Link))).unwrap();
    assert!(matches!(action(&installed, link), Action::Linked(_)));
    assert!(fs::symlink_metadata(&mirror).unwrap().is_symlink());
    assert_eq!(read(root, ".claude/skills/other/SKILL.md"), OTHERS);
    assert_eq!(read(root, ".agents/skills/mine/SKILL.md"), OTHERS);

    // A link elsewhere isn't Projections' to change.
    fs::remove_file(&mirror).unwrap();
    write(root, "elsewhere/SKILL.md", OTHERS);
    std::os::unix::fs::symlink("../../elsewhere", &mirror).unwrap();
    let installed = install(root, &options(None, Some(Claude::Copy))).unwrap();
    assert!(matches!(action(&installed, ".claude/skills/projections"), Action::Kept(_)));
    assert_eq!(fs::read_link(&mirror).unwrap(), Path::new("../../elsewhere"));
}

#[test]
fn a_link_checked_out_as_a_file_is_reported_and_replaced_by_a_copy_on_request() {
    let repo = repository();
    let root = repo.path();
    write(root, ".claude/skills/projections", "../../.agents/skills/projections");
    write(root, ".agents/skills/projections/SKILL.md", OLD);
    let installed = install(root, &Options::default()).unwrap();
    let Action::Kept(why) = action(&installed, ".claude/skills/projections") else {
        panic!("{installed:?}")
    };
    assert!(why.contains("core.symlinks"), "{why}");
    let installed = install(root, &options(None, Some(Claude::Copy))).unwrap();
    assert_eq!(action(&installed, ".claude/skills/projections/SKILL.md"), &Action::Created);
}

#[cfg(unix)]
#[test]
fn a_linked_claude_directory_counts_as_claude_code_reading_the_skill() {
    let repo = repository();
    let root = repo.path();
    fs::create_dir_all(root.join(".agents/skills")).unwrap();
    fs::create_dir_all(root.join(".claude")).unwrap();
    std::os::unix::fs::symlink("../.agents/skills", root.join(".claude/skills")).unwrap();
    let installed = install(root, &options(None, Some(Claude::Auto))).unwrap();
    assert_eq!(installed.directory, DEFAULT);
    assert!(installed.placements[0].agents.contains(&"Claude Code"), "{installed:?}");
    assert_eq!(installed.placements.len(), 1);
    assert!(
        installed
            .notes
            .iter()
            .any(|note| note == "Claude Code already reads .agents/skills")
    );
}
