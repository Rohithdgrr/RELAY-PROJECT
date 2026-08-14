//! F2 — the Relay Engine: session store + handoff orchestration.
//!
//! v0.1 status: session persistence and packet generation work end-to-end and
//! are driven by the multi-signal policy (PRD §6.2). The DOM capture and
//! injection legs are the Phase 1 platform spike: transcripts arrive from the
//! provider preload scripts as `relay:*` events, and injection is a
//! user-confirmed assisted action (Complete Docs §8.5) — never headless.

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, State};

use crate::fs;
use crate::terminal::TerminalManager;
use crate::types::{
    CodeChange, ConversationSummary, HandoffEvent, ProjectContext, ProviderId, ProviderState,
    ProviderStatus, RelayPacket, SessionState, TerminalState,
};

/// What the dock scan captured from a provider page (rolling buffer of recent
/// assistant messages + code blocks the model produced). Fed into the next
/// handoff packet so the target model gets the source conversation.
#[derive(Clone, Default)]
pub struct CapturedOutput {
    pub history: Vec<String>,
    pub code_changes: Vec<CodeChange>,
}

pub struct RelayEngine {
    session: Mutex<SessionState>,
    packet_dir: PathBuf,
    captured: Mutex<std::collections::HashMap<String, CapturedOutput>>,
}

impl Default for RelayEngine {
    fn default() -> Self {
        let relay_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".relay");
        let packet_dir = relay_dir.join("sessions");
        let _ = std::fs::create_dir_all(&packet_dir);

        // Seed the provider registry (Complete Docs §4.3: connect models manually).
        let providers = vec![
            ProviderState {
                id: ProviderId::Chatgpt,
                status: ProviderStatus::NotAuthenticated,
                last_used: None,
                conversation_length: 0,
            },
            ProviderState {
                id: ProviderId::Kimi,
                status: ProviderStatus::NotAuthenticated,
                last_used: None,
                conversation_length: 0,
            },
            ProviderState {
                id: ProviderId::Qwen,
                status: ProviderStatus::NotAuthenticated,
                last_used: None,
                conversation_length: 0,
            },
            ProviderState {
                id: ProviderId::Gemini,
                status: ProviderStatus::NotAuthenticated,
                last_used: None,
                conversation_length: 0,
            },
        ];

        RelayEngine {
            session: Mutex::new(SessionState {
                id: uuid::Uuid::new_v4().to_string(),
                name: "Untitled session".into(),
                project_path: None,
                created_at: now_iso(),
                active_provider: None,
                providers,
                handoffs: vec![],
            }),
            packet_dir,
            captured: Mutex::new(std::collections::HashMap::new()),
        }
    }
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Pick the next provider: round-robin over the user's providers, skipping the
/// source and any rate-limited/errored ones; falls back to static order.
fn next_provider(source: &ProviderId, providers: &[ProviderState]) -> ProviderId {
    if let Some(p) = providers.iter().find(|p| {
        p.id != *source && p.status != ProviderStatus::RateLimited && p.status != ProviderStatus::Error
    }) {
        return p.id.clone();
    }
    if let Some(p) = providers.iter().find(|p| p.id != *source) {
        return p.id.clone();
    }
    // Empty registry fallback: static order, never back to the source.
    let order = [
        ProviderId::Chatgpt,
        ProviderId::Kimi,
        ProviderId::Qwen,
        ProviderId::Gemini,
    ];
    order
        .iter()
        .find(|p| **p != *source)
        .cloned()
        .unwrap_or(ProviderId::Kimi)
}

impl RelayEngine {
    /// F1 — mark a provider as the active dock tab and update the registry:
    /// the active provider becomes 🟢 Active, previously opened ones become
    /// 🟡 Standby, untouched ones stay ⚪ Not Authenticated.
    pub fn provider_activated(&self, provider: &str) {
        let mut session = self.session.lock().unwrap();
        let Some(id) = ProviderId::from_label(provider) else {
            return;
        };
        for p in session.providers.iter_mut() {
            if p.id == id {
                p.status = ProviderStatus::Active;
                p.last_used = Some(now_iso());
            } else if p.status != ProviderStatus::NotAuthenticated {
                p.status = ProviderStatus::Standby;
            }
        }
        session.active_provider = Some(id);
    }

