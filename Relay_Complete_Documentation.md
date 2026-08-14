# Relay — Complete Platform Documentation
## Vibe Coding with Multi-Model Relay Handoff

**Version:** 1.1-draft  
**Last Updated:** August 2026  
**Status:** Draft — v1.0 baseline under revision; reconciled against PRD v1.1-draft (see Changelog)  
**Platform:** Desktop (macOS, Windows, Linux)  
**Architecture:** Tauri + Rust + React + Monaco + xterm.js  

---

## Table of Contents

1. [What is Relay?](#1-what-is-relay)
2. [Problems Relay Solves](#2-problems-relay-solves)
3. [Complete Feature Set](#3-complete-feature-set)
4. [System Requirements & Setup](#4-system-requirements--setup)
5. [Workflow Guide](#5-workflow-guide)
6. [Usage Patterns](#6-usage-patterns)
7. [The Relay Handoff Protocol (Deep Dive)](#7-the-relay-handoff-protocol-deep-dive)
8. [Security Architecture](#8-security-architecture)
9. [Performance Characteristics](#9-performance-characteristics)
10. [Big Project Handling](#10-big-project-handling)
11. [Precautions & Limitations](#11-precautions--limitations)
12. [Known Risks & Mitigations](#12-known-risks--mitigations)
13. [Improvements Roadmap](#13-improvements-roadmap)
14. [Future Scope](#14-future-scope)
15. [Troubleshooting](#15-troubleshooting)
16. [FAQ](#16-faq)

---

## 1. What is Relay?

Relay is a desktop-native, AI-first integrated development environment (IDE) that enables **vibe coding** — writing software through natural language conversation with AI — using the free web interfaces of large language models (ChatGPT, Kimi, Qwen, Gemini, etc.) without requiring API keys.

### The Core Innovation

Unlike traditional AI coding tools that connect via paid APIs, Relay embeds the actual web UIs of AI providers into a desktop shell and bridges them with your local development environment. When one model hits a rate limit or becomes unavailable, Relay's **Handoff Protocol** automatically compacts the entire session context and transfers it to the next available model — ensuring uninterrupted creative flow.

### Key Differentiators

| Aspect | Traditional AI IDE (Cursor, Copilot) | Relay |
|--------|--------------------------------------|-------|
| **AI Access** | Requires paid API keys | Uses free web tiers |
| **Cost** | $10-50/month | Free |
| **Model Choice** | Usually one provider | Multiple, hot-swappable |
| **Rate Limit Handling** | Hard stop | Automatic failover |
| **Context Control** | Opaque | Fully visible Relay Packets |
| **Offline Use** | No (API dependent) | Partial (local tools work) |

---

## 2. Problems Relay Solves

### 2.1 API Key Fatigue & Cost Anxiety
**Problem:** Developers must sign up for multiple AI services, manage API keys, monitor usage, and face unpredictable bills. A single agentic coding session can consume $5-20 in API tokens.

**Relay Solution:** Zero API keys. Relay connects to the web interfaces you already use for free. Your existing logins and free tiers are sufficient.

### 2.2 Rate Limit Interruption
**Problem:** You're in deep flow, 20 messages into a complex refactoring session, and ChatGPT hits its hourly limit. Context is fragmented. You must manually restart with another model, re-explaining everything.

**Relay Solution:** The Handoff Protocol detects rate limits automatically, preserves full context in a structured Relay Packet, and seamlessly transfers to your next model. You don't even notice the switch.

### 2.3 Context Fragmentation
**Problem:** You have ChatGPT open in one tab, Kimi in another, your editor in a third, and a terminal in a fourth. Code lives in chat bubbles. Copy-pasting between contexts is tedious and error-prone.

**Relay Solution:** Everything lives in one window. AI chat, code editor, file explorer, and terminal are unified. Code suggestions appear with one-click "Apply" buttons.

### 2.4 No Native Tooling for Web AIs
**Problem:** Browser-based AIs cannot see your project structure, run your tests, or execute terminal commands. They operate in a vacuum.

**Relay Solution:** Embedded webviews are bridged to your local filesystem and terminal. The AI "sees" your project through structured context injection and can suggest commands that execute in a real PTY.

### 2.5 Model Lock-In
**Problem:** Once you start a conversation with GPT-4, you're stuck with it. If it struggles with your specific tech stack or language, you must abandon the session.

**Relay Solution:** Multi-model architecture means you can route different tasks to different models. Stuck on a Python problem? Hand off to Kimi. Need creative JavaScript? Back to ChatGPT.

### 2.6 Global Accessibility
**Problem:** In some regions, certain AI providers are blocked, expensive, or perform poorly. Developers lack alternatives.

**Relay Solution:** Support for multiple providers (OpenAI, Moonshot, Alibaba, Google) ensures you always have a fallback. Regional restrictions on one provider don't stop your work.

---

## 3. Complete Feature Set

### 3.1 Core IDE Features

#### File Explorer
- **Native File Tree:** Full project directory navigation with folder collapse/expand
- **Git Integration:** File status badges (modified M, staged A, untracked U, conflicted C)
- **Context Menu:** Right-click operations — New File, New Folder, Rename, Delete, Copy Path
- **AI Context Menu:** "Explain this file to AI," "Add to AI context," "Find references"
- **File Icons:** Language-aware icons for 100+ file types
- **Quick Search:** `Ctrl+P` fuzzy finder across all project files
- **Recent Files:** Recently opened files list with keyboard shortcuts

#### Monaco Editor
- **Full Language Support:** TypeScript, Python, Rust, Go, Java, C++, and 50+ more
- **IntelliSense:** Autocomplete, hover info, parameter hints (from TypeScript Language Server)
- **Multi-Cursor & Selection:** Column selection, multiple cursors
- **Minimap:** Code overview with change indicators
- **Diff Viewer:** Side-by-side and inline diff for AI-suggested changes
- **Find & Replace:** Regex support, find in selection, replace all
- **Format on Save:** Prettier, rustfmt, black integration via terminal commands
- **Error Squiggles:** LSP-driven error highlighting (requires language server setup)
- **Theme Support:** VS Code-compatible themes (Dark+, Light+, custom)

#### Terminal (PTY)
- **Real Shell:** Full bash/zsh/PowerShell with your dotfiles, aliases, and environment
- **Working Directory Sync:** Auto-follows project root or current file's directory
- **Split Terminals:** Horizontal and vertical splits (up to 4 panes)
- **Terminal Profiles:** Save different shell configurations
- **Search:** `Ctrl+F` search through terminal scrollback
- **Copy Mode:** Vim-like copy mode for selecting terminal output
- **AI Command Detection:** Shell commands in AI responses get "Run" buttons
- **Output Capture:** Select terminal text and "Send to AI" for debugging help

### 3.2 AI Integration Features

#### Multi-Model Webview Dock
- **Tabbed Interface:** Each AI provider in its own webview tab
- **Status Badges:** 
  - 🟢 Active (currently chatting)
  - 🟡 Standby (idle, ready)
  - 🔴 Rate Limited (temporarily unavailable)
  - ⚪ Not Authenticated (needs login)
  - 🟠 Error (connection issue)
- **Lazy Loading:** Inactive webviews are suspended to save memory
- **Session Persistence:** Login cookies survive app restarts
- **Assisted-Only Automation:** Relay never bypasses provider controls or evades bot detection. Every injection into another model's input is user-confirmed; there is no headless messaging. See §8.5 Compliance Strategy.

#### Smart Code Block Actions
Injected directly into AI responses via preload scripts:
- **▶ Run in Terminal:** Execute shell commands with one click
- **💾 Apply to File:** Write code blocks to inferred file paths
- **📋 Copy:** Copy code with syntax-highlighted formatting
- **🔍 Add to Context:** Include code in next prompt without typing
- **🔄 Diff Preview:** Show changes before applying file modifications

#### Context Management
- **Open Files Auto-Context:** All open tabs are automatically included in AI context
- **@ Mentions:** Type `@filename.ts` to reference specific files
- **Terminal Context:** Recent terminal output optionally included
- **Git Context:** Recent commits and branch info included
- **Project Metadata:** `package.json`, `Cargo.toml`, etc. parsed for dependency context
- **Context Budget:** Visual indicator showing how much context you're using
- **Smart Truncation:** When context grows too large, older files are summarized

### 3.3 Relay Handoff Protocol Features

#### Automatic Detection
- **Rate Limit Detection:** Monitors DOM for provider-specific limit messages
- **Error Detection:** Identifies "Something went wrong" and connection errors
- **Timeout Detection:** Flags models that haven't responded in >2 minutes
- **Token Limit Detection:** Estimates context window usage (where detectable)
- **Manual Trigger:** User can force handoff via "Relay to Next Model" button

#### Relay Packet Generation
- **Conversation Capture:** Extracts full chat history from webview DOM
- **File State Snapshot:** Hashes and summaries of all active files
- **Terminal State Capture:** Recent commands and output
- **Smart Compaction:** Summarizes long conversations into key decisions and current task
- **Raw Log Preservation:** Full conversation stored as compressed backup

#### Handoff Execution
- **Round-Robin Fallback:** Cycles through available models automatically
- **Priority Queue:** User-defined preference order (e.g., GPT-4 → Kimi → Qwen)
- **Provider-Specific Prompts:** Tailored injection prompts per model's strengths
- **Handoff Confirmation:** Optional user confirmation before switching
- **Handoff History:** Log of all switches with timestamps and reasons

#### Relay Packet Inspector *(P2 — planned, not yet shipped; the following is the target design)*
- **View Packet:** Inspect the structured context being transferred
- **Edit Packet:** Manually adjust context before injection (advanced)
- **Export Packet:** Save session context as JSON for sharing or debugging
- **Import Packet:** Resume a session from a saved packet

### 3.4 Project Intelligence Features

#### File Watcher
- **Real-Time Sync:** Detects file changes from external editors
- **Auto-Refresh:** Updates AI context when files are saved
- **Change Notifications:** "User modified auth.ts" automatically noted to AI
- **Git Change Detection:** Staged/unstaged changes tracked

#### Dependency Awareness
- **Package.json Parsing:** Knows your npm dependencies and versions
- **Requirements.txt Parsing:** Python environment awareness
- **Cargo.toml Parsing:** Rust crate awareness
- **Version Conflict Detection:** Warns about outdated or vulnerable dependencies

#### Code Indexing
- **Symbol Search:** `Ctrl+Shift+O` to find functions, classes, variables
- **Reference Finding:** "Find all references" for symbols
- **Outline View:** Structural overview of current file
- **Project-Wide Search:** `Ctrl+Shift+F` grep across all files

### 3.5 Session Management

#### Session Persistence
- **Auto-Save:** Session state saved every 30 seconds
- **Crash Recovery:** Restores exact state after unexpected shutdown
- **Session History:** Browse and reopen previous sessions
- **Session Forking:** Branch a session to experiment without losing original
- **Session Sharing:** Export session as a shareable bundle (excluding sensitive files)

#### Workspace Layout
- **Customizable Panels:** Drag and resize editor, terminal, AI dock, explorer
- **Layout Presets:** "Coding," "Debugging," "Review" layouts
- **Zen Mode:** Distraction-free full-screen editor
- **Multi-Monitor:** Pop out panels to separate windows

---

## 4. System Requirements & Setup

### 4.1 Minimum Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **OS** | macOS 12+, Windows 10+, Ubuntu 20.04+ | macOS 14+, Windows 11+, Ubuntu 22.04+ |
| **CPU** | Intel i5 / Apple M1 / AMD Ryzen 5 | Intel i7 / Apple M2 / AMD Ryzen 7 |
| **RAM** | 8 GB | 16 GB |
| **Storage** | 500 MB (app) + 2 GB (cache) | 1 GB (app) + 5 GB (cache) |
| **Display** | 1280x720 | 1920x1080 or higher |
| **Internet** | Broadband (for AI webviews) | Stable broadband |

### 4.2 Installation

#### macOS
```bash
# Download Relay-1.0.0-mac.dmg from releases
# Or install via Homebrew (when available)
brew install --cask relay

# First launch may require security approval:
# System Preferences → Security & Privacy → Open Anyway
```

#### Windows
```powershell
# Download Relay-1.0.0-setup.exe
# Run installer (admin rights not required for user install)
# Windows Defender may flag — click "More info" → "Run anyway"

# Or via winget (when available)
winget install Relay.Relay
```

#### Linux
```bash
# Download relay_1.0.0_amd64.deb (Debian/Ubuntu)
sudo dpkg -i relay_1.0.0_amd64.deb

# Or AppImage
chmod +x Relay-1.0.0.AppImage
./Relay-1.0.0.AppImage

# Or Flatpak (when available)
flatpak install flathub com.relay.Relay
```

### 4.3 Initial Setup

1. **Launch Relay**
   - App opens to welcome screen

2. **Connect AI Models**
   - Click "Add Model" → Select provider (ChatGPT, Kimi, Qwen)
   - Webview opens provider's login page
   - Log in manually (2FA supported)
   - Relay saves session cookies securely
   - Repeat for each desired model
   - Minimum 2 models recommended for handoff functionality

3. **Select Project**
   - "Open Folder" → Browse to project directory
   - Relay indexes files (progress shown)
   - Git repository auto-detected

4. **Configure Preferences**
   - Default shell (bash/zsh/fish/PowerShell)
   - Theme (Dark/Light/System)
   - Font size and family
   - Handoff behavior (auto/manual)
   - Terminal confirmation settings

5. **Start Coding**
   - Open a file from the explorer
   - Open an AI tab
   - Begin conversation

### 4.4 Configuration File

Relay stores configuration in `~/.relay/config.toml`:

```toml
[general]
theme = "dark"
font_size = 14
font_family = "JetBrains Mono"
auto_save_interval = 30

[ai]
providers = ["chatgpt", "kimi", "qwen"]
handoff_mode = "auto"  # "auto" | "manual" | "confirm"
handoff_priority = ["chatgpt", "kimi", "qwen"]
context_budget = 8000  # tokens (approximate)

[terminal]
default_shell = "zsh"
working_directory = "project_root"  # or "current_file"
confirm_commands = true
scrollback_lines = 10000

[security]
confirm_file_deletion = true
confirm_file_overwrite = true
read_only_patterns = [".env", ".env.*", "node_modules"]
max_file_size_mb = 5

[performance]
max_webviews = 3
lazy_load_inactive = true
file_watcher_debounce_ms = 300
```

---

## 5. Workflow Guide

### 5.1 Basic Coding Workflow

```
┌────────────────────────────────────────────────────────────────┐
│  1. OPEN PROJECT                                               │
│     → File → Open Folder → Select project                      │
│     → File tree populates in left sidebar                      │
├────────────────────────────────────────────────────────────────┤
│  2. OPEN FILE                                                  │
│     → Click file in explorer OR Ctrl+P                         │
│     → File opens in Monaco editor (center panel)               │
├────────────────────────────────────────────────────────────────┤
│  3. ASK AI FOR HELP                                            │
│     → Click ChatGPT tab (right sidebar)                        │
│     → Type: "This function is slow. Can you optimize it?"    │
│     → AI responds with optimized code                          │
├────────────────────────────────────────────────────────────────┤
│  4. APPLY CHANGES                                              │
│     → Click [💾 Apply] button below AI's code block            │
│     → Diff preview appears                                     │
│     → Review changes → Click [Apply]                           │
│     → File updates in editor                                   │
├────────────────────────────────────────────────────────────────┤
│  5. TEST CHANGES                                               │
│     → Open terminal (bottom panel)                             │
│     → Run: npm test                                            │
│     → Or click [▶ Run] on AI-suggested test command            │
└────────────────────────────────────────────────────────────────┘
```

### 5.2 The Relay Handoff Workflow

```
┌────────────────────────────────────────────────────────────────┐
│  SCENARIO: You're refactoring a React component with ChatGPT   │
├────────────────────────────────────────────────────────────────┤
│                                                                  │
│  You: "Help me convert this class component to hooks"            │
│  ChatGPT: [provides conversion]                                  │
│  You: "Now add useEffect for the data fetching"                  │
│  ChatGPT: [works on it]                                          │
│  You: "Can you memoize the expensive calculation?"               │
│  ChatGPT: "You've reached your GPT-4 limit. Try again later."  │
│                                                                  │
├────────────────────────────────────────────────────────────────┤
│  RELAY AUTO-HANDOFF:                                             │
│                                                                  │
│  [🔄 Detecting rate limit...]                                    │
│  [📦 Compacting session (3.2KB Relay Packet)...]               │
│  [🌙 Switching to Kimi...]                                       │
│  [💉 Injecting context...]                                       │
│  [✅ Handoff complete! Kimi is now active.]                      │
│                                                                  │
├────────────────────────────────────────────────────────────────┤
│  Kimi: "I see you were converting a class component to hooks     │
│         and adding useEffect for data fetching. You wanted to   │
│         memoize an expensive calculation. Here's the memoized   │
│         version using useMemo..."                                │
│                                                                  │
│  You: [continues naturally, zero context lost]                   │
└────────────────────────────────────────────────────────────────┘
```

### 5.3 Terminal-Driven Workflow

```
┌────────────────────────────────────────────────────────────────┐
│  1. RUN INTO ERROR                                               │
│     → Terminal shows: TypeError: Cannot read property...       │
├────────────────────────────────────────────────────────────────┤
│  2. CAPTURE ERROR                                                │
│     → Select error text in terminal                            │
│     → Right-click → "Send to AI"                               │
│     → Or click terminal's "Share with AI" button               │
├────────────────────────────────────────────────────────────────┤
│  3. AI ANALYZES                                                  │
│     → AI receives: error + current file context + recent changes│
│     → AI responds with diagnosis and fix                        │
├────────────────────────────────────────────────────────────────┤
│  4. APPLY FIX                                                    │
│     → Click [💾 Apply] on suggested fix                        │
│     → Diff shows exact changes                                  │
│     → Confirm → File updated                                    │
├────────────────────────────────────────────────────────────────┤
│  5. VERIFY                                                       │
│     → Run tests again via terminal                              │
│     → Green checkmark = success                                 │
└────────────────────────────────────────────────────────────────┘
```

### 5.4 Multi-File Refactoring Workflow

```
┌────────────────────────────────────────────────────────────────┐
│  GOAL: Rename a function used across 15 files                    │
├────────────────────────────────────────────────────────────────┤
│  1. SELECT FUNCTION                                              │
│     → Cursor on function name                                   │
│     → Right-click → "Find All References"                       │
│     → 15 usages found across 8 files                            │
├────────────────────────────────────────────────────────────────┤
│  2. ASK AI TO REFACTOR                                           │
│     → "Rename 'fetchUserData' to 'getUserProfile' everywhere"  │
│     → AI analyzes all references                                │
│     → AI provides multi-file diff                               │
├────────────────────────────────────────────────────────────────┤
│  3. REVIEW & APPLY                                               │
│     → Modal shows all 15 changes in 8 files                   │
│     → Review each file's diff                                   │
│     → Uncheck files you don't want changed                    │
│     → Click [Apply All Checked]                                 │
├────────────────────────────────────────────────────────────────┤
│  4. VERIFY                                                       │
│     → Git diff shows clean rename                             │
│     → Run type checker: npm run type-check                     │
│     → All green                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## 6. Usage Patterns

### 6.1 The Solo Developer
**Profile:** Building a side project, cost-conscious, wants to move fast.

**Typical Session:**
- Opens Relay with a Next.js project
- Asks ChatGPT: "Generate a login page with Tailwind"
- Applies generated code
- Runs `npm run dev` in terminal
- Notices a styling issue
- Asks Kimi: "Fix the centering on mobile"
- Applies fix
- Commits via terminal: `git commit -m "feat: add responsive login"`

**Value:** Zero API costs, fast iteration, single-window workflow.

### 6.2 The Full-Stack Prototyper
**Profile:** Rapidly building MVPs, switching between frontend and backend.

**Typical Session:**
- Working on API route (Node.js)
- Hits rate limit on ChatGPT mid-debug
- Relay hands off to Qwen
- Qwen continues debugging the Express middleware
- Switches to frontend file
- Asks Kimi for React component help
- Uses terminal to run both frontend and backend simultaneously

**Value:** Uninterrupted flow across the full stack, model specialization.

### 6.3 The Learner
**Profile:** Learning a new framework or language, needs explanations.

**Typical Session:**
- Opens a Rust project
- Asks ChatGPT: "Explain what this lifetime annotation does"
- Gets detailed explanation with examples
- Tries modifying the code
- Compilation error
- Sends error to AI, gets fix + explanation
- Takes notes in a markdown file

**Value:** Integrated learning environment with immediate feedback.

### 6.4 The Global Developer
**Profile:** In a region with limited AI access, needs reliable fallbacks.

**Typical Session:**
- Primary model: Kimi (best local performance)
- Kimi hits regional rate limit
- Relay auto-switches to Qwen
- Qwen continues with full context
- If Qwen also limited, falls back to ChatGPT via VPN

**Value:** Resilient access regardless of regional restrictions.

---

## 7. The Relay Handoff Protocol (Deep Dive)

### 7.1 Detection Layer

Relay monitors each webview through a DOM MutationObserver in the preload script. Detection signals vary by provider:

| Provider | Rate Limit Signal | DOM Selector | Confidence |
|----------|------------------|--------------|------------|
| ChatGPT | Text: "You've reached your limit" | `[data-testid='limit-toast']` | High |
| ChatGPT | Text: "Too many requests" | `.text-error` containing "many requests" | High |
| ChatGPT | Button disabled + error banner | `button[disabled]` + `.error-banner` | Medium |
| Kimi | Text: "请求过于频繁" | `.limit-notice` | High |
| Kimi | Text: "已达到使用限制" | `.usage-limit` | High |
| Qwen | Text: "请求太频繁" | `.freq-limit` | High |
| Qwen | Text: "请稍后再试" | `.retry-hint` | Medium |

**Multi-Signal Confirmation:**
To reduce false positives, Relay requires at least 2 signals within a 10-second window:
1. DOM text match (primary)
2. Input field disabled (secondary)
3. No AI response for >90 seconds (tertiary)
4. Model error state persisting >30 seconds (primary — per PRD §6.2)

Handoff triggers in the PRD (§6.2) and this signal list are the same policy: at least 2 signals within a 10-second window, with the >30s error state and >90s silence counted as independent signals.

### 7.2 Capture Layer

When triggered, Relay captures:

**A. Conversation History**
```javascript
// Extract all user/assistant message pairs
const messages = [];
document.querySelectorAll('[data-message-author-role]').forEach(el => {
  messages.push({
    role: el.getAttribute('data-message-author-role'),
    content: extractTextAndCode(el),
    timestamp: detectTimestamp(el)
  });
});
```

**B. File State**
- Hash (SHA-256) of all open files
- File sizes and modification times
- Git status of each file

**C. Terminal State**
- Last 50 commands executed
- Current working directory
- Last 100 lines of output
- Exit codes of recent commands

**D. Project Metadata**
- `package.json` / `Cargo.toml` / `requirements.txt` contents
- Git branch and recent commits (last 5)
- Environment variables (names only, values redacted)

### 7.3 Compaction Layer

Raw conversation data is too large for context windows. Relay compacts it:

**Summarization Strategy:**
1. **Extract Key Decisions:** Scan for phrases like "let's use," "we decided," "I recommend"
2. **Identify Current Task:** Last user message + AI's incomplete response
3. **List Blockers:** Explicitly stated blockers or errors
4. **Code Changes Log:** File, operation type, one-line summary
5. **Truncate Old History:** Conversations beyond the last 5 exchanges are summarized

**Example Compaction:**
```
RAW: 15 exchanges, ~4000 tokens of conversation
COMPACTED: 
  - Goal: Build OAuth with NextAuth
  - Decisions: Use JWT strategy, Google provider
  - Current Task: Writing callback handler
  - Blocker: PKCE verifier handling
  - Changes: Created src/lib/auth.ts (config)
  - Recent: User asked about error handling
```

### 7.4 Injection Layer

The compacted context is injected into the target model's input field:

**Injection Prompt Template:**
```
You are continuing an active coding session. The previous AI assistant 
reached its usage limit. Here is the complete context you need:

## PROJECT
- Path: /home/user/projects/my-app
- Stack: Next.js 14 + TypeScript + Prisma
- Active Files: src/app/api/auth/route.ts, src/lib/auth.ts

## WHAT WE'RE DOING
Building Google OAuth integration using NextAuth.js v5 (beta).

## DECISIONS MADE
1. Using JWT session strategy (not database sessions)
2. GoogleProvider with clientId from env
3. Prisma adapter configured

## CURRENT TASK
Writing the OAuth callback handler in src/app/api/auth/route.ts to 
exchange the authorization code for tokens and create/update the user 
in the database.

## BLOCKER
Need to properly handle the PKCE code verifier during the callback.
The previous assistant was about to show the implementation.

## RECENT TERMINAL OUTPUT
Migration completed. Prisma client generated. Server running on :3000.

## FILES CHANGED SO FAR
- src/lib/auth.ts (created: NextAuth config with Google provider)

Please continue from where we left off. The user is waiting.
```

### 7.5 Verification Layer

After injection:
1. Wait for target model's first response
2. Verify response references the correct context
3. If response is generic ("I don't have context"), retry injection
4. If retry fails, alert user with manual copy-paste fallback

---

## 8. Security Architecture

### 8.1 Threat Model

| Threat | Vector | Mitigation |
|--------|--------|------------|
| **Malicious AI Commands** | AI suggests `rm -rf /` | All terminal commands require confirmation by default |
| **File Overwrite** | AI suggests overwriting `.env` | `.env` files are read-only by default; diff preview required |
| **Credential Leakage** | AI requests API keys in chat | Preload scripts redact patterns matching secrets |
| **XSS via Webview** | Compromised AI provider site | CSP headers, contextIsolation, no nodeIntegration |
| **Prompt Injection → IPC** | Malicious provider page or AI response emits `relay:*` events into the bridge | Main process validates every event's origin and schema; each webview gets a one-way capability token; page JS never holds raw IPC — only the narrow, typed `__RELAY_BRIDGE__` API |
| **Session Hijacking** | Cookies extracted from webview | Cookies managed by native webview; Relay never reads them |
| **Keylogger** | Preload script captures keystrokes | Preload only observes AI response DOM, not user input |
| **Supply Chain** | Malicious npm package in project | No automatic execution; user confirmation for all installs |

### 8.2 Sandboxing

```
┌─────────────────────────────────────────┐
│  Tauri Main Process (Rust)              │
│  ┌─────────────────────────────────┐    │
│  │  Webview (Sandboxed)              │    │
│  │  ┌─────────────────────────┐     │    │
│  │  │  AI Provider Website    │     │    │
│  │  │  (Untrusted)            │     │    │
│  │  └─────────────────────────┘     │    │
│  │           ↑                      │    │
│  │  ┌─────────────────────────┐     │    │
│  │  │  Preload Script (Trusted)│     │    │
│  │  │  - Read-only DOM access  │     │    │
│  │  │  - IPC bridge only        │     │    │
│  │  └─────────────────────────┘     │    │
│  └─────────────────────────────────┘    │
│           │                              │
│  ┌────────▼──────────────────────┐        │
│  │  IPC Router (Validated)      │        │
│  │  - Whitelist of commands      │        │
│  │  - Rate limiting              │        │
│  └──────────────────────────────┘        │
└─────────────────────────────────────────┘
```

**Security Rules:**
- `contextIsolation: true` — preload cannot access web page JS
- `sandbox: true` — webview runs in OS-level sandbox
- IPC messages are validated against a strict schema
- File system access restricted to selected project directory
- No `eval()` or dynamic code execution in main process

### 8.3 Data Privacy

| Data Type | Storage | Encryption | Retention |
|-----------|---------|------------|-----------|
| Session state | Local SQLite | AES-256 (key in OS keychain) | Until deleted |
| Relay Packets | Local JSON files | AES-256 | Until deleted |
| AI Cookies | Native webview storage | OS-managed | Per provider policy |
| Terminal history | SQLite | AES-256 | 30 days default |
| File contents | In-memory only | N/A | Cleared on close |
| API keys (if added) | OS keychain | Keychain-native | Until deleted |

**No-Relay-Cloud Policy:**
- Relay runs no cloud of its own: no Relay-hosted servers, no telemetry (opt-in anonymous crash reports only), no account required
- Data flows only between your machine and the AI providers you explicitly connect. Prompts and code you share in chat are transmitted to those providers and are subject to their terms and data policies
- Nothing is sent to any service other than the provider websites you have added

### 8.4 Execution Safety

**Terminal Command Confirmations:**
```toml
[security.terminal]
confirm_destructive = true      # rm, del, format, etc.
confirm_install = true          # npm install, pip install, etc.
confirm_sudo = true             # sudo, admin commands
confirm_network = true          # curl | bash, wget, etc.
trusted_projects = []           # Paths where confirmations are skipped
```

**File Operation Safety:**
```toml
[security.files]
confirm_delete = true
confirm_overwrite = true
confirm_large_changes = true    # >50 lines changed
read_only_patterns = [".env", ".env.*", "*.pem", "*.key", "id_rsa"]
max_file_size_mb = 10           # Warn before opening large files
backup_before_edit = true       # Create .relay-backup/ before changes
```

### 8.5 Compliance Strategy (Human-in-the-Loop)

Relay's stance is **assisted — never automated evasion**:

- **No headless automation.** Every context injection and message send into a provider UI is triggered by, or confirmed by, the user. Relay never transmits a message to a provider without user action.
- **No anti-bot measures.** Relay does not spoof user agents, rotate fingerprints, or otherwise attempt to evade provider controls. The "Custom User Agents" capability previously listed in §3.2 is removed.
- **User disclosure.** On first connecting a provider, Relay shows a one-time notice: *"Relay automates actions you confirm within this provider's web interface. Heavy automated use may violate the provider's terms; how you use your accounts is your responsibility."*
- **Provider changes are honored.** If a provider disables or changes a capability, Relay disables it too — it never works around provider controls.
- **Fallback by design.** If injection or auto-confirm is unavailable (DOM change, network policy), Relay degrades to a manual copy-paste bridge: the user copies the Relay Packet and pastes it into the next model themselves.

---

## 9. Performance Characteristics

### 9.1 Benchmarks

| Metric | Target | Acceptance Test |
|--------|--------|-----------------|
| **Cold Start** | <2s | Process start → editor interactive; median of 5 runs |
| **Webview Load** | <3s | Provider page interactive event; median of 5 loads |
| **File Tree (1k files)** | <200ms | Synthetic tree render; median of 5 |
| **File Tree (10k files)** | <1s | Synthetic tree render; median of 5 |
| **File Tree (100k files)** | <5s | With lazy loading; median of 5 |
| **Handoff Time** | <5s | Detect → inject for a 20-exchange session; median of 5 |
| **Handoff (large session)** | <10s | Same, 50+ exchanges |
| **Terminal Latency** | <50ms | PTY echo round-trip; median of 50 |
| **Editor Open (1MB file)** | <500ms | Time to first paint; median of 5 |
| **Memory (idle)** | <400MB | RSS peak, 1 webview, 10 min idle |
| **Memory (active)** | <800MB | RSS peak, 3 webviews + editor |
| **Memory (stress)** | <1.5GB | RSS peak, 5 webviews + large project |

> **Honesty note:** All values above are **targets with defined acceptance tests** — none are measured yet. Once the v0.1 build exists and CI benchmarks are wired in, this table gains a "Measured" column with the environment and date.

### 9.2 Resource Management

**Webview Lifecycle:**
- Active webview: Full rendering, DOM observers active
- Standby webview: JavaScript paused, DOM retained in memory
- Suspended webview: Process frozen, restored on activation
- Maximum 3 concurrent webviews (configurable)

**Memory Optimization:**
- Image compression in webviews disabled
- CSS animations in webviews throttled
- Garbage collection triggered after handoff
- File contents loaded on-demand (not all cached)

**CPU Optimization:**
- File watcher uses OS-native APIs (FSEvents, inotify, ReadDirectoryChanges)
- DOM observers debounced (300ms)
- Relay Packet generation offloaded to worker thread
- Terminal rendering uses GPU acceleration (xterm.js WebGL addon)

### 9.3 Scalability Limits

| Resource | Soft Limit | Hard Limit | Behavior at Limit |
|----------|-----------|------------|-------------------|
| Project Files | 50,000 | 200,000 | Tree virtualization + async indexing |
| Open Files | 20 | 50 | LRU eviction of oldest tab |
| Terminal History | 10,000 lines | 50,000 lines | Automatic truncation |
| Session Exchanges | 100 | 500 | Force compaction + warn user |
| Relay Packet Size | 50KB | 200KB | Truncate raw logs, keep summary |
| Webviews | 3 | 5 | LRU suspension |

---

## 10. Big Project Handling

### 10.1 Project Size Tiers

| Tier | File Count | Performance | Recommended Settings |
|------|-----------|-------------|---------------------|
| **Small** | <1,000 | Optimal | All features enabled |
| **Medium** | 1,000-10,000 | Good | Enable lazy loading |
| **Large** | 10,000-50,000 | Acceptable | Disable git badges, reduce context |
| **Very Large** | 50,000-200,000 | Degraded | File tree only, no indexing |
| **Monorepo** | 200,000+ | Manual config required | Workspace folders, exclude patterns |

### 10.2 Large Project Strategies

**A. Workspace Folders**
Instead of opening the entire monorepo, open specific packages:
```
Relay: Open Folder → Select /packages/frontend
Later: Add Folder to Workspace → /packages/shared
```

**B. Exclude Patterns**
Configure files to ignore:
```toml
[project]
exclude_patterns = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "*.log",
  "coverage",
  ".next",
  "target",        # Rust
  "__pycache__",
  "*.min.js",
  "*.bundle.js"
]
```

**C. Context Targeting**
Instead of auto-including all open files, use explicit context:
```
User: @src/core/engine.ts @src/core/parser.ts 
      How do these two interact?
```

**D. File Summarization**
For large files (>1000 lines), Relay generates a structural summary:
```
File: src/legacy/monolith.js (2,400 lines)
Summary: Contains 15 functions, 3 classes. 
         Main exports: processData(), validateInput(), transformOutput()
         Dependencies: lodash, moment, internal-utils
```

**E. Git-Based Context**
Only include files modified in the current branch:
```toml
[ai.context]
mode = "git_diff"  # Only changed files + dependencies
```

### 10.3 Monorepo-Specific Features

- **Package Detection:** Auto-detects `package.json`, `Cargo.toml`, `pyproject.toml` boundaries
- **Cross-Package Navigation:** "Go to Definition" works across package boundaries
- **Root-Aware Terminal:** Terminal defaults to nearest package root, not monorepo root
- **Selective Indexing:** Index only active package + its dependencies

---

## 11. Precautions & Limitations

### 11.1 Current Limitations

1. **Webview Fragility**
   - AI providers can change their DOM at any time
   - Preload scripts may break after provider updates
   - Recovery: Community-driven selector updates within 24-48 hours

2. **No True Agentic Loop**
   - AI cannot autonomously read files or run commands
   - All actions require user confirmation (by design, for safety)
   - This is a feature, not a bug — prevents runaway AI

3. **Context Window Constraints**
   - Web UIs have implicit context limits (not exposed to Relay)
   - Very large projects may exceed what can be injected
   - Mitigation: Smart truncation and @mention targeting

4. **Rate Limit Unpredictability**
   - Free tiers have undocumented limits
   - Limits vary by account age, usage patterns, region
   - Relay cannot predict limits, only react to them

5. **No Offline AI**
   - Requires internet connection to AI providers
   - Local editing works offline, but AI assistance does not

6. **Single-User Design**
   - No multiplayer/collaborative editing
   - No cloud sync of sessions
   - Sessions are local to one machine

### 11.2 Usage Precautions

**Before You Start:**
- ✅ Ensure you have accounts on at least 2 AI providers
- ✅ Verify all providers work in your region
- ✅ Test handoff manually at least once
- ✅ Configure backup settings ( Relay creates `.relay-backup/` )

**While Using:**
- ⚠️ Review all diffs before applying AI changes
- ⚠️ Don't blindly run terminal commands from AI
- ⚠️ Keep `.env` and secret files in `read_only_patterns`
- ⚠️ Save important work before major refactoring
- ⚠️ Check git status regularly to track AI-made changes

**After Sessions:**
- 🧹 Clear Relay Packets if they contain sensitive code
- 🧹 Review `.relay-backup/` and clean old backups
- 🧹 Log out of providers on shared computers

### 11.3 When NOT to Use Relay

- ❌ Production emergency fixes (use your proven IDE)
- ❌ Security-critical code review (AI may miss vulnerabilities)
- ❌ Compliance-regulated environments (audit trail concerns)
- ❌ Without version control (always use git with Relay)
- ❌ For code you cannot share with third-party AI providers

---

## 12. Known Risks & Mitigations

### 12.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Provider blocks automation** | Medium | Critical | Fallback to manual bridge; respect ToS; community workarounds |
| **DOM selectors break** | High | Medium | Weekly updates; community selector registry; graceful degradation |
| **Memory leak in webviews** | Medium | Medium | LRU eviction; process isolation; manual refresh option |
| **Handoff context loss** | Low | High | Raw log backup; manual packet inspection; retry logic |
| **File corruption on apply** | Low | Critical | Diff preview mandatory; `.relay-backup/` auto-created; undo stack |
| **Terminal escape injection** | Low | Critical | Input sanitization; command whitelist option; no auto-execution |
| **Remote webview platform limits** | High | Medium | Preload injection into remote pages differs per webview (WKWebView user scripts, WebView2 `AddScriptToExecuteOnDocumentCreated`, WebKitGTK); some Tauri configs forbid remote navigation — validate per platform in a Phase 1 spike |

### 12.2 Business Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Provider ToS violation** | Medium | High | Clear user disclosure; no forced automation; manual override always available |
| **Free tier discontinuation** | Low | High | Diversify across 4+ providers; API key fallback mode planned |
| **Competitor feature parity** | Medium | Medium | Focus on handoff innovation; open source core; community-driven |
| **Platform security audit failure** | Low | Critical | Regular audits; bounty program; transparent security docs |

### 12.3 User Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Over-reliance on AI** | High | Medium | Educational prompts; "Think before applying" reminders |
| **Code quality degradation** | Medium | Medium | Encourage review; git diff visibility; test integration |
| **Accidental data leakage** | Low | High | Secret redaction; `.env` protection; explicit context control |
| **Addiction to vibe coding** | Medium | Low | Usage reminders; skill-building suggestions; offline mode |

---

## 13. Improvements Roadmap

### 13.1 Near-Term (v1.1 - v1.3)

**v1.1 — Stability & Polish**
- [ ] Automated selector health checks (detect DOM changes)
- [ ] Retry logic for failed handoffs (3 attempts with backoff)
- [ ] Better error messages when providers are unreachable
- [ ] Keyboard shortcuts for all actions
- [ ] Custom themes (import VS Code themes)
- [ ] Plugin system for custom preload scripts

**v1.2 — Context Intelligence**
- [ ] Local LLM for packet compaction (Llama 3B, runs on CPU)
- [ ] Semantic file search (vector indexing of code)
- [ ] Auto-context based on cursor position (AST-aware)
- [ ] Import graph visualization
- [ ] Test result integration (parse Jest/Vitest output)

**v1.3 — Collaboration**
- [ ] Session export/import (shareable Relay Packets)
- [ ] GitHub Gist integration for sharing snippets
- [ ] Pair programming mode (screen sharing via WebRTC)
- [ ] Comment threads on code (like GitHub PR reviews)

### 13.2 Mid-Term (v2.0)

- [ ] **API Key Fallback Mode:** Use APIs when web UIs fail
- [ ] **Local Model Support:** Ollama integration for offline AI
- [ ] **Agent Mode (Opt-In):** Allow AI to run commands without confirmation (sandboxed)
- [ ] **Voice Interface:** Speech-to-text input, text-to-speech responses
- [ ] **Mobile Companion App:** View sessions, approve changes from phone
- [ ] **CI/CD Integration:** Relay Packets as deployment artifacts

### 13.3 Long-Term (v3.0+)

- [ ] **Self-Hosted AI:** Bundle small local models for instant responses
- [ ] **Multi-User Workspaces:** Team coding with shared AI context
- [ ] **AI-Native Version Control:** Semantic diffs, intent-based commits
- [ ] **Cross-Project Learning:** AI remembers patterns across your projects
- [ ] **IDE Protocol:** Standardize the Relay Handoff Protocol for other tools

---

## 14. Future Scope

### 14.1 Platform Expansion

**Browser Extension:**
- Use Relay's context bridge from any browser tab
- "Send this page to my Relay session"
- Extract code from documentation into your project

**VS Code Extension:**
- Use Relay Handoff within VS Code
- Bridge VS Code's AI features with web-based models
- Keep your existing extensions and keybindings

**Cloud Relay (Optional):**
- For users who want cloud persistence
- Encrypted session sync across devices
- Team workspaces with end-to-end encryption
- **Note:** Local-first remains the default; cloud is opt-in

### 14.2 AI Provider Expansion

Planned providers:
- **Claude (Anthropic):** web interface support
- **Perplexity:** Research-focused coding assistance
- **DeepSeek:** Cost-effective coding model
- **Local Models:** Ollama, LM Studio, llama.cpp integration
- **Enterprise:** Azure OpenAI, AWS Bedrock (API mode)

### 14.3 Ecosystem

**Relay Registry:**
- Community-driven selector updates
- Preload script marketplace
- Relay Packet templates for common tasks
- Provider compatibility database

**Relay Academy:**
- Tutorials on effective vibe coding
- Prompt engineering for code generation
- Security best practices
- Handoff protocol deep dives

### 14.4 Research Directions

- **Context Compression Algorithms:** Better summarization for handoffs
- **Multi-Model Consensus:** Run same prompt on 2 models, compare results
- **Predictive Handoff:** Anticipate rate limits before they happen
- **Emotional State Detection:** Detect user frustration, suggest breaks
- **Code Ownership Tracking:** Track which AI suggested which lines

---

## 15. Troubleshooting

### 15.1 Common Issues

**Issue: Webview shows blank page**
- Check internet connection
- Try refreshing: `Ctrl+R` or View → Reload Webview
- Check if provider is down (visit in regular browser)
- Clear webview cache: Settings → Advanced → Clear Cache

**Issue: Handoff not triggering**
- Verify multiple providers are added and logged in
- Check handoff mode in settings (auto vs manual)
- Look for rate limit indicators in the AI tab
- Try manual handoff: Click "Relay" button in toolbar

**Issue: Code block buttons not appearing**
- Provider may have updated DOM
- Check for Relay updates
- Try refreshing the webview
- Report issue with provider name and date

**Issue: Terminal shows "Permission denied"**
- Check file permissions on project directory
- Ensure shell has execute permissions
- Try changing default shell in settings
- On macOS: Grant Relay Full Disk Access in System Preferences

**Issue: File changes not reflecting in AI context**
- Check if file watcher is enabled in settings
- Try manually adding file to context: Right-click → "Add to AI Context"
- Large files may be excluded from auto-context

**Issue: High memory usage**
- Close unused webview tabs
- Reduce number of open files
- Clear terminal history: Terminal → Clear History
- Restart Relay (sessions auto-save)

### 15.2 Debug Mode

Enable debug logging:
```toml
[debug]
log_level = "debug"  # trace | debug | info | warn | error
log_file = "~/.relay/logs/relay.log"
webview_devtools = true  # Open Chrome DevTools in webviews
```

Access logs:
- macOS: `~/Library/Logs/Relay/`
- Windows: `%APPDATA%\Relay\logs\`
- Linux: `~/.config/Relay/logs/`

### 15.3 Getting Help

1. Check this documentation
2. Search GitHub Issues
3. Join Discord community
4. Open a GitHub Issue with:
   - Relay version
   - OS and version
   - Steps to reproduce
   - Debug logs (if applicable)

---

## 16. FAQ

**Q: Is Relay free?**
A: Yes. Relay itself is free and open source. You use the free tiers of AI providers. No API keys needed.

**Q: Does Relay work offline?**
A: Partially. The IDE (editor, terminal, file explorer) works offline. AI features require internet.

**Q: Will I get banned for using Relay?**
A: Relay never bypasses provider controls — it only automates actions you confirm inside the provider's web interface (see §8.5). Heavy automated use can still trigger rate limits or violate a provider's terms, and what happens to your accounts is your responsibility. We recommend natural usage patterns and keeping at least two providers connected.

**Q: Can I use my own API keys instead?**
A: Not in v1.0, but API fallback mode is planned for v2.0.

**Q: How many models do I need?**
A: Minimum 2 for handoff functionality. Recommended: 3 (ChatGPT + Kimi + Qwen).

**Q: Does Relay support mobile?**
A: Not currently. Desktop only (macOS, Windows, Linux).

**Q: Can I use Relay for work projects?**
A: Check your employer's policy on AI tools and data sharing. Relay keeps data local, but AI providers may process your code.

**Q: How is this different from Cursor or GitHub Copilot?**
A: Cursor and Copilot use APIs (paid). Relay uses free web interfaces. Cursor is single-model; Relay is multi-model with handoff.

**Q: What if all my models are rate-limited?**
A: Relay shows a "All models unavailable" screen. You can wait for limits to reset, or add more providers. Your session is saved.

**Q: Can I export my session?**
A: Yes. Session → Export creates a `.relay` file with all context (excluding sensitive files).

**Q: Is my code sent to AI providers?**
A: Only what you explicitly share in chat. Auto-context includes open files, but you control what's shared.

**Q: How big can Relay Packets get?**
A: Typically 5-50KB. Large sessions may reach 200KB. Packets are compressed and truncated if too large.

**Q: Can I disable the handoff and use one model?**
A: Yes. Set `handoff_mode = "manual"` in config. You'll get a prompt instead of auto-switch.

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | Aug 2026 | Initial release of this document |
| 1.1-draft | Aug 2026 | Honesty pass: re-labeled unmeasured benchmarks as targets with acceptance tests; rewrote "Zero Cloud Policy" as "No-Relay-Cloud Policy"; removed the anti-detection "Custom User Agents" claim; added §8.5 Compliance Strategy; added prompt-injection→IPC threat row and remote-webview platform limits risk; reconciled numbers with PRD v1.1-draft (rate-limit triggers, memory targets, file-tree timing, Packet Inspector status); fixed the FAQ ban answer |
| 1.1-draft | Aug 2026 | v0.1 implementation note: terminal stack changed from `node-pty` to Rust `portable-pty` (no Node sidecar in Tauri); xterm.js frontend unchanged. The provider preload bridge is a stub pending the Phase 1 platform spike; provider windows ship with no Tauri capability, enforcing §8.1 by configuration |

---

*End of Document*

**License:** MIT  
**Repository:** github.com/relay/relay  
**Community:** discord.gg/relay  
**Issues:** github.com/relay/relay/issues
