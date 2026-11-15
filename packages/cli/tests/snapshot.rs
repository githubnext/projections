//! `projections show --png` and `compare --png` against a locally installed Chrome, Chromium or Edge.
//! Without one these tests are skipped with a message, except in CI (`CI` set),
//! where GitHub-hosted runners have Chrome and a missing browser is a failure.

use projections_cli::{
    browser::{self, Transport},
    runtime::{DefinitionSource, Runner},
    snapshot,
};
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::{Arc, atomic::AtomicBool},
    time::Duration,
};

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args([
            "-c",
            "core.hooksPath=",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "user.name=Snapshot fixture",
            "-c",
            "user.email=snapshot@example.invalid",
        ])
        .args(args)
        .current_dir(root)
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8(output.stdout).unwrap().trim().into()
}

/// The built Inspector client, which the snapshot page is part of.
fn assets() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../host/inspector/dist/client")
}

/// The browser and Inspector assets, or `None` (with a message) to skip.
fn prerequisites(test: &str) -> Option<PathBuf> {
    let required = std::env::var_os("CI").is_some();
    if !assets().join("renderers/index.json").is_file() {
        assert!(!required, "{test}: build the Inspector client first (npm run build)");
        eprintln!("skipping {test}: the Inspector client is not built (npm run build -w @githubnext/projections-inspector)");
        return None;
    }
    match browser::find(None) {
        Ok(path) => Some(path),
        Err(error) if !required => {
            eprintln!("skipping {test}: {error}");
            None
        }
        Err(error) => panic!("{test}: {error}"),
    }
}

/// A repository whose `files` projection maps its files, at two commits.
fn repository() -> (tempfile::TempDir, String, String) {
    let root = tempfile::tempdir().unwrap();
    let path = root.path();
    git(path, &["init", "--quiet", "--template="]);
    fs::create_dir_all(path.join(".projections")).unwrap();
    fs::write(
        path.join(".projections/files.json"),
        serde_json::to_vec(&json!({"id": "files", "title": "Files", "extractor": "repository-map", "renderer": "file-packing"})).unwrap(),
    )
    .unwrap();
    // An API presented by the API renderer, which has no animated mode. The renderer
    // accepts only `api/v0`, so the extraction is one: a committed file the command prints,
    // with Node so that it runs on Windows too.
    fs::write(
        path.join(".projections/api.json"),
        serde_json::to_vec(&json!({"id": "api", "renderer": "api",
            "extractor": {"command": ["node", "-e", "process.stdout.write(require('fs').readFileSync('api.extraction.json'))"],
                "sources": ["api.extraction.json"]}}))
        .unwrap(),
    )
    .unwrap();
    let api = |signature: &str| {
        serde_json::to_vec(&json!({"protocolVersion": 0, "schema": "api/v0", "entities": [
            {"id": "function:route", "kind": "function", "label": "route", "data": {"signature": signature}},
        ], "relationships": []}))
        .unwrap()
    };
    fs::write(path.join("api.extraction.json"), api("route(): void")).unwrap();
    fs::create_dir_all(path.join("src/api")).unwrap();
    fs::write(path.join("README.md"), "# Snapshot\n").unwrap();
    fs::write(path.join("src/api/routes.ts"), "export {}\n").unwrap();
    fs::write(path.join("src/legacy.ts"), "export {}\n").unwrap();
    git(path, &["add", "--all"]);
    git(path, &["commit", "--quiet", "-m", "base"]);
    let base = git(path, &["rev-parse", "HEAD"]);
    fs::create_dir_all(path.join("src/web")).unwrap();
    fs::write(path.join("src/web/page.ts"), "export {}\n").unwrap();
    fs::write(path.join("api.extraction.json"), api("route(path: string): void")).unwrap();
    fs::remove_file(path.join("src/legacy.ts")).unwrap();
    git(path, &["add", "--all"]);
    git(path, &["commit", "--quiet", "-m", "head"]);
    let head = git(path, &["rev-parse", "HEAD"]);
    (root, base, head)
}

