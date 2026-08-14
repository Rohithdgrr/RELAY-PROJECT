# Relay — Vibe Coding Platform PRD
## Product Requirements Document

**Version:** 1.1-draft  
**Date:** August 2026  
**Status:** Draft — reconciled with Complete Docs v1.1-draft (see Changelog)  
**Classification:** Internal — Engineering & Design  
**Author:** Product & Architecture Team  

---

## 1. Executive Summary

Relay is a desktop-native, AI-first coding environment that enables developers to "vibe code" by orchestrating multiple browser-based large language models (ChatGPT, Kimi, Qwen, etc.) without API keys. The platform connects directly to the user's local project directory, terminal, and file system through an embedded webview architecture. 

The defining innovation is the **Relay Handoff Protocol** — when one model hits a rate limit, Relay automatically compacts the entire session context into a portable "Relay Packet" and seamlessly transfers control to the next available model, ensuring uninterrupted flow.

**Inspiration:** OpenCode, Cursor, Bolt.new — but with zero API dependency and multi-model resilience.

---

## 2. Problem Statement

### 2.1 Developer Pain Points
1. **API Key Fatigue:** Developers must manage, fund, and rotate API keys across multiple providers. Costs scale unpredictably with agentic loops.
2. **Rate Limit Interruption:** A single model hitting its limit kills momentum. Context is lost. The developer must manually restart with another model.
3. **Context Fragmentation:** Switching between ChatGPT web, Kimi web, and local editor creates disjointed workflows. Code exists in chat bubbles, not in files.
4. **No Native Tooling:** Browser-based AIs cannot access local terminals, file watchers, or project directories without copy-paste gymnastics.

### 2.2 Opportunity
Browser-based AI models are free-tier accessible, constantly improving, and already authenticated by users. A desktop shell that bridges these web UIs with local development tools — while intelligently managing model failover — creates a zero-cost, resilient vibe coding experience.

---

## 3. Product Vision

> *"One workspace. Every model. Never stop coding."*

Relay transforms the developer's machine into an AI-native IDE where browser-based models act as autonomous coding agents. The user chats naturally with AI in embedded webviews. The AI sees the project, runs terminal commands, edits files — and when it hits a wall, Relay silently swaps in a fresh model with full context preserved.

---

## 4. Target Users

| Persona | Description | Primary Need |
|---------|-------------|------------|
| **Solo Indie Hacker** | Building side projects, cost-sensitive | Free-tier AI access, fast iteration |
| **Full-Stack Developer** | Prototyping MVPs, learning new stacks | Multi-model coverage, terminal access |
| **AI-Native Coder** | Prefers natural language over typing code | Seamless file→chat→terminal loop |
| **Global Developer** | In regions where certain models work better | Automatic fallback across providers |

---

## 5. Core Features

### 5.1 Feature Matrix

| ID | Feature | Priority | Status |
|----|---------|----------|--------|
| F1 | Multi-Model Webview Dock | P0 | Required |
| F2 | Relay Handoff Protocol | P0 | Required |
| F3 | Project Directory Integration | P0 | Required |
| F4 | Embedded Terminal (PTY) | P0 | Required |
| F5 | File Read/Write Bridge | P0 | Required |
| F6 | Smart Code Block Actions | P1 | Required |
| F7 | Session Persistence & Recovery | P1 | Required |
| F8 | File Watcher & Auto-Context | P1 | Required |
| F9 | Relay Packet Inspector | P2 | Planned (design complete — see Complete Docs §3.3) |
| F10 | Custom Model Provider Support | P2 | Planned |
| F11 | Voice-to-Code Input | P3 | Future |

---

## 6. Detailed Feature Specifications

### 6.1 F1 — Multi-Model Webview Dock

**Description:**  
A tabbed sidebar dock containing embedded webviews for each supported AI provider. Only one webview is "active" at a time. Inactive webviews are suspended to conserve resources.

**Supported Providers (V1):**
- OpenAI ChatGPT (chat.openai.com)
- Moonshot Kimi (kimi.moonshot.cn)
- Alibaba Qwen (tongyi.aliyun.com)
- Google Gemini (gemini.google.com) — *if web access viable*