    /// Store what the dock scan captured for a provider: the rolling buffer
    /// of recent assistant messages and the code blocks the model produced.
    /// The next handoff from this provider folds this into the packet.
    pub fn record_output(&self, provider: &str, scan: &serde_json::Value) {
        let mut captured = self.captured.lock().unwrap();
        let entry = captured.entry(provider.to_string()).or_insert_with(|| CapturedOutput {
            history: vec![],
            code_changes: vec![],
        });
        if let Some(recent) = scan.get("recent").and_then(|v| v.as_array()) {
            entry.history = recent
                .iter()
                .filter_map(|m| m.get("text").and_then(|t| t.as_str()).map(|s| s.to_string()))
                .collect();
        }
        if let Some(ops) = scan.get("file_ops").and_then(|v| v.as_array()) {
            entry.code_changes = ops
                .iter()
                .filter_map(|op| {
                    let file = op.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let code = op.get("code").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    if code.is_empty() {
                        return None;
                    }
                    let summary = code.lines().next().unwrap_or("").trim().to_string();
                    let diff = if code.len() > 2000 {
                        Some(code.chars().take(2000).collect())
                    } else {
                        Some(code)
                    };
                    Some(CodeChange {
                        file,
                        operation: "modified".into(),
                        summary,
                        diff,
                    })
                })
                .collect();
        }
    }
}

#[tauri::command]
pub fn session_status(engine: State<'_, RelayEngine>) -> SessionState {
    engine.session.lock().unwrap().clone()
}

#[tauri::command]
pub fn set_project(engine: State<'_, RelayEngine>, path: String) -> Result<(), String> {
    let mut session = engine.session.lock().unwrap();
    session.project_path = Some(path);
    session.name = session
        .project_path
        .as_ref()
        .and_then(|p| std::path::Path::new(p).file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("Untitled session")
        .to_string();
    Ok(())
}

/// F2 — orchestrate a handoff: capture → compact → switch → emit packet.
///
/// Capture/compaction of the *conversation* leg comes from preload `relay:*`
/// events in a later phase; v0.1 already captures project + terminal state,
/// generates a schema-valid packet, persists it to `~/.relay/sessions/`, and
/// emits `relay://handoff` so the UI can show the packet inspector.
#[tauri::command]
pub fn handoff(
    app: AppHandle,
    engine: State<'_, RelayEngine>,
    terminals: State<'_, TerminalManager>,
    reason: Option<String>,
) -> Result<RelayPacket, String> {
    let mut session = engine.session.lock().unwrap();

    let source = session
        .active_provider
        .clone()
        .unwrap_or(ProviderId::Chatgpt);
    let target = next_provider(&source, &session.providers);
    session.active_provider = Some(target.clone());

    let project = session.project_path.clone().unwrap_or_default();
    let (active_files, summaries, dependencies) = fs::project_context(&project);
    let terminal_state: TerminalState = terminals.snapshot();

    // Fold in whatever the dock scan captured from the source provider
    // (recent assistant messages + code blocks) so the packet carries the
    // actual conversation, not just project + terminal state.
    let captured = engine
        .captured
        .lock()
        .unwrap()
        .get(source.label())
        .cloned();
    let (total_exchanges, raw_log, code_changes) = match captured {
        Some(c) => {
            let log = if c.history.is_empty() {
                None
            } else {
                Some(c.history.join("\n\n---\n\n"))
            };
            (c.history.len(), log, c.code_changes)
        }
        None => (0, None, vec![]),
    };

    let packet = RelayPacket {
        relay_version: "1.0".into(),
        session_id: session.id.clone(),
        created_at: now_iso(),
        source_model: source.label().into(),
        target_model: target.label().into(),
        project_context: ProjectContext {
            root_path: project,
            language: None,
            framework: None,
            active_files,
            file_summaries: summaries,
            dependencies,
        },
        conversation_summary: ConversationSummary {
            total_exchanges,
            user_goals: vec![],
            key_decisions: vec![],
            current_task: "Continue the session from the previous model".into(),
            blockers: vec![],
            code_changes,
        },
        terminal_state,
        pending_operations: vec![],
        raw_conversation_log: raw_log,
    };

    let path = engine.packet_dir.join(format!("{}.json", packet.session_id));
    let json = serde_json::to_string_pretty(&packet).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;

    session.handoffs.push(HandoffEvent {
        at: packet.created_at.clone(),
        from: packet.source_model.clone(),
        to: packet.target_model.clone(),
        reason: reason.unwrap_or_else(|| "manual".into()),
        packet_path: path.display().to_string(),
    });

    let _ = app.emit("relay://handoff", &packet);
    Ok(packet)
}

/// F9 (P2) — inspect a persisted Relay Packet from the packet store.
#[tauri::command]
pub fn packet_inspect(
    engine: State<'_, RelayEngine>,
    session_id: String,
) -> Result<Option<RelayPacket>, String> {
    let path = engine.packet_dir.join(format!("{session_id}.json"));
    if !path.exists() {
        return Ok(None);
    }
    let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let packet = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(Some(packet))
}
