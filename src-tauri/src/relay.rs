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
    ConversationSummary, HandoffEvent, ProjectContext, ProviderId, ProviderState, ProviderStatus,
    RelayPacket, SessionState, TerminalState,
};

pub struct RelayEngine {
    session: Mutex<SessionState>,
    packet_dir: PathBuf,
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
            total_exchanges: 0, // populated from preload transcript events (Phase 1)
            user_goals: vec![],
            key_decisions: vec![],
            current_task: "Continue the session from the previous model".into(),
            blockers: vec![],
            code_changes: vec![],
        },
        terminal_state,
        pending_operations: vec![],
        raw_conversation_log: None,
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