**Behavior:**
- Webviews load the provider's standard web UI
- User logs in manually (cookies/session persisted via Tauri)
- Preload script injected into each webview for bridge communication
- Tab badge shows status: 🟢 Active / 🟡 Standby / 🔴 Rate-Limited / ⚪ Not Logged In

**UI Mock:**
```
┌─────────────────────────────────────────────────────────────┐
│  📁 Project    │  Editor                          │ AI │  │
│  ├── src       │  ┌─────────────────────────────┐ │Dock│  │
│  │   ├── app.  │  │                             │ │────│  │
│  │   └── ...   │  │   Monaco Editor             │ │🤖 │  │
│  ├── package.  │  │                             │ │GPT │  │
│  └── ...       │  └─────────────────────────────┘ │🌙 │  │
│                │                                    │Kimi│  │
│  🖥 Terminal    │                                    │⚡ │  │
│  $ npm start   │                                    │Qwen│  │
│                │                                    └────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Technical Notes:**
- Use Tauri `WebviewWindow` with `data-tauri-drag-region` for custom chrome
- Each webview runs isolated with `contextIsolation: true`
- Preload script exposes `window.__RELAY_BRIDGE__` for DOM→Main communication
- Cookie persistence handled by Tauri's native webview storage

---

### 6.2 F2 — Relay Handoff Protocol (Core Innovation)

**Description:**  
An automatic failover system that detects when the active model becomes unavailable (rate limited, capped, or errored), compacts the session into a structured "Relay Packet," and resumes the session with the next available model.

**Trigger Conditions:**
1. Rate limit error detected in webview DOM ("You've reached your limit," "Too many requests")
2. Model returns an error state for >30 seconds (primary signal)
3. User manually triggers handoff via "Relay to Next Model" button
4. Token/context window exhaustion (if detectable)
5. No AI response for >90 seconds (tertiary signal)

**Confirmation policy (shared with Complete Docs §7.1):** a handoff requires ≥2 signals within a 10-second window — DOM text match, disabled input, error state >30s, or no response >90s counted as independent signals. Manual handoff (trigger 3) bypasses the signal requirement.

**Relay Packet Schema:**
```json
{
  "relay_version": "1.0",
  "session_id": "uuid-v4",
  "created_at": "ISO-8601",
  "source_model": "chatgpt",
  "target_model": "kimi",

  "project_context": {
    "root_path": "/home/user/projects/my-app",
    "language": "typescript",
    "framework": "nextjs",
    "active_files": ["src/app/page.tsx", "src/lib/auth.ts"],
    "file_summaries": {
      "src/app/page.tsx": "Main landing page with hero component..."
    },
    "dependencies": ["next", "react", "tailwindcss"],
    "recent_commits": ["feat: add auth flow", "fix: navbar z-index"]
  },

  "conversation_summary": {
    "total_exchanges": 12,
    "user_goals": ["Build auth system", "Add OAuth with Google"],
    "key_decisions": ["Use NextAuth.js v5", "Store sessions in JWT"],
    "current_task": "Implementing the callback handler in src/lib/auth.ts",
    "blockers": ["Need to configure GOOGLE_CLIENT_SECRET env var"],
    "code_changes_made": [
      {"file": "src/lib/auth.ts", "operation": "created", "summary": "Setup NextAuth config"}
    ]
  },

  "terminal_state": {
    "last_commands": ["npm install next-auth", "npx prisma migrate dev"],
    "current_directory": "/home/user/projects/my-app",
    "recent_output": "Migration completed. Generated Prisma client."
  },

  "pending_operations": [
    {"type": "file_write", "file": ".env.local", "content": "GOOGLE_CLIENT_ID=..."}
  ],

  "raw_conversation_log": "[compressed]"
}
```

**Handoff Flow:**
```
1. DETECT
   └─ Preload script observes DOM for rate-limit indicators
   └─ Main process receives `rate_limit_detected` event

