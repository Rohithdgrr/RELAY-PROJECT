//! Shared data models — mirror PRD §9.1 exactly.
//!
//! These types are the wire format for the Relay Handoff Protocol. Keep them
//! in lock-step with the JSON schema in Relay_PRD.md §9.1.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderId {
    Chatgpt,
    Kimi,
    Qwen,
    Gemini,
}

impl ProviderId {
    pub fn label(&self) -> &'static str {
        match self {
            ProviderId::Chatgpt => "chatgpt",
            ProviderId::Kimi => "kimi",
            ProviderId::Qwen => "qwen",
            ProviderId::Gemini => "gemini",
        }
    }

    pub fn display(&self) -> &'static str {
        match self {
            ProviderId::Chatgpt => "ChatGPT",
            ProviderId::Kimi => "Kimi",
            ProviderId::Qwen => "Qwen",
            ProviderId::Gemini => "Gemini",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderStatus {
    Active,
    Standby,
    RateLimited,
    Error,
    NotAuthenticated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderState {
    pub id: ProviderId,
    pub status: ProviderStatus,
    pub last_used: Option<String>,
    pub conversation_length: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeChange {
    pub file: String,
    /// created | modified | deleted
    pub operation: String,
    pub summary: String,
    pub diff: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingOperation {
    /// file_write | file_delete | terminal_command | package_install
    #[serde(rename = "type")]
    pub op_type: String,
    pub file: Option<String>,
    pub content: Option<String>,
    pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectContext {
    pub root_path: String,
    pub language: Option<String>,
    pub framework: Option<String>,
    pub active_files: Vec<String>,
    pub file_summaries: HashMap<String, String>,
    pub dependencies: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSummary {
    pub total_exchanges: usize,
    pub user_goals: Vec<String>,
    pub key_decisions: Vec<String>,
    pub current_task: String,
    pub blockers: Vec<String>,
    pub code_changes: Vec<CodeChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalState {
    pub last_commands: Vec<String>,
    pub current_directory: String,
    pub recent_output: String,
}

/// The Relay Packet — the portable session-compaction unit (PRD §6.2 / §9.1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayPacket {
    pub relay_version: String,
    pub session_id: String,
    pub created_at: String,
    pub source_model: String,
    pub target_model: String,
    pub project_context: ProjectContext,
    pub conversation_summary: ConversationSummary,
    pub terminal_state: TerminalState,
    pub pending_operations: Vec<PendingOperation>,
    pub raw_conversation_log: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandoffEvent {
    pub at: String,
    pub from: String,
    pub to: String,
    pub reason: String,
    pub packet_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub id: String,
    pub name: String,
    pub project_path: Option<String>,
    pub created_at: String,
    pub active_provider: Option<ProviderId>,
    pub providers: Vec<ProviderState>,
    pub handoffs: Vec<HandoffEvent>,
}
