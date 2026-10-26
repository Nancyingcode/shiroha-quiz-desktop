fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "local_initialize",
            "local_read",
            "local_write",
            "local_operation",
            "local_checkpoint",
            "local_migrate",
            "local_replace",
            "local_file",
            "local_task",
            "local_query",
            "local_commit",
            "service_credential",
            "service_request",
            "harness_control",
            "harness_execute",
            "codebuddy_control",
        ]),
    ))
    .expect("Unable to validate application permissions");
}