2. CAPTURE
   └─ Extract full conversation from webview (DOM scraping)
   └─ Snapshot active file contents
   └─ Read terminal scrollback buffer
   └─ Compile file tree metadata

3. COMPACT
   └─ Summarize conversation using lightweight local model (optional)
   └─ Or use structured extraction rules
   └─ Generate Relay Packet JSON

4. SWITCH
   └─ Activate next model tab (round-robin or user-priority)
   └─ If target model not logged in → prompt user

5. INJECT
   └─ Preload script fills target model's input textarea
   └─ Injects Relay Packet as initial context prompt
   └─ Auto-submits (with user confirmation option)

6. RESUME
   └─ User continues conversation naturally
   └─ New model has full context via Relay Packet
```

**Injection Prompt Template:**
```
You are continuing a coding session that was being handled by another AI assistant. 
Here is the compacted context:

PROJECT: Next.js app in TypeScript at /home/user/projects/my-app
ACTIVE FILES: src/app/page.tsx, src/lib/auth.ts
CURRENT TASK: Implementing OAuth callback handler
BLOCKER: Need to add GOOGLE_CLIENT_SECRET to .env.local

RECENT CONVERSATION SUMMARY:
- User wants Google OAuth via NextAuth.js v5
- We've set up the config file
- Next step is the callback handler

RECENT TERMINAL OUTPUT:
Migration completed. Generated Prisma client.

