// Relay provider bridge — v0.4.
//
// Security posture (Complete Docs §8.1 / §8.5): provider pages are remote
// third-party sites with NO Tauri IPC, so a compromised provider page cannot
// invoke commands or read app state. All AI capabilities (read project,
// write/edit/create files, run commands) are *user-confirmed actions*:
//
//   READ   → the host injects project context / file contents into the input
//             via __relay_fill (below), or the user sends a file from the
//             explorer. Relay never reads a file the user did not approve.
//   WRITE/EDIT/CREATE → the host calls __relay_scan_dom() on a poll; it walks
//             the provider DOM (shadow-DOM aware, with a generic fallback) and
//             extracts code blocks and commands from assistant messages. The
//             UI shows [Apply]/[Run] buttons the user clicks.
//   RUN     → bash blocks surface as [▶ Run] buttons that execute in the PTY
//             only after the user confirms.
//   HANDOFF → the host bakes __RELAY_INJECT__ = {provider, prompt} into this
//             script at webview creation; the input is pre-filled for review.
//
// Selector registry: the host injects window.__RELAY_SELECTORS__ (loaded from
// ~/.relay/selectors.json, updateable without an app rebuild). The values
// here are merged over it, so a registry entry replaces the default.
//
// Rate-limit detection is multi-signal and passive (runs inside the existing
// scan poll, never aggressive): text phrases + disabled input + disabled send
// button + error toast, with >= 2 signals required.
(() => {
  if (window.__RELAY_BRIDGE__) return;

  const INJECT = window.__RELAY_INJECT__ || null;
  const provider = INJECT ? INJECT.provider : null;

  // Bundled defaults — superseded by the host-injected registry.
  const DEFAULT_SELECTORS = {
    chatgpt: {
      input: ["#prompt-textarea"],
      assistant: ["[data-message-author-role='assistant']"],
    },
    kimi: {
      input: ["textarea[placeholder*='输入']"],
      assistant: [".chat-message-assistant", "[class*='chat-message-assistant']"],
    },
    qwen: {
      input: ["#chat-input"],
      assistant: [".message-bot", "[class*='message-bot']"],
    },
    gemini: {
      input: ["div.ql-editor[contenteditable='true']", "textarea[placeholder]", "rich-textarea"],
      assistant: [
        "model-response", "message-content", "model-response-text",
        ".model-response-text", ".response-container", "[class*='response']",
      ],
    },
  };

  // Merge the host registry over the defaults (registry wins per key).
  const REGISTRY = (() => {
    const r = JSON.parse(JSON.stringify(DEFAULT_SELECTORS));
    const ext = window.__RELAY_SELECTORS__;
    if (ext && ext.providers) {
      for (const [prov, sel] of Object.entries(ext.providers)) {
        if (!r[prov]) r[prov] = {};
        if (Array.isArray(sel.input)) r[prov].input = sel.input;
        if (Array.isArray(sel.assistant)) r[prov].assistant = sel.assistant;
      }
    }
    return r;
  })();

  const inputSelectors = () =>
    (REGISTRY[provider] && REGISTRY[provider].input) ||
    ["textarea", "[contenteditable='true']"];
  const assistantSelectors = () =>
    (REGISTRY[provider] && REGISTRY[provider].assistant) || [];

  // Generic fallback — matches any container that plausibly holds AI output:
  // code blocks, message/response containers, markdown bodies. Used when the
  // provider-specific selectors find nothing.
  const GENERIC_SELECTORS =
    "pre, code, [class*='code'], [class*='response'], [class*='message'], " +
    "[class*='assistant'], .markdown, .prose, [data-message-author-role]";

  const RATE_LIMIT_HINTS = [
    "You've reached your limit",
    "Too many requests",
    "rate limit",
    "请求过于频繁",
    "请求太频繁",
    "请稍后再试",
    "已达到使用限制",
  ];
  const COMMAND_LANGS = new Set([
    "bash", "sh", "shell", "zsh", "powershell", "pwsh", "cmd", "console",
  ]);
  const MAX_ACTIONS = 20;
  const MAX_RECENT = 8;   // rolling conversation buffer (handoff packet)
  const MAX_MSG_LEN = 6000;
  // Messages shorter than this are UI chrome, not model output.
  const MIN_MSG_LEN = 20;

  const banner = (text, isError) => {
    const el = document.createElement("div");
    el.textContent = text;
    Object.assign(el.style, {
      position: "fixed", top: "12px", right: "12px", zIndex: "2147483647",
      background: isError ? "#EF4444" : "#22C55E", color: "#fff",
      padding: "10px 14px", borderRadius: "8px",
      font: "13px system-ui, sans-serif",
      boxShadow: "0 6px 20px rgba(0,0,0,.4)", maxWidth: "340px",
    });
    (document.body || document.documentElement).appendChild(el);
    setTimeout(() => el.remove(), 12000);
  };

  // ---- scan state, refreshed by the host on every poll ----
  const state = {
    provider,
    scan_version: 5,
    scanned_at: 0,
    messages_seen: 0,
    commands: [],   // { text, lang }
    file_ops: [],   // { path, code, lang }  (path may be null)
    rate_limited: false,
    rate_limit_signals: [],
    last_message: "",
    recent: [],     // rolling buffer: [{ text }]
    diag: null,
  };
  window.__relay_state__ = state;

  // Shadow-DOM-aware collection: querySelectorAll per tree, then recurse into
  // every shadow root found (depth-capped). Native queries — fast even on big
  // SPAs, and reaches messages rendered inside shadow DOM.
  const collect = (sel) => {
    const found = [];
    const walk = (root, depth) => {
      if (depth > 6 || found.length >= 60) return;
      const list = root.querySelectorAll(sel);
      for (const el of list) {
        found.push(el);
        if (found.length >= 60) return;
      }
      const hosts = root.querySelectorAll("*");
      for (const h of hosts) {
        if (h.shadowRoot) walk(h.shadowRoot, depth + 1);
      }
    };
    walk(document, 0);
    return found;
  };

  // Try each selector in the list; first non-empty wins.
  const collectAny = (sels) => {
    for (const sel of sels) {
      const found = collect(sel);
      if (found.length) return found;
    }
    return [];
  };

  const seenCodes = new Set();
  const addAction = (arr, item) => {
    const key = item.text;
    if (seenCodes.has(key)) return;
    seenCodes.add(key);
    if (arr.length < MAX_ACTIONS) arr.push(item);
  };

  const extractCodeBlocks = (text, commands, file_ops) => {
    const re = /```([\w-]+)?[ \t]*([^\n]*)\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const lang = (m[1] || "").toLowerCase();
      const header = m[2].trim();
      const code = m[3].replace(/\n$/, "");
      if (!code.trim()) continue;
      if (COMMAND_LANGS.has(lang)) {
        addAction(commands, { text: code, lang });
      } else if (lang) {
        let path = null;
        const t = header.match(/title=["']([^"']+)["']/i) ||
                  header.match(/^([\w./\\-]+\.[\w]+)\s*$/);
        if (t) path = t[1];
        addAction(file_ops, { path, code, lang });
      } else if (header && /^[\w./\\-]+\.[\w]+$/.test(header)) {
        // bare path in the fence header: ``` src/app.tsx
        addAction(file_ops, { path: header, code, lang: null });
      }
    }
  };

  // Direct <pre>/<code> extraction — the most reliable signal on real chat
  // UIs: code blocks are rendered as <pre> regardless of how the message text
  // is stored, so this works even when whitespace is collapsed or the fence
  // markers are lost.
  const langFromEl = (pre) => {
    const cls = (pre.className || "") + " " + (pre.dataset ? pre.dataset.language || "" : "");
    const m = cls.match(/language-([\w-]+)|lang-([\w-]+)/);
    return (m && (m[1] || m[2])) ? (m[1] || m[2]).toLowerCase() : "";
  };
  const extractPreBlocks = (node, commands, file_ops) => {
    if (!node.querySelectorAll) return;
    const pres = node.querySelectorAll("pre");
    for (const pre of pres) {
      const code = (pre.innerText || pre.textContent || "").replace(/\n$/, "");
      if (!code.trim()) continue;
      const lang = langFromEl(pre);
      if (COMMAND_LANGS.has(lang)) {
        addAction(commands, { text: code, lang });
      } else {
        let path = null;
        const t = pre.getAttribute &&
          (pre.getAttribute("title") || (pre.dataset && pre.dataset.path));
        if (t) path = t;
        if (!path && pre.previousElementSibling) {
          const sibText = (pre.previousElementSibling.textContent || "").trim();
          if (/^[\w./\\-]+\.[\w]+$/.test(sibText)) path = sibText;
        }
        addAction(file_ops, { path, code, lang: lang || null });
      }
    }
  };

  // Multi-signal rate-limit detection (passive, runs inside the scan poll).
  // Requires >= 2 signals for high confidence (review §"Rate Limit Detection").
  const detectRateLimit = () => {
    const signals = [];
    const pageText = (document.body ? document.body.innerText : "").toLowerCase();
    if (RATE_LIMIT_HINTS.some((h) => pageText.includes(h.toLowerCase()))) {
      signals.push("text");
    }
    const inputs = document.querySelectorAll(
      "textarea, input[type='text'], [contenteditable='true']"
    );
    if (inputs.length > 0 && Array.from(inputs).every((i) => i.disabled)) {
      signals.push("input_disabled");
    }
    const sendButtons = Array.from(document.querySelectorAll("button")).filter((b) => {
      const label = ((b.innerText || "") + " " + (b.getAttribute && b.getAttribute("aria-label") || "")).toLowerCase();
      return /send|submit|发送|提问/.test(label);
    });
    if (sendButtons.length > 0 && sendButtons.every((b) => b.disabled)) {
      signals.push("send_disabled");
    }
    const toastText = Array.from(
      document.querySelectorAll("[role='alert'], [role='status'], .toast, .banner, [data-testid*='error']")
    )
      .map((t) => t.innerText || "")
      .join(" ")
      .toLowerCase();
    if (toastText && RATE_LIMIT_HINTS.some((h) => toastText.includes(h.toLowerCase()))) {
      signals.push("toast");
    }
    return { triggered: signals.length >= 2, signals };
  };

  // Called by the host (Rust eval_with_callback) on every poll. Walks the
  // current DOM fresh — no MutationObserver, no stale state — and returns the
  // newest extraction plus diagnostics.
  const scan = () => {
    const diag = { selectors: {}, nodes: 0, pres: 0, generic_used: false, error: null };
    let nodes = collectAny(assistantSelectors());
    diag.selectors.assistant = nodes.length;
    if (!nodes.length) {
      nodes = collect(GENERIC_SELECTORS);
      diag.generic_used = true;
      diag.selectors.generic = nodes.length;
    }
    diag.nodes = nodes.length;
    diag.pres = document.querySelectorAll("pre").length;

    const commands = [];
    const file_ops = [];
    const msgTexts = [];
    seenCodes.clear();
    let rate_limited = false;
    let last_message = "";
    for (const n of nodes) {
      const text = (n.textContent || "").trim();
      if (text.length < MIN_MSG_LEN) continue;
      msgTexts.push(text);
      last_message = text.slice(0, MAX_MSG_LEN);
      try {
        extractCodeBlocks(text, commands, file_ops);
        extractPreBlocks(n, commands, file_ops);
      } catch (e) {
        diag.error = String(e);
      }
    }

    // Rolling conversation buffer (dedupe consecutive repeats).
    for (const text of msgTexts) {
      const last = state.recent[state.recent.length - 1];
      if (last && last.text === text) continue;
      state.recent.push({ text: text.slice(0, MAX_MSG_LEN) });
      if (state.recent.length > MAX_RECENT) state.recent.shift();
    }

    const rl = detectRateLimit();

    state.commands = commands;
    state.file_ops = file_ops;
    state.messages_seen = msgTexts.length;
    state.rate_limited = rl.triggered;
    state.rate_limit_signals = rl.signals;
    state.last_message = last_message;
    state.scanned_at = Date.now();
    state.diag = diag;
    return state;
  };
  window.__relay_scan_dom = scan;

  // ---- input fill: used by injection AND "send project context / file" ----
  window.__relay_fill = (text) => {
    if (!text) return false;
    const sels = inputSelectors();
    const tryFill = (input) => {
      const proto = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLDivElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      const setter = desc && desc.set;
      if (setter) setter.call(input, text);
      else input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
      try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) {}
      banner("Relay context loaded — review, then press Enter to send", false);
      return true;
    };
    for (const sel of sels) {
      const input = document.querySelector(sel);
      if (input) return tryFill(input);
    }
    // Fall back to the first editable on the page, then retry briefly.
    const anyInput = document.querySelector("textarea, [contenteditable='true']");
    if (anyInput) return tryFill(anyInput);
    let tries = 0;
    const wait = setInterval(() => {
      const el = document.querySelector(sels.join(",")) ||
        document.querySelector("textarea, [contenteditable='true']");
      if (el) {
        clearInterval(wait);
        tryFill(el);
      } else if (++tries > 25) {
        clearInterval(wait);
        banner("Could not find the input field — context copied, paste with Ctrl+V", true);
      }
    }, 400);
    return true;
  };

  // ---- assisted handoff injection ----
  if (INJECT && INJECT.prompt) {
    setTimeout(() => window.__relay_fill(INJECT.prompt), 500);
  }

  window.__RELAY_BRIDGE__ = {
    provider,
    assisted: true, // never auto-sends / never auto-writes; every action is user-confirmed
  };
})();
