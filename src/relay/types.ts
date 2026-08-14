// Mirror of PRD §9.1 / src-tauri/src/types.rs. Keep in lock-step.

export type ProviderId = "chatgpt" | "kimi" | "qwen" | "gemini";

export type ProviderStatus =
  | "active"
  | "standby"
  | "rate_limited"
  | "error"
  | "not_authenticated";

export interface ProviderState {
  id: ProviderId;
  status: ProviderStatus;
  last_used: string | null;
  conversation_length: number;
}

export interface CodeChange {
  file: string;
  operation: "created" | "modified" | "deleted";
  summary: string;
  diff?: string;
}

export interface PendingOperation {
  type: "file_write" | "file_delete" | "terminal_command" | "package_install";
  file?: string;
  content?: string;
  command?: string;
}

export interface ProjectContext {
  root_path: string;
  language?: string;
  framework?: string;
  active_files: string[];
  file_summaries: Record<string, string>;
  dependencies: string[];
}

export interface ConversationSummary {
  total_exchanges: number;
  user_goals: string[];
  key_decisions: string[];
  current_task: string;
  blockers: string[];
  code_changes: CodeChange[];
}

export interface TerminalState {
  last_commands: string[];
  current_directory: string;
  recent_output: string;
}

export interface RelayPacket {
  relay_version: string;
  session_id: string;
  created_at: string;
  source_model: string;
  target_model: string;
  project_context: ProjectContext;
  conversation_summary: ConversationSummary;
  terminal_state: TerminalState;
  pending_operations: PendingOperation[];
  raw_conversation_log?: string;
}

export interface HandoffEvent {
  at: string;
  from: string;
  to: string;
  reason: string;
  packet_path: string;
}

export interface SessionState {
  id: string;
  name: string;
  project_path: string | null;
  created_at: string;
  active_provider: ProviderId | null;
  providers: ProviderState[];
  handoffs: HandoffEvent[];
}