Please continue helping with this task. The user is waiting.
```

**UI Indicators:**
- Handoff in progress: Global toast "🔄 Relaying context from ChatGPT → Kimi..."
- Post-handoff: "✅ Handoff complete. Kimi is now active."
- Relay history: Sidebar log of all handoffs with timestamps

---

### 6.3 F3 — Project Directory Integration

**Description:**  
Native file system access via Tauri APIs. The user selects a project folder. Relay indexes it and provides the AI with structured file context.

**Features:**
- **File Tree Explorer:** Collapsible tree with file icons, git status badges
- **File Open/Close:** Click to open in Monaco tabs
- **Drag & Drop:** Reorder tabs, drag files between folders
- **Git Integration:** Show modified/staged/untracked status
- **Quick Search:** `Ctrl+P` fuzzy file finder
- **AI Context Menu:** Right-click file → "Explain this file to AI," "Add to context"

**AI Context Window Management:**
- Automatically include open files in context
- `@mention` syntax in chat to reference files: `@src/lib/auth.ts what does this do?`
- Smart truncation: When context grows too large, summarize older files

---

### 6.4 F4 — Embedded Terminal (PTY)

**Description:**  
A real pseudo-terminal at the bottom panel, powered by `node-pty` and rendered with `xterm.js`.

**Features:**
- Full bash/zsh support (inherits user's default shell)
- Working directory synced to project root
- AI can suggest terminal commands (via code block detection)
- One-click "Run in Terminal" button on bash code blocks in AI responses
- Terminal output can be captured and sent back to AI as context
- Split terminal support (horizontal/vertical)

**AI-Terminal Bridge:**
- When AI outputs a shell command, preload script detects it
- User sees: `[▶ Run] [📋 Copy] [❌ Ignore]` buttons injected below the code block
- Clicking Run executes in PTY and streams output back

---

### 6.5 F5 — File Read/Write Bridge

**Description:**  
The AI (via webview DOM) can suggest file operations. Relay provides one-click actions to apply them safely.

**Supported Operations:**
| Operation | Trigger | Safety |
|-----------|---------|--------|
| Create File | AI outputs file path + code | Confirm if file exists |
| Edit File | AI outputs diff or full rewrite | Show diff preview first |
| Delete File | AI suggests removal | Always confirm |
| Install Package | AI suggests `npm install` | Run in terminal with confirm |

**Diff Preview UI:**
Before applying file changes, show a diff modal:
```
┌─────────────────────────────────────────┐
│  Apply changes to src/lib/auth.ts?      │
├─────────────────────────────────────────┤
│  - const handler = NextAuth({          │
│  + const handler = NextAuth({          │
│  +   providers: [                        │
│  +     GoogleProvider({                  │
│  +       clientId: process.env.GOOGLE_ID│
│  +     })                                │
│  +   ],                                  │
├─────────────────────────────────────────┤
│  [Cancel]  [Apply]  [Apply All]         │
└─────────────────────────────────────────┘
```

---

### 6.6 F6 — Smart Code Block Actions

**Description:**  
Preload scripts augment AI responses by injecting action buttons directly into the provider's web UI.

**Injected Buttons:**
- **Run in Terminal:** For shell/bash blocks
- **Apply to File:** For code blocks with inferred file paths
- **Add to Context:** For reference code the user wants to discuss
- **Copy & Close:** One-click copy with visual feedback

**Visual Design:**
- Buttons appear as a floating toolbar above each code block
- Styled to match the provider's theme (subtle, native-looking)
- Dark/light mode aware

---

### 6.7 F7 — Session Persistence & Recovery

**Description:**  
All session state is persisted locally. If Relay crashes or is closed, the session restores exactly where it left off.

**Persisted State:**
- Open files and cursor positions
- Terminal scrollback and current directory
- Active model and conversation history
- Pending Relay operations
- User preferences and layout

**Storage:**
- SQLite database: Session metadata, conversation logs, relay history
- Flat files: Relay packets as JSON in `~/.relay/sessions/`
- Encrypted at rest: API keys (if any local keys added), session tokens

---

### 6.8 F8 — File Watcher & Auto-Context

**Description:**  
Relay watches the project directory for changes and proactively updates AI context.

**Behavior:**
- On file save: If the AI is waiting, include a note: `"User just modified src/app/page.tsx"`
- On terminal command completion: If output is short, auto-send to AI context
- On git commit: Update project context with commit message
- On dependency install: Refresh dependency list in context

---

### 6.9 Definition of Done — P0 Acceptance Criteria

Every P0 feature ships only when it meets its testable criteria:

**F1 — Multi-Model Webview Dock**
- [ ] 3 provider webviews (ChatGPT, Kimi, Qwen) open, suspend, and resume without leaking memory (idle RSS within §12 targets)
- [ ] Status badges reflect actual state within 2s of a change
- [ ] Logged-in session (cookies) survives an app restart

**F2 — Relay Handoff Protocol**
- [ ] End-to-end handoff (detect → capture → compact → inject → resume) completes in <5s for a 20-exchange session
- [ ] Relay Packet round-trips JSON-schema validation (schema in §9.1)
- [ ] Failed injection retries 3× with backoff, then falls back to manual copy-paste with a clear prompt
- [ ] No handoff fires with <2 detection signals (multi-signal policy, §6.2)

**F3 — Project Directory Integration**
- [ ] File tree renders 10k files in <1s; git badges correct for modified/staged/untracked
- [ ] `Ctrl+P` fuzzy finder opens any file in <300ms (median, 10k-file project)
- [ ] File operations restricted to the selected project root

**F4 — Embedded Terminal (PTY)**
- [ ] Shell starts with the user's default shell and project-root cwd; echo latency <50ms (median of 50)
- [ ] Output streaming + scrollback capture works; history persists across restart
- [ ] Commands require confirmation by default; destructive patterns flagged

**F5 — File Read/Write Bridge**
- [ ] Diff preview mandatory for edits >10 lines; overwrites of `.env*` and `node_modules` blocked
- [ ] Apply/Apply All writes files atomically (backup created first)
- [ ] Undo restores the pre-edit state

---

## 7. User Flows

### 7.1 First-Time Setup
```
1. User launches Relay
2. Welcome screen: "Connect your AI models"
3. User clicks "Add ChatGPT" → Webview opens → User logs in
4. Repeat for Kimi, Qwen (optional)
5. User selects project folder
6. Relay indexes files → Shows file tree
7. User opens a file → Starts coding
8. User opens ChatGPT tab → "Help me refactor this component"
9. ChatGPT responds with suggestions
10. User clicks [Apply] → File updates
```

### 7.2 The Relay Handoff (Primary Flow)
```
1. User is actively coding with ChatGPT
2. ChatGPT outputs: "You've reached the limit for GPT-4. Please try again later."
3. Relay detects this in DOM (preload script)
4. Main process triggers Relay Protocol
5. Toast appears: "Compacting session for handoff..."
6. Relay captures: file states, conversation, terminal history
7. Relay Packet generated → Saved to disk
8. Tab auto-switches to Kimi
9. Kimi input field auto-filled with Relay context
10. Kimi responds: "I see you were working on the auth handler. Let's continue..."
11. User keeps coding without missing a beat
```

### 7.3 Natural Language Coding
```
1. User highlights function in editor
2. Right-click → "Ask AI to explain"
3. Relay opens AI tab, injects: "Explain this function: [code]"
4. AI responds with explanation
5. User replies: "Can you optimize this?"
6. AI outputs optimized version
7. User clicks [Apply] → Diff shown → Confirmed → File updated
8. Terminal auto-runs tests if configured
```

---

## 8. Technical Architecture

### 8.1 System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Relay Desktop App                            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                     Tauri Main Process                        │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │  │
│  │  │ File System │  │   Terminal  │  │   Relay Engine      │   │  │
│  │  │  Manager    │  │   Manager   │  │   (Orchestrator)    │   │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘   │  │
│  │         │                │                    │              │  │
│  │  ┌──────▼────────────────▼────────────────────▼──────────┐  │  │
│  │  │              IPC Router (events/commands)               │  │  │
│  │  └──────┬────────────────┬────────────────────┬───────────┘  │  │
│  │         │                │                    │              │  │
│  │  ┌──────▼──────┐  ┌──────▼──────┐  ┌─────────▼──────────┐   │  │
│  │  │ Webview 1   │  │ Webview 2   │  │ Webview 3          │   │  │
│  │  │ ChatGPT     │  │ Kimi        │  │ Qwen               │   │  │
│  │  │ +preload.js │  │ +preload.js │  │ +preload.js        │   │  │
│  │  └─────────────┘  └─────────────┘  └────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                  Frontend (React + Vite)                       │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │  │
│  │  │ Sidebar  │  │  Editor  │  │ Terminal │  │ AI Dock      │ │  │
│  │  │ Explorer │  │ Monaco   │  │ xterm.js │  │ (Webviews)   │ │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘ │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   Local Storage    │
                    │  SQLite + Flat FS  │
                    └────────────────────┘
```

### 8.2 Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Desktop Shell** | Tauri v2 (Rust) | Lightweight, secure, native webview control, small bundle size (~5MB vs Electron ~150MB) |
| **Frontend** | React 19 + TypeScript | Ecosystem, developer familiarity, component reuse |
| **Styling** | Tailwind CSS + shadcn/ui | Rapid UI development, consistent design system |
| **Editor** | Monaco Editor | VS Code engine, language support, diff viewer |
| **Terminal** | node-pty + xterm.js | Real PTY, shell integration, battle-tested |
| **State** | Zustand (UI) + SQLite (persist) | Simple, no boilerplate, local-first |
| **File Watching** | notify (Rust) via Tauri command | Cross-platform, native performance |
| **Build** | Vite | Fast HMR, optimized bundles |

### 8.3 Webview Preload Architecture

Each provider has a tailored preload script:

```typescript
// preload-chatgpt.ts
// Tauri v2: preloads use @tauri-apps/api/core for contextBridge and
// @tauri-apps/api/event for listen/emit (v1's ipcRenderer no longer exists).
import { contextBridge } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';

const RELAY_BRIDGE = {
  // Send detected commands to main
  sendCommand: (cmd: string) => emit('relay:command-detected', { provider: 'chatgpt', command: cmd }),

  // Send rate limit detection
  sendRateLimit: () => emit('relay:rate-limit-detected', { provider: 'chatgpt' }),

  // Receive prompt injection from main
  onInjectPrompt: (callback: (prompt: string) => void) =>
    listen('relay:inject-prompt', (event) => callback(event.payload as string)),

  // Notify main of new message
  onNewMessage: (callback: (text: string) => void) => {
    // DOM observer implementation
    const observer = new MutationObserver(() => {
      const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
      const last = messages[messages.length - 1];
      if (last) callback(last.textContent || '');
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
};

contextBridge.exposeInMainWorld('__RELAY_BRIDGE__', RELAY_BRIDGE);
```

### 8.4 Relay Engine (Rust Core)

```rust
// relay-engine/src/lib.rs
pub struct RelayEngine {
    session_store: SessionStore,
    providers: Vec<Box<dyn AIProvider>>,
    active_provider: Option<String>,
    file_watcher: FileWatcher,
}

impl RelayEngine {
    pub async fn initiate_handoff(&mut self) -> Result<RelayPacket, RelayError> {
        let current = self.active_provider.as_ref().ok_or(RelayError::NoActiveProvider)?;

        // 1. Capture conversation from webview
        // NOTE: Relay never scrapes DOM from Rust. The provider preload script
        // (preload-chatgpt.ts) observes the DOM and emits `relay:*` events;
        // `capture_conversation` assembles the transcript from those events
        // plus the session store.
        let conversation = self.capture_conversation(current).await?;

        // 2. Snapshot file system state
        let file_state = self.file_watcher.snapshot().await?;

        // 3. Capture terminal scrollback
        let terminal_state = self.capture_terminal().await?;

        // 4. Compact into packet
        let packet = RelayPacket::new()
            .with_conversation(conversation)
            .with_files(file_state)
            .with_terminal(terminal_state)
            .compact();

        // 5. Select next provider
        let next = self.select_next_provider(current)?;

        // 6. Inject and activate
        self.inject_packet(&next, &packet).await?;
        self.active_provider = Some(next);

        Ok(packet)
    }
}
```

---

## 9. Data Models

### 9.1 Relay Packet
```typescript
interface RelayPacket {
  relay_version: string;
  session_id: string;
  created_at: string;
  source_model: string;
  target_model: string;

  project_context: {
    root_path: string;
    language: string;
    framework?: string;
    active_files: string[];
    file_summaries: Record<string, string>;
    dependencies: string[];
  };

  conversation_summary: {
    total_exchanges: number;
    user_goals: string[];
    key_decisions: string[];
    current_task: string;
    blockers: string[];
    code_changes: CodeChange[];
  };

  terminal_state: {
    last_commands: string[];
    current_directory: string;
    recent_output: string;
  };

  pending_operations: PendingOperation[];
  raw_conversation_log?: string; // compressed base64
}

interface CodeChange {
  file: string;
  operation: 'created' | 'modified' | 'deleted';
  summary: string;
  diff?: string;
}

interface PendingOperation {
  type: 'file_write' | 'file_delete' | 'terminal_command' | 'package_install';
  file?: string;
  content?: string;
  command?: string;
}
```

### 9.2 Session
```typescript
interface Session {
  id: string;
  name: string;
  project_path: string;
  created_at: string;
  updated_at: string;
  active_provider: string;
  providers: ProviderState[];
  open_files: OpenFile[];
  terminal_cwd: string;
  relay_history: RelayEvent[];
}

interface ProviderState {
  id: string;
  name: string;
  status: 'active' | 'standby' | 'rate_limited' | 'error' | 'not_authenticated';
  last_used: string;
  conversation_length: number;
}
```

---

## 10. UI/UX Design Principles

### 10.1 Philosophy
- **Invisible until needed:** The Relay Handoff should feel magical, not mechanical
- **Native-first:** UI should feel like a desktop app, not a web page in a box
- **Trust but verify:** AI suggestions require user confirmation for destructive actions
- **Always recoverable:** Every action is undoable; every session is restorable

### 10.2 Color Palette (Dark Mode Default)
```
Background:      #0A0A0F (deep void)
Surface:         #14141B (panels)
Surface Elevated:#1E1E2E (cards, modals)
Border:          #2A2A3C
Text Primary:    #E2E2EA
Text Secondary:  #8B8B9E
Accent:          #6366F1 (indigo — Relay brand)
Success:         #22C55E
Warning:         #F59E0B
Error:           #EF4444
ChatGPT:         #10A37F
Kimi:            #8B5CF6
Qwen:            #F97316
```

### 10.3 Key Interactions
- **Handoff Animation:** A particle effect travels from the old model tab to the new one
- **Typing Indicator:** When AI is generating, the active tab pulses
- **File Change Indicator:** Modified files glow subtly in the explorer
- **Terminal Streaming:** Commands typed by AI appear with a ghost cursor before execution

---

## 11. Security & Privacy

### 11.1 Sandboxing
- Webviews run with `contextIsolation: true` and `sandbox: true`
- Preload scripts are the only bridge — no arbitrary code execution
- File system access restricted to selected project directory

### 11.2 Data Handling
- No cloud storage. All data stays local.
- Session files encrypted at rest using OS keychain (keyring)
- AI provider cookies managed by native webview — Relay never extracts session tokens

### 11.3 Execution Safety
- Terminal commands require user confirmation by default (toggleable for trusted projects)
- File deletions always require confirmation
- Diff preview mandatory for file overwrites >10 lines
- `.env` files and `node_modules` are read-only by default

---

## 12. Performance Requirements

| Metric | Target | Notes |
|--------|--------|-------|
| Cold Start | <2s | Tauri + Vite optimized |
| Webview Load | <3s | Lazy load inactive webviews |
| File Tree (10k files) | <1s | Virtualized tree, async indexing |
| Handoff Time | <5s | DOM capture + packet generation + injection |
| Terminal Latency | <50ms | PTY character echo |
| Memory (idle) | <400MB | 1 webview, RSS peak |
| Memory (active) | <800MB | 3 webviews + editor, RSS peak |
| Memory (stress) | <1.5GB | 5 webviews + large project |

All values are **targets with acceptance tests** (see Complete Docs §9.1); none are measured until the v0.1 build exists.

---

## 13. Milestones & Roadmap

### Phase 1 — Foundation (Weeks 1-3)
- [ ] Tauri shell with React frontend
- [ ] Monaco editor integration
- [ ] File explorer with native FS access
- [ ] Single webview (ChatGPT) with preload bridge
- [ ] Basic code block action buttons

### Phase 2 — Terminal & Tools (Weeks 4-5)
- [ ] node-pty + xterm.js terminal
- [ ] File read/write bridge with diff preview
- [ ] Multi-webview dock (ChatGPT + Kimi + Qwen)
- [ ] Session persistence (SQLite)

### Phase 3 — Relay Protocol (Weeks 6-8)
- [ ] DOM-based rate limit detection
- [ ] Conversation capture and compaction
- [ ] Relay Packet generation
- [ ] Auto handoff with context injection
- [ ] Relay history and packet inspector

### Phase 4 — Polish (Weeks 9-10)
- [ ] File watcher auto-context
- [ ] Git integration
- [ ] Settings and preferences
- [ ] Onboarding flow
- [ ] Documentation and examples

### Phase 5 — Launch (Week 11+)
- [ ] Beta testing with 50 users
- [ ] Performance optimization
- [ ] Cross-platform builds (macOS, Windows, Linux)
- [ ] Community release

**Staffing assumption:** The timeline assumes 2 full-time engineers (1 Rust/Tauri, 1 frontend) plus part-time design.

**Critical path:** webview bridge (F1) → relay engine + handoff (F2) → terminal bridge (F4). Monaco editor and file explorer proceed in parallel and are not on the critical path.

---

## 14. Open Questions & Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Provider DOM changes break preload | High | Weekly selector updates; community-driven selector registry |
| Provider blocks automation | High | Fallback to manual copy-paste bridge; respect ToS |
| Rate limit detection false positives | Medium | Multi-signal detection (DOM + timing + error text) |
| Large project context overflow | Medium | Smart truncation; file summarization; @mention targeting |
| Remote webview platform limits | Medium | Preload injection into remote pages differs per platform (WKWebView, WebView2, WebKitGTK); validated in Phase 1 spike |
| User has only one model | Low | Graceful degradation — prompt user to add more models |
| macOS Gatekeeper / Windows Defender | Medium | Code signing, notarization, clean installer |

---

## 15. Success Metrics

| Metric | Target |
|--------|--------|
| Handoff success rate | >95% |
| User session length | >45 min average |
| Files edited per session | >8 |
| Terminal commands run per session | >5 |
| User retention (7-day) | >40% |
| NPS Score | >50 |

**Measurement plan:** Handoff success = packet generated + injected + target model responds within 60s (instrumented in the relay engine, counted per handoff). Session length, files edited, and terminal commands come from the session store. Retention and NPS require the Phase 5 beta cohort — defined now, measurable later.

---

## 16. Appendix

### A. Provider-Specific Selectors (Reference)

> **Volatile:** These selectors are examples as of August 2026. They ship in a community-maintained registry; each ships with a health check that flags DOM drift within 24h, and Relay degrades to manual copy-paste if selectors fail.

```yaml
chatgpt:
  input_field: "#prompt-textarea"
  send_button: "[data-testid='send-button']"
  assistant_messages: "[data-message-author-role='assistant']"
  rate_limit_indicators: 
    - "You've reached your limit"
    - "Too many requests"
    - "[data-testid='limit-toast']"

kimi:
  input_field: "textarea[placeholder*='输入']"
  send_button: ".send-button"
  assistant_messages: ".chat-message-assistant"
  rate_limit_indicators:
    - "请求过于频繁"
    - "已达到使用限制"

qwen:
  input_field: "#chat-input"
  send_button: ".send-btn"
  assistant_messages: ".message-bot"
  rate_limit_indicators:
    - "请求太频繁"
    - "请稍后再试"
```

### B. Relay Packet Example
```json
{
  "relay_version": "1.0",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "created_at": "2026-08-14T16:30:00Z",
  "source_model": "chatgpt",
  "target_model": "kimi",
  "project_context": {
    "root_path": "/Users/dev/projects/relay-demo",
    "language": "typescript",
    "framework": "nextjs",
    "active_files": ["src/app/api/auth/route.ts"],
    "file_summaries": {
      "src/app/api/auth/route.ts": "API route handling OAuth callbacks for NextAuth"
    },
    "dependencies": ["next", "next-auth", "react"]
  },
  "conversation_summary": {
    "total_exchanges": 8,
    "user_goals": ["Implement Google OAuth", "Secure the callback route"],
    "key_decisions": ["Use NextAuth.js v5 beta", "JWT session strategy"],
    "current_task": "Writing the callback handler to exchange code for tokens",
    "blockers": ["Need to handle PKCE verifier"],
    "code_changes": [
      {"file": "src/lib/auth.ts", "operation": "created", "summary": "Auth config with Google provider"}
    ]
  },
  "terminal_state": {
    "last_commands": ["npm install next-auth@beta", "npm run dev"],
    "current_directory": "/Users/dev/projects/relay-demo",
    "recent_output": "ready - started server on 0.0.0.0:3000"
  },
  "pending_operations": []
}
```

### C. Glossary
- **Relay Handoff:** The automatic transfer of session context from one AI model to another
- **Relay Packet:** A structured JSON document containing compacted session state
- **Vibe Coding:** Writing software through natural language conversation with AI rather than manual typing
- **Preload Script:** JavaScript injected into webviews to bridge DOM and native code
- **Webview Dock:** The sidebar panel containing embedded AI provider web UIs

---

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | Aug 2026 | Initial release |
| 1.1-draft | Aug 2026 | Honesty pass: corrected the Tauri v2 preload API sample; clarified the Rust engine does not scrape DOM; added §6.9 Definition of Done for P0 features; reconciled performance targets (file tree 10k → <1s; memory idle/active/stress) and rate-limit trigger policy with Complete Docs v1.1-draft; added staffing assumption + critical path; added measurement plan for success metrics; marked provider selectors as volatile; added changelog + status header |
| 1.1-draft | Aug 2026 | v0.1 implementation note: terminal stack changed from `node-pty` to Rust `portable-pty`; provider preload bridge is a stub pending the Phase 1 platform spike |

---

*End of Document*