/// Runs the CLI with a private temporary directory, which must stay empty:
/// the browser profile is removed on every exit path.
fn cli(repo: &Path, browser: &Path, args: &[&str]) -> Output {
    let temporary = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_projections"))
        .arg("-C")
        .arg(repo)
        .args(args)
        .current_dir(repo)
        .env("PROJECTIONS_INSPECTOR_ASSETS", assets())
        .env("PROJECTIONS_BROWSER", browser)
        .env("TMPDIR", temporary.path())
        .env("TMP", temporary.path())
        .env("TEMP", temporary.path())
        .output()
        .unwrap();
    let left: Vec<_> = fs::read_dir(temporary.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .filter(|name| name.to_string_lossy().starts_with("projections-browser-"))
        .collect();
    assert!(left.is_empty(), "browser profiles were left behind: {left:?}");
    output
}

fn succeeded(output: &Output) {
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}

/// The PNG's pixel dimensions, from its IHDR chunk.
fn dimensions(png: &[u8]) -> (u32, u32) {
    assert!(png.starts_with(b"\x89PNG\r\n\x1a\n") && &png[12..16] == b"IHDR");
    (
        u32::from_be_bytes(png[16..20].try_into().unwrap()),
        u32::from_be_bytes(png[20..24].try_into().unwrap()),
    )
}

/// Decoded 8-bit pixels: (width, height, channels, bytes).
fn pixels(png: &[u8]) -> (u32, u32, usize, Vec<u8>) {
    let mut decoder = png::Decoder::new(png);
    decoder.set_transformations(png::Transformations::EXPAND);
    let mut reader = decoder.read_info().unwrap();
    let mut buffer = vec![0; reader.output_buffer_size()];
    let frame = reader.next_frame(&mut buffer).unwrap();
    assert_eq!(frame.bit_depth, png::BitDepth::Eight);
    buffer.truncate(frame.buffer_size());
    (frame.width, frame.height, frame.color_type.samples(), buffer)
}

/// The largest per-channel difference rasterization noise causes.
const NOISE: u8 = 4;

/// Whether two images show the same content. Chrome's rasterizer isn't
/// byte-identical across launches: anti-aliased edges (rounded corners, text)
/// can differ by a few levels in a few pixels (two on macOS runners). So the
/// dimensions must match, every channel within `NOISE` levels, and at most one
/// pixel in 2000 may differ at all.
fn same_image(first: &[u8], second: &[u8]) -> Result<(), String> {
    let (width, height, channels, a) = pixels(first);
    let (other_width, other_height, other_channels, b) = pixels(second);
    if (width, height, channels) != (other_width, other_height, other_channels) {
        return Err(format!(
            "{width}x{height}x{channels} differs from {other_width}x{other_height}x{other_channels}"
        ));
    }
    let mut differing = 0;
    for (index, (x, y)) in a.chunks(channels).zip(b.chunks(channels)).enumerate() {
        if x == y {
            continue;
        }
        differing += 1;
        if x.iter().zip(y).any(|(x, y)| x.abs_diff(*y) > NOISE) {
            return Err(format!(
                "pixel ({}, {}) differs by more than {NOISE} levels: {x:?} and {y:?}",
                index as u32 % width,
                index as u32 / width
            ));
        }
    }
    let budget = (width as usize * height as usize / 2000).max(16);
    if differing > budget {
        return Err(format!("{differing} pixels differ slightly, more than {budget}"));
    }
    Ok(())
}

#[test]
fn same_image_tolerates_only_rounding_in_a_few_pixels() {
    let encode = |pixels: &[u8]| {
        let mut bytes = Vec::new();
        let mut encoder = png::Encoder::new(&mut bytes, 100, 100);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.write_header().unwrap().write_image_data(pixels).unwrap();
        bytes
    };
    let base = vec![200u8; 100 * 100 * 4];
    let original = encode(&base);
    let mut rounded = base.clone();
    for pixel in 0..8 {
        rounded[pixel * 4] += 1;
    }
    rounded[8 * 4 + 2] += NOISE;
    assert!(same_image(&original, &encode(&rounded)).is_ok());
    let mut changed = base.clone();
    changed[0] = 100;
    assert!(same_image(&original, &encode(&changed)).is_err());
    let mut noisy = base;
    for pixel in 0..100 {
        noisy[pixel * 4] += 1;
    }
    assert!(same_image(&original, &encode(&noisy)).is_err());
}

#[test]
fn snapshots_of_one_revision_are_identical_and_follow_size_scale_and_theme() {
    let Some(browser) = prerequisites("snapshot determinism") else {
        return;
    };
    let (repo, _, head) = repository();
    let output = tempfile::tempdir().unwrap();
    let file = |name: &str| output.path().join(name).to_string_lossy().into_owned();
    let size = ["--width", "480", "--height", "320"];
    for name in ["first.png", "second.png"] {
        succeeded(&cli(
            repo.path(),
            &browser,
            &[&["show", &head, "-p", "files", "--png", &file(name)], &size[..]].concat(),
        ));
    }
    let first = fs::read(file("first.png")).unwrap();
    assert_eq!(dimensions(&first), (480, 320));
    if let Err(difference) = same_image(&first, &fs::read(file("second.png")).unwrap()) {
        panic!("two snapshots of the same input differ: {difference}");
    }
    succeeded(&cli(
        repo.path(),
        &browser,
        &[
            &["show", &head, "-p", "files", "--theme", "dark", "--scale", "2"],
            &size[..],
            &["--png", &file("dark.png")],
        ]
        .concat(),
    ));
    let dark = fs::read(file("dark.png")).unwrap();
    assert_eq!(dimensions(&dark), (960, 640));
    // An existing file is never replaced.
    let refused = cli(repo.path(), &browser, &["show", &head, "-p", "files", "--png", &file("first.png")]);
    assert!(!refused.status.success());
    assert!(String::from_utf8_lossy(&refused.stderr).contains("already exists"));
    assert_eq!(fs::read(file("first.png")).unwrap(), first);
}

/// How steep the image's edges are: of the differences in luminance between horizontally adjacent pixels that are
/// edges at all (more than 16 levels), the mean of the largest quarter. Text drawn at the image's density has edges a
/// pixel or two wide; text drawn at a lower density and scaled up has edges as wide as the scale, so at twice the
/// density they are about half as steep. Only edges count, so sparse text measures the same at any density.
fn steepness(png: &[u8]) -> f64 {
    let (width, height, channels, bytes) = pixels(png);
    let luminance = |x: u32, y: u32| {
        let at = ((y * width + x) as usize) * channels;
        let alpha = if channels == 4 { f64::from(bytes[at + 3]) / 255.0 } else { 1.0 };
        let color = 0.299 * f64::from(bytes[at]) + 0.587 * f64::from(bytes[at + 1]) + 0.114 * f64::from(bytes[at + 2]);
        color * alpha + 255.0 * (1.0 - alpha)
    };
    let mut edges: Vec<f64> = (0..height)
        .flat_map(|y| (1..width).map(move |x| (x, y)))
        .map(|(x, y)| (luminance(x, y) - luminance(x - 1, y)).abs())
        .filter(|difference| *difference > 16.0)
        .collect();
    assert!(!edges.is_empty(), "the image has no edges");
    edges.sort_by(f64::total_cmp);
    let top = &edges[edges.len() - (edges.len() / 4).max(1)..];
    top.iter().sum::<f64>() / top.len() as f64
}

#[test]
fn the_renderer_frame_is_drawn_at_the_image_density() {
    let Some(browser) = prerequisites("snapshot density") else {
        return;
    };
    let (repo, _, head) = repository();
    let output = tempfile::tempdir().unwrap();
    let file = |name: &str| output.path().join(name).to_string_lossy().into_owned();
    // The renderer's content alone, which a sandboxed frame draws: the host's own text would be sharp either way.
    for (name, scale) in [("one.png", "1"), ("two.png", "2")] {
        succeeded(&cli(
            repo.path(),
            &browser,
            &[
                "show",
                &head,
                "-p",
                "api",
                "--trust",
                "--frame",
                "none",
                "--width",
                "480",
                "--height",
                "240",
                "--scale",
                scale,
                "--png",
                &file(name),
            ],
        ));
    }
    let (one, two) = (
        steepness(&fs::read(file("one.png")).unwrap()),
        steepness(&fs::read(file("two.png")).unwrap()),
    );
    // Drawn at density 1 and scaled up, the text's edges were less than half as steep.
    assert!(
        two > 0.75 * one,
        "text at --scale 2 is blurred: edges {two:.1} against {one:.1} at --scale 1"
    );
}

#[test]
fn frames_record_the_playback_loop_back_and_forth() {
    let Some(browser) = prerequisites("snapshot frames") else {
        return;
    };
    let (repo, base, head) = repository();
    let output = tempfile::tempdir().unwrap();
    let directory = output.path().join("loop");
    let range = format!("{base}..{head}");
    succeeded(&cli(
        repo.path(),
        &browser,
        &[
            "compare",
            &range,
            "-p",
            "files",
            "--width",
            "320",
            "--height",
            "240",
            "--fps",
            "4",
            "--frames",
            &directory.to_string_lossy(),
        ],
    ));
    let manifest: serde_json::Value = serde_json::from_slice(&fs::read(directory.join("frames.json")).unwrap()).unwrap();
    let frames = manifest["frames"].as_array().unwrap();
    let progress = |frame: &serde_json::Value| frame["progress"].as_f64().unwrap();
    // From the hold at the before end, forward to the after end, then backward.
    assert_eq!(progress(&frames[0]), 0.0);
    let after = frames.iter().position(|frame| progress(frame) == 1.0).expect("the after end");
    assert!(frames[1..after].iter().all(|frame| frame["direction"] == 1));
    assert!(
        frames[after + 1..]
            .iter()
            .all(|frame| frame["direction"] == -1 && progress(frame) > 0.0)
    );
    assert!(frames.len() > after + 1, "the loop comes back");
    // The endpoints hold for the viewer's endpoint hold: half of it at each end of each turn.
    assert!(frames[0]["durationMs"].as_f64().unwrap() >= 600.0);
    assert!(frames[after]["durationMs"].as_f64().unwrap() >= 600.0);
    for frame in frames {
        assert_eq!(
            dimensions(&fs::read(directory.join(frame["file"].as_str().unwrap())).unwrap()),
            (320, 240)
        );
    }
    // Only an animated comparison has playback.
    let still = cli(
        repo.path(),
        &browser,
        &[
            "show",
            &head,
            "-p",
            "files",
            "--frames",
            &output.path().join("still").to_string_lossy(),
        ],
    );
    assert!(!still.status.success());
    assert!(String::from_utf8_lossy(&still.stderr).contains("--frames"));
}

#[test]
fn comparisons_render_at_a_progress_and_side_by_side() {
    let Some(browser) = prerequisites("snapshot comparisons") else {
        return;
    };
    let (repo, base, head) = repository();
    let output = tempfile::tempdir().unwrap();
    let file = |name: &str| output.path().join(name).to_string_lossy().into_owned();
    let range = format!("{base}..{head}");
    let size = ["--width", "640", "--height", "400"];
    for (name, extra) in [
        ("before.png", &["--progress", "0"][..]),
        ("after.png", &["--progress", "1"][..]),
        ("default.png", &[][..]),
        ("side-by-side.png", &["--mode", "side-by-side"][..]),
    ] {
        succeeded(&cli(
            repo.path(),
            &browser,
            &[&["compare", &range, "-p", "files", "--png", &file(name)], &size[..], extra].concat(),
        ));
    }
    let read = |name: &str| fs::read(file(name)).unwrap();
    // Content, not bytes: the rasterizer can round a few edge pixels differently per launch.
    assert!(same_image(&read("before.png"), &read("after.png")).is_err());
    assert!(same_image(&read("side-by-side.png"), &read("after.png")).is_err());
    assert_eq!(dimensions(&read("side-by-side.png")), (640, 400));
    // The file-packing renderer also draws its own static comparison.
    succeeded(&cli(
        repo.path(),
        &browser,
        &[
            &["compare", &range, "-p", "files", "--mode", "diff", "--png", &file("diff.png")][..],
            &size[..],
        ]
        .concat(),
    ));
    assert!(same_image(&read("diff.png"), &read("after.png")).is_err());
    // Without --mode, an image opens where the Inspector does: the renderer's diff.
    if let Err(difference) = same_image(&read("diff.png"), &read("default.png")) {
        panic!("the diff and the default differ: {difference}");
    }
    // A mode the renderer doesn't offer fails clearly, before writing anything.
    let unsupported = cli(
        repo.path(),
        &browser,
        &[
            "compare",
            &range,
            "-p",
            "api",
            "--trust",
            "--mode",
            "animated",
            "--png",
            &file("api.png"),
        ],
    );
    assert!(!unsupported.status.success());
    assert!(
        String::from_utf8_lossy(&unsupported.stderr).contains("has no animated mode"),
        "{}",
        String::from_utf8_lossy(&unsupported.stderr)
    );
    assert!(!Path::new(&file("api.png")).exists());
}

#[test]
fn a_saved_document_renders_without_running_extractors_and_failures_are_reported() {
    let Some(browser) = prerequisites("snapshot of a saved document") else {
        return;
    };
    let (repo, _, head) = repository();
    let output = tempfile::tempdir().unwrap();
    let document = Runner::new(repo.path().to_owned(), false)
        .with_executable(env!("CARGO_BIN_EXE_projections"))
        .show("files", &head, None)
        .unwrap();
    let saved = output.path().join("files.json");
    fs::write(&saved, serde_json::to_vec(&document).unwrap()).unwrap();
    let png = output.path().join("saved.png");
    succeeded(&cli(
        repo.path(),
        &browser,
        &["show", "--from", &saved.to_string_lossy(), "--png", &png.to_string_lossy()],
    ));
    assert!(fs::read(&png).unwrap().starts_with(b"\x89PNG"));
    // A renderer that doesn't exist: the page reports failure instead of an image.
    fs::write(
        repo.path().join(".projections/files.json"),
        serde_json::to_vec(&json!({"id": "files", "extractor": "repository-map", "renderer": "missing"})).unwrap(),
    )
    .unwrap();
    let missing = output.path().join("missing.png");
    let failed = cli(repo.path(), &browser, &["show", "-p", "files", "--png", &missing.to_string_lossy()]);
    assert!(!failed.status.success());
    assert!(
        String::from_utf8_lossy(&failed.stderr).contains("renderer \"missing\" is not available"),
        "{}",
        String::from_utf8_lossy(&failed.stderr)
    );
    assert!(!missing.exists());
}

/// The default frame is one rounded card, transparent outside its corners; a matte fills them, and `--frame none`
/// draws the renderer's content alone, edge to edge.
#[test]
fn the_card_frame_is_transparent_outside_its_corners_unless_matted() {
    let Some(browser) = prerequisites("snapshot frames") else {
        return;
    };
    let (repo, _, head) = repository();
    let output = tempfile::tempdir().unwrap();
    let file = |name: &str| output.path().join(name).to_string_lossy().into_owned();
    let draw = |name: &str, extra: &[&str]| {
        let args = [
            &["show", &head, "-p", "files", "--width", "400", "--height", "300"][..],
            extra,
            &["--png", &file(name)],
        ];
        succeeded(&cli(repo.path(), &browser, &args.concat()));
        let (width, _, channels, bytes) = pixels(&fs::read(file(name)).unwrap());
        move |x: u32, y: u32| bytes[(y * width + x) as usize * channels..][..channels].to_vec()
    };
    let card = draw("card.png", &[]);
    assert_eq!(card(0, 0)[3], 0, "the corner is transparent");
    assert_eq!(card(200, 0)[3], 0, "a pixel of room surrounds the card");
    assert_eq!(card(200, 1)[3], 255, "the card's edge is opaque");
    assert_eq!(card(200, 150)[3], 255);
    let matted = draw("matted.png", &["--theme", "dark", "--matte", "#0D1117"]);
    assert_eq!(matted(0, 0)[..3], [13, 17, 23]);
    assert!(matted(0, 0).get(3).is_none_or(|alpha| *alpha == 255));
    let bare = draw("bare.png", &["--frame", "none"]);
    assert!(bare(0, 0).get(3).is_none_or(|alpha| *alpha == 255), "--frame none fills the image");
}

/// A definition's custom renderer is served from its definition revision, under
/// the same trust rule as `inspect`.
#[test]
fn custom_renderers_run_from_their_revision_and_outside_ones_need_trust() {
    let Some(browser) = prerequisites("snapshot custom renderers") else {
        return;
    };
    let (repo, _, _) = repository();
    let path = repo.path();
    // The built-in file-packing renderer as a custom bundle, drawing in another color.
    let bundle = |color: &str| {
        let html = fs::read_to_string(assets().join("renderers/file-packing/index.html")).unwrap();
        fs::create_dir_all(path.join("ui")).unwrap();
        fs::write(
            path.join("ui/index.html"),
            html.replacen(
                "</head>",
                &format!("<style>* {{ color: {color} !important; fill: {color} !important; }}</style></head>"),
                1,
            ),
        )
        .unwrap();
        fs::copy(assets().join("renderers/file-packing/renderer.json"), path.join("ui/renderer.json")).unwrap();
    };
    bundle("#d00000");
    fs::write(
        path.join(".projections/files.json"),
        serde_json::to_vec(&json!({"id": "files", "extractor": "repository-map", "renderer": {"bundle": "ui"}})).unwrap(),
    )
    .unwrap();
    git(path, &["add", "--all"]);
    git(path, &["commit", "--quiet", "-m", "custom renderer"]);
    let custom = git(path, &["rev-parse", "HEAD"]);
    // A revision outside HEAD's history whose renderer differs from its merge base's.
    git(path, &["checkout", "--quiet", "-b", "side"]);
    bundle("#0000d0");
    git(path, &["add", "--all"]);
    git(path, &["commit", "--quiet", "-m", "changed renderer"]);
    let side = git(path, &["rev-parse", "HEAD"]);
    git(path, &["checkout", "--quiet", &custom]);
    // The same files without the custom renderer, for reference.
    let output = tempfile::tempdir().unwrap();
    let file = |name: &str| output.path().join(name).to_string_lossy().into_owned();
    let size = ["--width", "400", "--height", "300"];
    let run = |name: &str, extra: &[&str]| {
        let result = cli(path, &browser, &[extra, &size[..], &["--png", &file(name)]].concat());
        succeeded(&result);
        (fs::read(file(name)).unwrap(), String::from_utf8_lossy(&result.stderr).into_owned())
    };
    let (own, notes) = run("custom.png", &["show", &custom, "-p", "files"]);
    assert!(!notes.contains("note:"), "{notes}");
    let (withheld, notes) = run("withheld.png", &["show", &side, "-p", "files"]);
    assert!(notes.contains("needs --trust"), "{notes}");
    let (trusted, notes) = run("trusted.png", &["show", &side, "-p", "files", "--trust"]);
    assert!(!notes.contains("note:"), "{notes}");
    assert_ne!(own, withheld, "the custom renderer did not run");
    assert_ne!(trusted, withheld, "the trusted renderer did not run");
    assert_ne!(trusted, own);
}

/// The WebSocket transport Windows uses also works on Unix, and both give the same image.
#[tokio::test(flavor = "multi_thread")]
async fn the_port_and_pipe_transports_render_the_same_image() {
    let Some(browser) = prerequisites("snapshot transports") else {
        return;
    };
    let (repo, base, head) = repository();
    let runner = Runner::new(repo.path().to_owned(), false).with_executable(env!("CARGO_BIN_EXE_projections"));
    let document = runner.compare_with("files", &base, &head, DefinitionSource::Base).unwrap().document;
    let request = |transport| snapshot::Request {
        document: document.clone(),
        repo: repo.path().to_owned(),
        trust: false,
        definition: DefinitionSource::Base,
        definition_revision: None,
        assets: assets(),
        mode: Some(snapshot::Mode::SideBySide),
        progress: None,
        focus: snapshot::Focus::default(),
        theme: snapshot::Theme::Light,
        frame: snapshot::Frame::Card,
        matte: None,
        width: 400,
        height: 300,
        scale: 1.0,
        browser: browser.clone(),
        transport,
        timeout: Duration::from_secs(60),
        cancel: Arc::new(AtomicBool::new(false)),
    };
    let port = snapshot::render(request(Transport::Port)).await.unwrap();
    assert_eq!(dimensions(&port.png), (400, 300));
    if cfg!(unix) {
        let pipe = snapshot::render(request(Transport::Pipe)).await.unwrap();
        if let Err(difference) = same_image(&port.png, &pipe.png) {
            panic!("the transports rendered different images: {difference}");
        }
    }
}

#[test]
fn arguments_are_checked_before_any_work() {
    let repo = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        let output = Command::new(env!("CARGO_BIN_EXE_projections"))
            .args(args)
            .current_dir(repo.path())
            .output()
            .unwrap();
        assert!(!output.status.success());
        String::from_utf8_lossy(&output.stderr).into_owned()
    };
    assert!(run(&["show", "-p", "files", "--png", "x.png", "--progress", "2"]).contains("between 0 and 1"));
    assert!(run(&["show", "-p", "files", "--png", "x.png", "--width", "10"]).contains("--width"));
    assert!(run(&["show", "HEAD", "-p", "files", "--mode", "diff", "--png", "x.png"]).contains("apply to comparisons"));
    assert!(
        run(&["show", "HEAD", "-p", "files", "--focus", "changes", "--png", "x.png"]).contains("--focus changes applies to comparisons")
    );
    assert!(run(&["show", "HEAD", "-p", "files", "--focus", "middle", "--png", "x.png"]).contains("changes, all"));
    assert!(run(&["show", "HEAD", "-p", "files", "--fit"]).contains("--png"));
    assert!(run(&["show", "-p", "files", "--png", "x.png", "--matte", "white"]).contains("#rgb or #rrggbb"));
    assert!(run(&["show", "-p", "files", "--png", "x.png", "--frame", "none", "--matte", "#fff"]).contains("--frame card"));
    assert!(
        run(&[
            "show",
            "-p",
            "files",
            "--png",
            "x.png",
            "--browser",
            &repo.path().join("no-browser").to_string_lossy()
        ])
        .contains("--browser")
    );
    let settings = snapshot::validate_settings(400, 300, 2.0, None, Duration::from_secs(5));
    assert!(settings.is_ok());
    assert!(
        snapshot::validate_settings(4096, 300, 4.0, None, Duration::from_secs(5))
            .unwrap_err()
            .to_string()
            .contains("pixels on a side")
    );
    assert!(!repo.path().join("x.png").exists());
}

