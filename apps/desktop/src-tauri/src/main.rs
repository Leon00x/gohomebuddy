#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::Manager;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

struct Bridge(Mutex<Option<Child>>);

fn main() {
    // 仓库根：编译时固化，供打包后的程序定位桥脚本与运行时资源。
    let root = std::env::var("OFFICE_AGENT_ROOT")
        .unwrap_or_else(|_| env!("OFFICE_AGENT_ROOT").to_string());

    tauri::Builder::default()
        .manage(Bridge(Mutex::new(None)))
        .setup(move |app| {
            let node = std::env::var("OFFICE_NODE").unwrap_or_else(|_| "node".to_string());
            let bridge = format!("{}/apps/desktop/scripts/bridge.mjs", root);
            let child = Command::new(node)
                .arg(bridge)
                .current_dir(&root)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("failed to spawn local engine bridge");
            *app.state::<Bridge>().0.lock().unwrap() = Some(child);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(child) = app
                    .state::<Bridge>()
                    .0
                    .lock()
                    .unwrap()
                    .as_mut()
                {
                    let _ = child.kill();
                }
            }
        });
}
