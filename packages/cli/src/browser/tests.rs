use super::websocket::{read_frame, write_frame};
use super::*;

#[test]
fn base64_round_trips() {
    for text in ["", "f", "fo", "foo", "foob", "fooba", "foobar"] {
        let encoded = base64_encode(text.as_bytes());
        assert_eq!(base64_decode(&encoded).unwrap(), text.as_bytes());
    }
    assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    assert_eq!(base64_encode(b"fo"), "Zm8=");
    assert!(base64_decode("Zm9v!").is_err());
}

#[test]
fn websocket_frames_round_trip_masked_and_long() {
    for length in [0, 125, 126, 65_535, 65_536, 200_000] {
        let payload: Vec<u8> = (0..length).map(|index| (index % 251) as u8).collect();
        let mut frame = Vec::new();
        write_frame(&mut frame, 0x1, &payload).unwrap();
        let (fin, opcode, read) = read_frame(&mut frame.as_slice(), usize::MAX).unwrap();
        assert!(fin);
        assert_eq!(opcode, 0x1);
        assert_eq!(read, payload);
    }
    let mut frame = Vec::new();
    write_frame(&mut frame, 0x1, &[0; 300]).unwrap();
    assert!(read_frame(&mut frame.as_slice(), 299).is_err());
}

#[test]
fn a_missing_explicit_browser_names_the_option() {
    let error = find(Some(Path::new("/nonexistent/chrome"))).unwrap_err();
    assert!(error.to_string().contains("--browser"), "{error}");
}
