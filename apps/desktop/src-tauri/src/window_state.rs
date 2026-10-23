use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{Manager, PhysicalPosition, PhysicalSize};

#[derive(Clone, Copy, Serialize, Deserialize)]
struct Bounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl Bounds {
    fn visible_on(self, screen: Self) -> bool {
        let right = i64::from(self.x) + i64::from(self.width);
        let bottom = i64::from(self.y) + i64::from(self.height);
        self.width >= 900
            && self.height >= 640
            && self.x >= screen.x
            && self.y >= screen.y
            && right <= i64::from(screen.x) + i64::from(screen.width)
            && bottom <= i64::from(screen.y) + i64::from(screen.height)
    }
}

pub fn attach(app: &tauri::App, root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or("missing main window")?;
    let file = root.join("window-state.json");
    crate::paths::reject_links(&file)?;
    if let Ok(bytes) = std::fs::read(&file) {
        if let Ok(bounds) = serde_json::from_slice::<Bounds>(&bytes) {
            let visible = window.available_monitors()?.iter().any(|monitor| {
                let area = monitor.work_area();
                bounds.visible_on(Bounds {
                    x: area.position.x,
                    y: area.position.y,
                    width: area.size.width,
                    height: area.size.height,
                })
            });
            if visible {
                window.set_size(PhysicalSize::new(bounds.width, bounds.height))?;
                window.set_position(PhysicalPosition::new(bounds.x, bounds.y))?;
            } else {
                window.center()?;
            }
        }
    }
    let observed = window.clone();
    // 只在关闭请求时记录普通窗口，避免最大化/最小化坐标污染下次启动；不保存题库数据。
    window.on_window_event(move |event| {
        if !matches!(event, tauri::WindowEvent::CloseRequested { .. })
            || observed.is_maximized().unwrap_or(true)
            || observed.is_minimized().unwrap_or(true)
        {
            return;
        }
        let result = (|| -> Result<(), Box<dyn std::error::Error>> {
            let position = observed.outer_position()?;
            let size = observed.inner_size()?;
            let bounds = Bounds {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            };
            crate::paths::reject_links(&file)?;
            std::fs::write(&file, serde_json::to_vec(&bounds)?)?;
            Ok(())
        })();
        if result.is_err() {
            // 窗口偏好失败不影响题库保存；下次使用安全默认位置。
            eprintln!("window preferences could not be saved");
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Bounds;

    #[test]
    fn rejects_disconnected_monitor_overflow_and_invalid_sizes() {
        let screen = Bounds {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        assert!(Bounds {
            x: -1800,
            y: 50,
            width: 1280,
            height: 860
        }
        .visible_on(screen));
        for bounds in [
            Bounds {
                x: 100,
                y: 50,
                width: 1280,
                height: 860,
            },
            Bounds {
                x: -1800,
                y: 50,
                width: u32::MAX,
                height: 860,
            },
            Bounds {
                x: -1800,
                y: 50,
                width: 100,
                height: 100,
            },
        ] {
            assert!(!bounds.visible_on(screen));
        }
    }
}
