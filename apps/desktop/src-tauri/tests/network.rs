use shiroha_quiz_desktop::{
    network::{Network, OutboundPolicy},
    service_config::{Service, ServiceConfig},
};
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

fn server(response: impl Into<String>) -> (String, thread::JoinHandle<String>) {
    let response = response.into();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut bytes = [0; 8192];
        let size = stream.read(&mut bytes).unwrap();
        stream.write_all(response.as_bytes()).unwrap();
        String::from_utf8_lossy(&bytes[..size]).into_owned()
    });
    (endpoint, worker)
}
fn config(endpoint: String) -> ServiceConfig {
    ServiceConfig {
        service: Service::Ai,
        endpoint,
        username: String::new(),
        remote_dir: String::new(),
    }
}

#[tokio::test]
async fn mock_request_preserves_non_success_status_without_leaking_secret() {
    let (endpoint, worker) =
        server("HTTP/1.1 401 Unauthorized\r\nContent-Length: 6\r\nConnection: close\r\n\r\nsecret");
    let client = Network::new(OutboundPolicy::Loopback).unwrap();
    let response = client
        .ai(
            &config(endpoint).normalize().unwrap(),
            "secret",
            serde_json::json!({"messages":[],"stream":false}),
        )
        .await
        .unwrap();
    assert_eq!(response.status, 401);
    assert!(!response.body.contains("secret"));
    assert!(worker.join().unwrap().contains("Bearer secret"));
}

#[tokio::test]
async fn redirects_and_oversize_are_rejected() {
    for response in ["HTTP/1.1 307 Temporary Redirect\r\nLocation: https://example.com/stolen\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", "HTTP/1.1 200 OK\r\nContent-Length: 999999999\r\nConnection: close\r\n\r\n"] {
        let(endpoint,worker)=server(response);
        let client=Network::new(OutboundPolicy::Loopback).unwrap();
        assert!(client.ai(&config(endpoint).normalize().unwrap(),"fake-key",serde_json::json!({"messages":[]})).await.is_err());
        worker.join().unwrap();
    }
}

#[tokio::test]
async fn isolation_denies_external_requests_before_connecting() {
    let client = Network::new(OutboundPolicy::Deny).unwrap();
    let result = client
        .ai(
            &config("http://127.0.0.1:1".into()).normalize().unwrap(),
            "",
            serde_json::json!({"messages":[]}),
        )
        .await;
    assert_eq!(result.err().unwrap().code, "network_denied");
    let client = Network::new(OutboundPolicy::Loopback).unwrap();
    assert_eq!(
        client
            .ai(
                &config("https://example.com".into()).normalize().unwrap(),
                "",
                serde_json::json!({"messages":[]})
            )
            .await
            .err()
            .unwrap()
            .code,
        "network_denied"
    );
}

#[tokio::test]
async fn dav_listing_rejects_foreign_hrefs_and_malformed_xml() {
    use shiroha_quiz_desktop::network::DavOperation;
    for body in ["<d:multistatus xmlns:d=\"DAV:\"><d:response><d:href>https://outside.invalid/backup/file.json</d:href></d:response></d:multistatus>","<!DOCTYPE data [<!ENTITY remote SYSTEM 'file:///secret'>]><data/>"] {
        let response=format!("HTTP/1.1 207 Multi-Status\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
        let(endpoint,worker)=server(response);
        let config=ServiceConfig{service:Service::Webdav,endpoint,username:String::new(),remote_dir:"backup".into()}.normalize().unwrap();
        let client=Network::new(OutboundPolicy::Loopback).unwrap();
        assert!(client.webdav(&config,"",DavOperation::List).await.is_err());
        worker.join().unwrap();
    }
}

#[tokio::test]
async fn https_does_not_fall_back_to_plain_http() {
    let (endpoint, worker) =
        server("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
    let client = Network::new(OutboundPolicy::Configured).unwrap();
    let result = client
        .ai(
            &config(endpoint.replacen("http:", "https:", 1))
                .normalize()
                .unwrap(),
            "",
            serde_json::json!({"messages":[]}),
        )
        .await;
    assert!(result.is_err());
    worker.join().unwrap();
}
