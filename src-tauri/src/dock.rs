//! F1 — embedded multi-model webview dock.
//!
//! Each provider gets a *child webview* of the main window (Tauri
//! multiwebview, `unstable` feature; wry supports child webviews on Windows
//! via WebView2 composition). The frontend reports the dock's webview area
//! bounds in CSS pixels and the dock glues the native webview to that spot,
//! so provider UIs render embedded in the sidebar.
//!
//! Security (Complete Docs §8.1 / §8.5): provider pages are remote third-party
//! sites and get **no Tauri IPC** — this Tauri version has no remote-domain
//! IPC access, so the framework itself guarantees a compromised provider page
//! cannot invoke commands or read app state. Handoff injection is *assisted*:
//! the Relay Packet is baked into the webview's initialization script, which
//! fills the provider's input field; the user reviews and presses Enter.
//!
//! Diagnostics: every operation is appended to `~/.relay/dock.log` and page
//! load events are streamed to the UI (`relay://dock-load`), so a provider
//! that fails to load shows a message instead of a silent black pane.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::Value;
use tauri::{
    webview::PageLoadEvent, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager,
    State, Webview, WebviewBuilder, WebviewUrl,
};

use crate::relay::RelayEngine;

pub struct DockManager {
    /// provider id -> child webview
    webviews: Mutex<HashMap<String, Webview>>,
}

impl Default for DockManager {
    fn default() -> Self {
        Self {
            webviews: Mutex::new(HashMap::new()),
        }
    }
}

