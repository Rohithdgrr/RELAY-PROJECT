//! Updateable provider selector registry.
//!
//! The provider DOM is volatile (Complete Docs §16 appendix A is explicitly
//! community-maintained): ChatGPT/Kimi/Qwen/Gemini can rework their markup at
//! any time. Rather than shipping selector changes in app updates, the
//! registry reads a user-editable JSON file at `~/.relay/selectors.json`
//! (written from the bundled defaults on first run) and injects it into every
//! provider webview as `window.__RELAY_SELECTORS__`. The preload merges it
//! over its own defaults. Edits apply on the next provider-tab switch — no
//! rebuild, no app restart required.

use serde_json::Value;
use std::path::PathBuf;

/// Bundled defaults — the values the preload ships with. Kept in sync with
/// the preload's DEFAULT_SELECTORS; the registry file overrides these.
pub const BUNDLED_JSON: &str = r##"{
  "version": 1,
  "providers": {
    "chatgpt": {
      "input": ["#prompt-textarea"],
      "assistant": ["[data-message-author-role='assistant']"]
    },
    "kimi": {
      "input": ["textarea[placeholder*='输入']"],
      "assistant": [".chat-message-assistant", "[class*='chat-message-assistant']"]
    },
    "qwen": {
      "input": ["#chat-input"],
      "assistant": [".message-bot", "[class*='message-bot']"]
    },
    "gemini": {
      "input": [
        "div.ql-editor[contenteditable='true']",
        "textarea[placeholder]",
        "rich-textarea"
      ],
      "assistant": [
        "model-response",
        "message-content",
        "model-response-text",
        ".model-response-text",
        ".response-container",
        "[class*='response']"
      ]
    }
  }
}"##;

pub fn registry_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".relay")
        .join("selectors.json")
}

/// Write the bundled defaults to `~/.relay/selectors.json` if missing.
pub fn ensure_registry_file() {
    let path = registry_path();
    if path.exists() {
        return;
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, BUNDLED_JSON);
}

/// Load the registry: the user override file when valid, bundled defaults
/// otherwise. Returns the JSON object injected into provider webviews.
pub fn load_registry() -> Value {
    ensure_registry_file();
    let raw = std::fs::read_to_string(registry_path())
        .unwrap_or_else(|_| BUNDLED_JSON.to_string());
    match serde_json::from_str::<Value>(&raw) {
        Ok(v) => v,
        // A malformed user file must never break the app — fall back.
        Err(_) => serde_json::from_str(BUNDLED_JSON).unwrap_or_else(|_| serde_json::json!({})),
    }
}
