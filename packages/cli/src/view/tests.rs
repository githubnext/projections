use axum::{body::Body, extract::Request, http::header};

use super::routes::loopback_host;

fn request(host: Option<&str>) -> Request {
    let mut builder = Request::builder().uri("/t/");
    if let Some(host) = host {
        builder = builder.header(header::HOST, host);
    }
    builder.body(Body::empty()).unwrap()
}

#[test]
fn only_loopback_hosts_on_this_port_are_answered() {
    assert!(loopback_host(&request(Some("127.0.0.1:4000")), 4000));
    assert!(loopback_host(&request(Some("localhost:4000")), 4000));
    assert!(loopback_host(&request(Some("[::1]:4000")), 4000));
    assert!(!loopback_host(&request(Some("127.0.0.1:4001")), 4000));
    assert!(!loopback_host(&request(Some("evil.example:4000")), 4000));
    assert!(!loopback_host(&request(None), 4000));
}
