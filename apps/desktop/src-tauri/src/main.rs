#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! 桌面壳：随包引擎（gohomebuddy-engine）+ stdio↔WebSocket 桥。
//! 前端 ProtocolClient 连 127.0.0.1:1421，桥把 WS 帧与引擎的 stdio JSONL
//! 互转——协议与纯浏览器开发流程（node sidecar + node 桥）完全一致。

use futures_util::{SinkExt, StreamExt};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;
use tauri::Manager;
use tokio_tungstenite::tungstenite::Message;

type WsSink = Arc<
    Mutex<
        Option<
            futures_util::stream::SplitSink<
                tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
                Message,
            >,
        >,
    >,
>;

const WS_ADDR: &str = "127.0.0.1:1421";

struct AppState {
    engine: Mutex<Option<Child>>,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    ws: WsSink,
}

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// 随包引擎：Tauri externalBin 把它放在主程序同目录。
fn engine_path() -> Result<PathBuf, String> {
    let mut p = std::env::current_exe().map_err(|e| e.to_string())?;
    p.pop();
    p.push("gohomebuddy-engine");
    if cfg!(windows) {
        p.set_extension("exe");
    }
    if p.exists() {
        Ok(p)
    } else {
        Err(format!("引擎二进制不存在: {}", p.display()))
    }
}

fn main() {
    let stdin = Arc::new(Mutex::new(None::<ChildStdin>));
    let ws: WsSink = Arc::new(Mutex::new(None));
    tauri::Builder::default()
        .manage(AppState {
            engine: Mutex::new(None),
            stdin: stdin.clone(),
            ws: ws.clone(),
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = run_bridge(&handle, stdin, ws).await {
                    eprintln!("[bridge] 引擎桥启动失败: {e}");
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // 应用退出时终结引擎进程
                if let Some(mut child) = app
                    .state::<AppState>()
                    .engine
                    .blocking_lock()
                    .take()
                {
                    let _ = child.start_kill();
                }
            }
        });
}

async fn run_bridge(
    app: &tauri::AppHandle,
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    ws_sink: WsSink,
) -> Result<(), String> {
    let engine = engine_path()?;
    let home = home_dir();
    let agent_dir = home.join(".office-agent").join("pi");
    let workspace = home.join("office-agent-workspace");

    let mut child = Command::new(&engine)
        .args([
            "--agent-dir",
            &agent_dir.to_string_lossy(),
            "--cwd",
            &workspace.to_string_lossy(),
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .map_err(|e| format!("启动引擎失败: {e}"))?;
    let child_stdin = child.stdin.take();
    let stdout = child.stdout.take();
    *app.state::<AppState>().engine.lock().await = Some(child);
    *stdin.lock().await = child_stdin;

    // 引擎 stdout（JSONL）→ 转发给当前 WS 客户端
    if let Some(out) = stdout {
        let ws = ws_sink.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut sink = ws.lock().await;
                if let Some(s) = sink.as_mut() {
                    let _ = s.send(Message::Text(line)).await;
                }
            }
            eprintln!("[bridge] 引擎 stdout 已关闭");
        });
    }

    // WS 监听：单客户端守卫，新连接顶替旧连接（旧 sink 被替换后旧链路自然断开）
    let listener = TcpListener::bind(WS_ADDR)
        .await
        .map_err(|e| format!("绑定 {WS_ADDR} 失败: {e}"))?;
    eprintln!("[bridge] 引擎桥就绪 ws://{WS_ADDR}");
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            continue;
        };
        let ws = match tokio_tungstenite::accept_async(stream).await {
            Ok(ws) => ws,
            Err(e) => {
                eprintln!("[bridge] WS 握手失败: {e}");
                continue;
            }
        };
        let (sink, mut read) = ws.split();
        *ws_sink.lock().await = Some(sink);
        let stdin = stdin.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        let mut input = stdin.lock().await;
                        if let Some(s) = input.as_mut() {
                            if s.write_all(text.as_bytes()).await.is_err()
                                || s.write_all(b"\n").await.is_err()
                            {
                                break;
                            }
                            let _ = s.flush().await;
                        }
                    }
                    Ok(Message::Close(_)) | Err(_) => break,
                    _ => {}
                }
            }
        });
    }
}