#[test]
fn large_extractions_get_longer_to_paint_by_default() {
    let entities = |count: usize| json!({"entities": (0..count).map(|index| json!({"id": index})).collect::<Vec<_>>()});
    let small = json!({"format": "projections.extraction", "extraction": entities(10)});
    assert_eq!(snapshot::paint_timeout(&small), Duration::from_secs(62));
    let large =
        json!({"format": "projections.comparison", "before": {"extraction": entities(250)}, "after": {"extraction": entities(260)}});
    assert_eq!(snapshot::paint_timeout(&large), Duration::from_secs(162));
}

#[test]
fn a_side_keeps_the_definition_revision_that_explained_the_comparison() {
    let side =
        |kind: &str, commit: &str| json!({"format":"projections.extraction","provenance":{"revision":{"kind":kind,"commit":commit}}});
    let base = "a".repeat(40);
    let head = "b".repeat(40);
    let comparison = json!({"format":"projections.comparison","before":side("commit", &base),"after":side("commit", &head)});
    let (after, revision) = snapshot::side(&comparison, true, DefinitionSource::Base).unwrap();
    assert_eq!(after["provenance"]["revision"]["commit"], head.as_str());
    assert_eq!(
        revision.as_deref(),
        Some(base.as_str()),
        "the after side is drawn by the base renderer"
    );
    let (_, revision) = snapshot::side(&comparison, false, DefinitionSource::Head).unwrap();
    assert_eq!(revision.as_deref(), Some(head.as_str()));
    assert!(snapshot::side(&side("commit", &base), true, DefinitionSource::Base).is_err());
}