fn log_line(msg: &str) {
    let Some(home) = dirs::home_dir() else {
        return;
    };
    let relay_dir = home.join(".relay");
    let _ = std::fs::create_dir_all(&relay_dir);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(relay_dir.join("dock.log"))
    {
        use std::io::Write;
        let _ = writeln!(f, "{} {msg}", chrono::Utc::now().to_rfc3339());
    }
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

/// Build the injection prompt from a Relay Packet (PRD §6.2 template).
fn injection_prompt(packet: &Value) -> String {
    let project = packet["project_context"]["root_path"]
        .as_str()
        .unwrap_or("");
    let files = packet["project_context"]["active_files"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let task = packet["conversation_summary"]["current_task"]
        .as_str()
        .unwrap_or("Continue the session");
    let blockers = packet["conversation_summary"]["blockers"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join("; ")
        })
        .unwrap_or_default();
    let output = packet["terminal_state"]["recent_output"]
        .as_str()
        .unwrap_or("");

    let blockers_line = if blockers.is_empty() {
        String::new()
    } else {
        format!("BLOCKER: {blockers}\n")
    };
    let output_line = if output.is_empty() {
        String::new()
    } else {
        format!("RECENT TERMINAL OUTPUT:\n{output}\n\n")
    };

    format!(
        "You are continuing a coding session that was being handled by another AI assistant.\n\
         Here is the compacted context:\n\n\
         PROJECT: {project}\n\
         ACTIVE FILES: {files}\n\
         CURRENT TASK: {task}\n\
         {blockers_line}\
         {output_line}\
         Please continue helping with this task. The user is waiting.",
    )
}

/// The preload script, optionally carrying an injection payload.
fn preload_script(inject: Option<(&str, &Value)>) -> String {
    let base = include_str!("../preloads/relay-bridge.js");
    match inject {
        Some((provider, packet)) => {
            let prompt = serde_json::to_string(&injection_prompt(packet)).unwrap_or_default();
            let provider_json = serde_json::to_string(provider).unwrap_or_default();
            format!(
                "window.__RELAY_INJECT__ = {{\"provider\": {provider_json}, \"prompt\": {prompt}}};\n{base}"
            )
        }
        None => base.to_string(),
    }
}

fn main_window(app: &AppHandle) -> Result<tauri::Window, String> {
    app.get_window("main")
        .ok_or_else(|| "main window not found".to_string())
}

/// A child webview for a provider, with the preload (and optionally an
/// injection payload) and page-load diagnostics attached.
fn build_provider_webview(
    app: &AppHandle,
    provider: &str,
    inject: Option<(&str, &Value)>,
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
) -> Result<Webview, String> {
    let url = provider_url(provider)?;
    let provider2 = provider.to_string();
    let app2 = app.clone();
    let builder = WebviewBuilder::new(
        format!("provider-{provider}"),
        WebviewUrl::External(tauri::Url::parse(&url).map_err(|e| e.to_string())?),
    )
    .initialization_script(preload_script(inject))
    .on_page_load(move |_webview, payload| {
        let evt = match payload.event() {
            PageLoadEvent::Started => "started",
            PageLoadEvent::Finished => "finished",
        };
        log_line(&format!("{provider2} page {evt}: {}", payload.url()));
        let _ = app2.emit(
            "relay://dock-load",
            (provider2.clone(), evt, payload.url().to_string()),
        );
    });
    let window = main_window(app)?;
    let webview = window
        .add_child(builder, position, size)
        .map_err(|e| {
            log_line(&format!("add_child FAILED for {provider}: {e}"));
            e.to_string()
        })?;
    log_line(&format!("add_child ok: {provider}"));
    Ok(webview)
}

fn get_or_create(app: &AppHandle, dock: &DockManager, provider: &str) -> Result<Webview, String> {
    if let Some(webview) = dock.webviews.lock().unwrap().get(provider) {
        return Ok(webview.clone());
    }
    log_line(&format!("create child webview: {provider}"));
    // Start at 1x1; the frontend reports the real bounds immediately after.
    let webview = build_provider_webview(
        app,
        provider,
        None,
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(1.0, 1.0),
    )?;
    dock.webviews
        .lock()
        .unwrap()
        .insert(provider.to_string(), webview.clone());
    Ok(webview)
}

/// F1 — show the provider's embedded webview (creating it on first use) and
/// mark it active; all other provider webviews are hidden.
///
/// ASYNC REQUIRED: `Window::add_child` posts to the main event loop and then
/// blocks waiting for the result. Sync commands run on the main thread, so
/// calling it from one deadlocks (observed live: `create child webview` logged
/// but `add_child` never returned). Async commands run on the tokio runtime,
/// leaving the main loop free to service the posted task.
#[tauri::command]
pub async fn dock_activate(
    app: AppHandle,
    dock: State<'_, DockManager>,
    engine: State<'_, RelayEngine>,
    provider: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    log_line(&format!("dock_activate {provider} bounds=({x},{y} {width}x{height})"));
    let webview = get_or_create(&app, &dock, &provider)?;
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    webview.show().map_err(|e| e.to_string())?;
    for (id, w) in dock.webviews.lock().unwrap().iter() {
        if id != &provider {
            let _ = w.hide();
        }
    }
    engine.provider_activated(&provider);
    let _ = app.emit("relay://dock-active", &provider);
    log_line(&format!("dock_activate done: {provider}"));
    Ok(())
}

/// F1 — keep the embedded webview glued to the dock area (called on layout
/// changes and window resizes). No-op if the provider was never activated.
#[tauri::command]
pub async fn dock_set_bounds(
    dock: State<'_, DockManager>,
    provider: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webviews = dock.webviews.lock().unwrap();
    let Some(webview) = webviews.get(&provider) else {
        return Ok(());
    };
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// F6/F5/F4 — read AI output from the provider page. Remote pages have no IPC
/// in this Tauri version, so the only channel is `eval_with_callback`: we
/// evaluate a tiny script in the child webview that runs the preload's
/// `__relay_scan_dom()` (a shadow-DOM-aware extraction of code blocks,
/// commands, rate-limit signals). The UI turns those into user-confirmed
/// [Apply]/[▶ Run] actions.
#[tauri::command]
pub async fn dock_scan(
    dock: State<'_, DockManager>,
    provider: String,
) -> Result<Value, String> {
    let Some(webview) = dock.webviews.lock().unwrap().get(&provider).cloned() else {
        return Ok(serde_json::json!({ "scanned": false, "provider": provider }));
    };
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let js = r#"JSON.stringify((() => {
      try {
        if (typeof window.__relay_scan_dom === "function") return window.__relay_scan_dom();
        // Preload not visible from this eval context — report DOM facts so
        // the dock can tell a missing-preload from an empty conversation.
        return {
          scanned: false,
          preload_missing: true,
          has_relay_state: !!window.__relay_state__,
          pres: document.querySelectorAll("pre").length,
        };
      } catch (e) { return { scanned: false, error: String(e) }; }
    })())"#;
    let _ = webview.eval_with_callback(js, move |res| {
        let _ = tx.send(res);
    });
    let res = tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_millis(3000))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|_| format!("{provider} scan timed out"))?;
    // Never fail the poll on eval errors — return a partial state so the UI
    // keeps polling instead of surfacing an error the user can't act on.
    match serde_json::from_str::<Value>(&res) {
        Ok(value) => {
            let msgs = value
                .get("messages_seen")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let diag = value.get("diag").cloned().unwrap_or(serde_json::json!({}));
            let missing = value
                .get("preload_missing")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let nodes = diag.get("nodes").and_then(|v| v.as_u64()).unwrap_or(0);
            let pres = diag.get("pres").and_then(|v| v.as_u64()).unwrap_or(0);
            let err = diag
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            log_line(&format!(
                "scan {provider}: {} msgs (nodes={nodes}, pre={pres}{}{})",
                msgs,
                if missing { ", preload MISSING" } else { "" },
                if err.is_empty() { String::new() } else { format!(", err={err}") },
            ));
            Ok(value)
        }
        Err(_) => Ok(serde_json::json!({
            "scanned": false,
            "provider": provider,
            "error": res,
        })),
    }
}

