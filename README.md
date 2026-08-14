# Relay

> **One workspace. Every model. Never stop coding.**

Relay is a desktop-native, AI-first coding environment that orchestrates
browser-based LLMs (ChatGPT, Kimi, Qwen, Gemini) **without API keys** — and
when one model hits a rate limit, the **Relay Handoff Protocol** compacts the
session into a portable *Relay Packet* and hands control to the next model.

**Specs:** [Relay_PRD.md](Relay_PRD.md) · [Relay_Complete_Documentation.md](Relay_Complete_Documentation.md)

## v0.1 status — what works today

| Area | Status |
|---|---|
| Tauri v2 + React 19 + TypeScript shell | ✅ working |
| File explorer (lazy tree, project-root restricted) | ✅ working |
| Monaco editor (open/save, dirty tracking, backups) | ✅ working |
| PTY terminal (portable-pty + xterm.js, event stream, scrollback capture) | ✅ working |
| Relay Engine: session store, provider registry, handoff orchestration | ✅ working |
| Relay Packet generation → `~/.relay/sessions/*.json` | ✅ working |
| Packet inspector + copy (UI) | ✅ working |
| Provider webview windows + stub preload | ⚠️ window opens; DOM bridge is the Phase 1 spike |
| Multi-signal rate-limit detector → auto-handoff | ⛔ Phase 1 spike (Complete Docs §7.1) |
| Conversation capture/compaction from webview DOM | ⛔ Phase 1 spike |

## Run it

Prerequisites: Node ≥ 20, Rust toolchain (`rustup`), and the platform webview
prereqs from [Tauri v2 docs](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev     # full desktop app
# or, frontend only (Tauri invoke calls will fail in a plain browser):
npm run dev
```

## Layout

```
src-tauri/src/
  lib.rs        Tauri builder, command registry, provider webview launcher
  types.rs      PRD §9.1 data models (RelayPacket, SessionState, …)
  relay.rs      Relay Engine: session store + handoff orchestration
  terminal.rs   PTY manager (portable-pty) with scrollback capture
  fs.rs         File bridge: read/write, read-only patterns, backups, atomic writes
src-tauri/preloads/relay-bridge.js   provider preload stub (passive observation only)
src/
  relay/        types, provider registry, zustand store
  components/   header, sidebar, editor, terminal, AI dock, status bar
```

## Implementation decisions (deviations from the docs)

- **PTY:** docs listed `node-pty`; v0.1 uses Rust `portable-pty` — the
  idiomatic Tauri choice, no Node sidecar. xterm.js on the frontend is
  unchanged. Recorded in both docs' changelogs.
- **Compliance stance (Complete Docs §8.5):** Relay is *assisted-only*. The
  stub preload only observes the page; it never sends messages and never evades
  bot detection. Provider webview windows have **no Tauri capability**, so a
  compromised provider page cannot reach IPC — enforced by configuration.

## Roadmap pointers

The critical path from the PRD: webview bridge (F1) → relay engine + handoff
(F2) → terminal bridge (F4). The next milestone is the Phase 1 platform spike:
DOM capture via preload events and user-confirmed injection into the target
model's input field.
