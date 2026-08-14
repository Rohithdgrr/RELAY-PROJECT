import type { ProviderId, ProviderStatus } from "./types";

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  url: string;
  color: string;
  status: ProviderStatus;
}

// V1 provider set (PRD §6.1). Status is seeded by the Rust engine's session
// state and overlaid by the AI dock from session_status.
export const PROVIDERS: ProviderMeta[] = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chat.openai.com", color: "#10A37F", status: "not_authenticated" },
  { id: "kimi", name: "Kimi", url: "https://kimi.moonshot.cn", color: "#8B5CF6", status: "not_authenticated" },
  { id: "qwen", name: "Qwen", url: "https://tongyi.aliyun.com", color: "#F97316", status: "not_authenticated" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com", color: "#4285F4", status: "not_authenticated" },
];

export const STATUS_GLYPH: Record<ProviderStatus, string> = {
  active: "🟢",
  standby: "🟡",
  rate_limited: "🔴",
  error: "🟠",
  not_authenticated: "⚪",
};
