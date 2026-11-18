use super::*;

#[test]
fn reads_imports_as_text_like_gh_aw() {
    let front = "on: push\nimports:\n  # a comment\n  - shared/a.md\n  - uses: \"shared/b.md\"\n  - path: 'shared/c.md'\ntools:\n  - x";
    assert_eq!(imports_of(front), ["shared/a.md", "shared/b.md", "shared/c.md"]);
    let object = "imports:\n  aw:\n    - shared/a.md\n  apm-packages:\n    - pkg\n";
    assert_eq!(imports_of(object), ["shared/a.md"]);
}

#[test]
fn scans_expressions_quote_aware() {
    let found = expressions("${{ env.A }} and ${{ format('}}', vars.B) }} and ${{ 'it''s' }} ${{ open");
    let spans: Vec<&str> = found.iter().map(|(span, _)| *span).collect();
    assert_eq!(spans, ["${{ env.A }}", "${{ format('}}', vars.B) }}", "${{ 'it''s' }}"]);
    assert_eq!(relevant_expressions("${{ github.actor }} ${{ env.X }} ${{ env.X }}").len(), 1);
}

#[test]
fn writes_json_strings_as_go_does() {
    assert_eq!(go_string("<a & \"b\">\n\u{1}\u{2028}é"), "\"<a & \\\"b\\\">\\n\\u0001\\u2028é\"");
}

#[test]
fn hashes_empty_front_matter_as_the_specification_vector() {
    let document = split("---\n---\n").unwrap();
    let hashes = hashes(".github/workflows/x.md", &document, false, &|_| None).unwrap();
    assert_eq!(hashes.frontmatter, hex("{\"frontmatter-text\":\"\"}"));
    assert_eq!(hashes.body, hex(""));
}

#[test]
fn inlined_imports_hash_the_body_and_imports_add_their_front_matter() {
    let document = split("---\ninlined-imports: true\nimports:\n  - shared/a.md\n---\n# Hi ${{ env.A }}\n").unwrap();
    let read = |path: &str| {
        (path == ".github/workflows/shared/a.md").then(|| "---\nnetwork: defaults\n---\nShared ${{ github.actor }}".to_owned())
    };
    let hashes = hashes(".github/workflows/x.md", &document, true, &read).unwrap();
    let canonical = "{\"body-text\":\"# Hi ${{ env.A }}\",\"frontmatter-text\":\"inlined-imports: true\\nimports:\\n  - shared/a.md\",\"imported-frontmatters\":\"network: defaults\",\"imports\":[\"shared/a.md\"]}";
    assert_eq!(hashes.frontmatter, hex(canonical));
    assert_eq!(hashes.body, hex("# Hi ${{ env.A }}\n---\nShared ${{ github.actor }}"));
}

#[test]
fn runtime_imports_contribute_their_expressions() {
    let document = split("---\non: push\n---\n{{#runtime-import prompts/a.md:2-2}}\n").unwrap();
    let read = |path: &str| (path == ".github/prompts/a.md").then(|| "${{ github.x }}\n${{ github.y }}".to_owned());
    let hashes = hashes(".github/workflows/x.md", &document, false, &read).unwrap();
    assert_eq!(
        hashes.frontmatter,
        hex("{\"frontmatter-text\":\"on: push\",\"template-expressions\":[\"${{ github.y }}\"]}")
    );
}
