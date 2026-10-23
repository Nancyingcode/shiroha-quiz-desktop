use shiroha_quiz_desktop::service_config::{Service, ServiceConfig};

fn config(endpoint: &str) -> ServiceConfig {
    ServiceConfig {
        service: Service::Webdav,
        endpoint: endpoint.into(),
        username: "user".into(),
        remote_dir: "ShirohaQuiz/Web".into(),
    }
}

#[test]
fn endpoints_are_normalized_without_embedded_auth_or_url_secrets() {
    let canonical = config("https://EXAMPLE.com:443/dav/").normalize().unwrap();
    assert_eq!(canonical.endpoint.as_str(), "https://example.com/dav/");
    for endpoint in [
        "file:///tmp/a",
        "https://user:pass@example.com/",
        "https://example.com/?key=secret",
        "https://example.com/#secret",
        "https://example.com/a/../dav",
        "https://example.com/%2e%2e/dav",
    ] {
        assert!(config(endpoint).normalize().is_err(), "{endpoint}");
    }
    assert!(config("http://127.0.0.1:1234/dav").normalize().is_ok());
}

#[test]
fn dav_objects_and_redirects_cannot_escape_the_configured_directory() {
    let config = config("https://example.com/dav").normalize().unwrap();
    assert_eq!(
        config.object("latest.json").unwrap().as_str(),
        "https://example.com/dav/ShirohaQuiz/Web/latest.json"
    );
    for path in [
        "../outside",
        "%2e%2e/outside",
        "/outside",
        "https://other.com/file",
        "a\\b",
        "a?b",
        "a#b",
        "%252e%252e/outside",
    ] {
        assert!(config.object(path).is_err(), "{path}");
    }
    let source = config.object("latest.json").unwrap();
    assert!(config.redirect(&source, "https://other.com/file").is_err());
    assert!(config.redirect(&source, "/other/latest.json").is_err());
    assert!(config
        .redirect(
            &source,
            "http://example.com/dav/ShirohaQuiz/Web/latest.json"
        )
        .is_err());
    assert!(config.redirect(&source, "next.json").is_ok());
}

#[test]
fn binding_changes_with_service_endpoint_account_and_directory() {
    let original = config("https://example.com/dav")
        .normalize()
        .unwrap()
        .binding();
    let mut changed = config("https://example.com/dav");
    changed.username = "other".into();
    assert_ne!(original, changed.normalize().unwrap().binding());
    changed = config("https://example.com/dav");
    changed.remote_dir = "Other".into();
    assert_ne!(original, changed.normalize().unwrap().binding());
    changed = config("https://example.com/dav");
    changed.service = Service::Ai;
    assert_ne!(original, changed.normalize().unwrap().binding());
}
