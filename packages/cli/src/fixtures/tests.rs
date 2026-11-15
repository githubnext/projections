use super::fingerprint;

#[test]
fn an_edit_that_keeps_length_and_mtime_is_still_a_change() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("extract.py");
    std::fs::write(&path, "print(1)").unwrap();
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    let before = fingerprint(std::slice::from_ref(&path));
    std::fs::write(&path, "print(2)").unwrap();
    std::fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(modified)
        .unwrap();
    assert_ne!(before, fingerprint(std::slice::from_ref(&path)));
}
