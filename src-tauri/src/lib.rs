mod fs;
mod relay;
mod terminal;
mod types;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .manage(relay::RelayEngine::default())
        .manage(terminal::TerminalManager::default())
        .invoke_handler(tauri::generate_handler![
            // File system (F3 / F5)
            fs::list_dir,
            fs::read_file,
            fs::write_file,
            fs::pick_project_dir,
            // Relay engine (F2)
            relay::session_status,
            relay::set_project,
            relay::handoff,
            relay::packet_inspect,
            // Terminal (F4)
            terminal::spawn_terminal,
            terminal::write_stdin,
            terminal::kill_terminal,
            // Webview dock (F1)
            open_provider,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Relay");
}

fn provider_url(id: &str) -> Result<String, String> {
    match id {
        "chatgpt" => Ok("https://chat.openai.com".into()),
        "kimi" => Ok("https://kimi.moonshot.cn".into()),
        "qwen" => Ok("https://tongyi.aliyun.com".into()),
        "gemini" => Ok("https://gemini.google.com".into()),
        other => Err(format!("unknown provider: {other}")),
    }
}

/// F1 — spawn a provider webview window.
///
/// v0.1 status: opens the provider page with a stub preload injected.
/// The DOM-bridge wiring (mutation observers, typed `relay:*` IPC events) is
/// the Phase 1 platform spike per PRD §8.3 / Complete Docs §7.1, because
/// preload injection into *remote* pages differs per webview (WKWebView,
/// WebView2, WebKitGTK). Note: provider windows get NO capability entry, so a
/// compromised provider page cannot reach IPC — the security posture from
/// Complete Docs §8.1 is enforced by configuration, not by luck.
#[tauri::command]
fn open_provider(app: tauri::AppHandle, provider_id: String) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let url = provider_url(&provider_id)?;
    let label = format!("provider-{provider_id}");
    if app.get_webview_window(&label).is_some() {
        return Ok(()); // already open
    }

    let preload = include_str!("../preloads/relay-bridge.js");
    WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(tauri::Url::parse(&url).map_err(|e| e.to_string())?),
    )
    .title(format!("Relay — {provider_id}"))
    .inner_size(1000.0, 800.0)
    .initialization_script(preload)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}
