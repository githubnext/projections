use std::path::Path;
use std::process::Command;

#[test]
fn helper_is_valid_python_without_importing_django_or_running_target_code() {
    let helper = Path::new(env!("CARGO_MANIFEST_DIR")).join("helper");
    let output = Command::new("python3")
        .args([
            "-c",
            "import sys; from pathlib import Path\n\
             for p in sorted(Path(sys.argv[1]).glob('*.py')): compile(p.read_text(), str(p), 'exec')",
        ])
        .arg(&helper)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .output()
        .expect("Python 3 is required to check the Django helper");
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}