/// F3 — give the AI read access to the project by filling its input with a
/// context bundle (file tree + open files). The user reviews and sends it;
/// Relay never sends on the user's behalf.
#[tauri::command]
pub async fn dock_context(
    app: AppHandle,
    dock: State<'_, DockManager>,
    provider: String,
    text: String,
) -> Result<(), String> {
    let webview = get_or_create(&app, &dock, &provider)?;
    let payload = serde_json::to_string(&text).map_err(|e| e.to_string())?;
    let js = format!("window.__relay_fill && window.__relay_fill({payload}); 'ok'");
    webview.eval(js).map_err(|e| e.to_string())?;
    log_line(&format!("context sent to {provider} ({} chars)", text.len()));
    Ok(())
}

/// F2 — assisted handoff injection: recreate the target provider's webview
/// with the Relay Packet baked into its initialization script. The preload
/// fills the input field and copies the prompt to the clipboard; the user
/// reviews and presses Enter. Nothing is sent automatically (§8.5).
///
/// Async for the same reason as [`dock_activate`] (add_child deadlocks the
/// main thread from a sync command).
#[tauri::command]
pub async fn dock_inject(
    app: AppHandle,
    dock: State<'_, DockManager>,
    engine: State<'_, RelayEngine>,
    provider: String,
    packet: Value,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    log_line(&format!("dock_inject -> {provider}"));
    if let Some(webview) = dock.webviews.lock().unwrap().remove(&provider) {
        let _ = webview.close();
    }
    let webview = build_provider_webview(
        &app,
        &provider,
        Some((&provider, &packet)),
        LogicalPosition::new(x, y),
        LogicalSize::new(width, height),
    )?;
    webview.show().map_err(|e| e.to_string())?;
    dock.webviews
        .lock()
        .unwrap()
        .insert(provider.clone(), webview);
    for (id, w) in dock.webviews.lock().unwrap().iter() {
        if id != &provider {
            let _ = w.hide();
        }
    }
    engine.provider_activated(&provider);
    let _ = app.emit("relay://injected", &provider);
    log_line(&format!("dock_inject done: {provider}"));
    Ok(())
}

/// Fallback for setups where child webviews are unavailable: open the
/// provider in a normal separate window (still with the preload script and
/// no IPC capability — same security posture).
#[tauri::command]
pub async fn provider_open_window(app: AppHandle, provider: String) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;
    let url = provider_url(&provider)?;
    let label = format!("provider-window-{provider}");
    if app.get_webview_window(&label).is_some() {
        return Ok(()); // already open
    }
    WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(tauri::Url::parse(&url).map_err(|e| e.to_string())?),
    )
    .title(format!("Relay - {provider}"))
    .inner_size(1100.0, 800.0)
    .initialization_script(preload_script(None))
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}
