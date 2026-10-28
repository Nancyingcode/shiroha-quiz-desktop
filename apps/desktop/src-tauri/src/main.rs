#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use shiroha_quiz_desktop::commands::{self, LocalData};
use std::sync::{Arc, Mutex};
use tauri::Manager;

fn main() {
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("--codebuddy-worker")) {
        #[cfg(all(windows, not(feature = "native-test")))]
        if std::env::args_os().count() == 2
            && shiroha_quiz_desktop::harness_codebuddy::run_worker().is_ok()
        {
            return;
        }
        std::process::exit(1);
    }
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(feature = "native-test")]
            let root = {
                let value = std::env::var_os("SHIROHA_TEST_ROOT").ok_or("缺少隔离测试目录")?;
                shiroha_quiz_desktop::paths::test_root(
                    std::path::Path::new(&value),
                    &std::env::temp_dir(),
                )?
            };
            #[cfg(not(feature = "native-test"))]
            let root = {
                if std::env::var_os("SHIROHA_TEST_ROOT").is_some() {
                    return Err("正式构建不接受测试目录覆盖".into());
                }
                app.path()
                    .app_local_data_dir()?
                    .join(if cfg!(debug_assertions) {
                        "development"
                    } else {
                        "local-data"
                    })
            };
            app.manage(commands::LocalFiles::default());
            app.manage(Arc::new(
                shiroha_quiz_desktop::services::Services::open(&root)
                    .map_err(|error| std::io::Error::other(error.code))?,
            ));
            app.manage(shiroha_quiz_desktop::tasks::Tasks::default());
            let codebuddy_login = shiroha_quiz_desktop::harness_codebuddy_login::Login::open(&root);
            app.manage(codebuddy_login.clone());
            app.manage(Arc::new(
                shiroha_quiz_desktop::harness::Harness::open_with_codebuddy(&root, codebuddy_login),
            ));
            shiroha_quiz_desktop::window_state::create(app, &root)?;
            app.manage(LocalData(Arc::new(Mutex::new(None)), root));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::local_initialize,
            commands::local_read,
            commands::local_write,
            commands::local_operation,
            commands::local_checkpoint,
            commands::local_migrate,
            commands::local_replace,
            commands::local_file,
            commands::local_task,
            commands::local_query,
            commands::local_commit,
            shiroha_quiz_desktop::services::service_credential,
            shiroha_quiz_desktop::services::service_request,
            shiroha_quiz_desktop::harness::harness_control,
            shiroha_quiz_desktop::harness::harness_execute,
            shiroha_quiz_desktop::harness_codebuddy_login::codebuddy_control
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Shiroha Quiz");
}
