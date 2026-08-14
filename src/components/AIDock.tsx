import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readFile, writeFile } from "../lib/fs";
import { PROVIDERS, STATUS_GLYPH } from "../relay/providers";
import { useRelayStore } from "../relay/store";
import type { ProviderId } from "../relay/types";

interface ScanCommand {
  text: string;
  lang: string;
}
interface ScanFileOp {
  path: string | null;
  code: string;
  lang: string | null;
}
interface ScanDiag {
  selectors?: Record<string, number>;
  nodes?: number;
  pres?: number;
  generic_used?: boolean;
  error?: string | null;
}
interface ScanResult {
  provider?: string;
  scanned?: boolean;
  scan_version?: number;
  scanned_at?: number;
  messages_seen?: number;
  commands?: ScanCommand[];
  file_ops?: ScanFileOp[];
  rate_limited?: boolean;
  last_message?: string;
  preload_missing?: boolean;
  /** Set by the fallback payload when the preload isn't visible from eval. */
  pres?: number;
  diag?: ScanDiag;
}

// Commands that warrant an extra warning (Complete Docs §8.4).
const DESTRUCTIVE_RE =
  /^(rm|rmdir|del|rd|format|mkfs|dd|shutdown|reboot|sudo|doas|pkexec|:\\(\\)|curl [^|]*\\| (ba)?sh)\\b/i;

const isAbsolutePath = (p: string) =>
  /^[A-Za-z]:[\\\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\\\");
const joinPath = (root: string | null, rel: string) =>
  root
    ? `${root.replace(/[\\\\/]+$/, "")}\\\\${rel.replace(/^[\\\\/]+/, "")}`
    : rel;

const inTauri = () =>
  !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  rs: "rust",
  py: "python",
  go: "go",
  md: "markdown",
  html: "html",
  css: "css",
};
const diffLang = (lang: string | null, rel: string): string => {
  if (lang && LANG_BY_EXT[lang]) return LANG_BY_EXT[lang];
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  return LANG_BY_EXT[ext] ?? "plaintext";
};

// File paths the AI mentions in its latest message (e.g. "look at src/App.tsx"),
// offered as one-click reads into the provider's input.
const FILE_REF_RE =
  /[\w./\\-]+\\.(?:tsx?|jsx?|json|rs|py|md|css|html|toml|ya?ml|sh|env|txt)\\b/g;

export default function AIDock() {
  const session = useRelayStore((s) => s.session);
  const refreshSession = useRelayStore((s) => s.refreshSession);
  const runHandoff = useRelayStore((s) => s.runHandoff);
  const lastPacket = useRelayStore((s) => s.lastPacket);
  const busy = useRelayStore((s) => s.busy);
  const projectPath = useRelayStore((s) => s.projectPath);
  const openFiles = useRelayStore((s) => s.openFiles);
  const bumpTree = useRelayStore((s) => s.bumpTree);
  const setActiveProvider = useRelayStore((s) => s.setActiveProvider);
  const requestedProvider = useRelayStore((s) => s.requestedProvider);
  const clearRequestedProvider = useRelayStore((s) => s.clearRequestedProvider);

  const [active, setActive] = useState<ProviderId | null>(null);
  const [activating, setActivating] = useState(false);
  const [dockError, setDockError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [diffTarget, setDiffTarget] = useState<{
    full: string;
    rel: string;
    code: string;
    original: string;
    lang: string | null;
  } | null>(null);
  const [diffApplying, setDiffApplying] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | null>(null);
  // Browser preview has no Tauri backend: everything below would fail with
  // opaque errors, so surface one clear banner instead (mirrors the terminal).
  const [browserMode] = useState(() => !inTauri());

  useEffect(() => {
    refreshSession().catch(() => {});
    if (browserMode) return; // no Tauri event bus in a plain browser
    const unlisteners: UnlistenFn[] = [];
    listen<[string, string, string]>("relay://dock-load", (e) => {
      const [prov, evt] = e.payload;
      if (evt === "failed") {
        showToast(`${prov} failed to load — check the network or try another provider`);
      }
    }).then((u) => unlisteners.push(u));
    return () => unlisteners.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSession, browserMode]);

  const statusFor = (id: string) =>
    session?.providers.find((p) => p.id === id)?.status ?? "not_authenticated";

  const areaBounds = () => {
    const el = areaRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  };

  // Keep the native webview glued to the dock area across resizes/layout.
  const reportBounds = useCallback(() => {
    if (!active) return;
    const b = areaBounds();
    if (b) invoke("dock_set_bounds", { provider: active, ...b }).catch(() => {});
  }, [active]);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => reportBounds());
    ro.observe(el);
    window.addEventListener("resize", reportBounds);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", reportBounds);
    };
  }, [reportBounds]);

  // Poll the provider page for AI output signals (code blocks, commands,
  // rate-limit, file references) every 2.5s while a provider is active.
  useEffect(() => {
    if (!active || dockError || browserMode) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await invoke<ScanResult>("dock_scan", { provider: active });
        if (!cancelled) setScan(res);
      } catch {
        /* transient — retry on next tick */
      }
    };
    poll();
    const t = window.setInterval(poll, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [active, dockError, browserMode]);

  const activate = async (id: ProviderId) => {
    setActive(id);
    setActiveProvider(id);
    if (browserMode) return; // banner explains why nothing embeds here
    const b = areaBounds();
    if (!b) return;
    setActivating(true);
    setDockError(null);
    setScan(null);
    try {
      await invoke("dock_activate", { provider: id, ...b });
      await refreshSession();
    } catch (e) {
      setDockError(String(e));
    } finally {
      setActivating(false);
    }
  };

  // Status bar / palette requested a provider switch → activate that tab.
  useEffect(() => {
    if (requestedProvider && requestedProvider !== active) {
      activate(requestedProvider);
    }
    clearRequestedProvider();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedProvider]);

  const relay = async () => {
    if (!active) return;
    if (browserMode) {
      showToast("Handoff needs the Relay desktop app — this preview has no backend");
      return;
    }
    const b = areaBounds();
    if (!b) return;
    const ok = window.confirm(
      "Relay the session context to the next model? Its input field will be " +
        "pre-filled — you review it before sending (assisted handoff, " +
        "Complete Docs §8.5)."
    );
    if (!ok) return;

    const packet = await runHandoff();
    if (!packet) {
      showToast("Handoff failed — no packet generated");
      return;
    }
    showToast(`Handoff: ${packet.source_model} → ${packet.target_model}`);
    try {
      await invoke("dock_inject", { provider: packet.target_model, packet, ...b });
      setActive(packet.target_model as ProviderId);
      setActiveProvider(packet.target_model as ProviderId);
      await refreshSession();
    } catch (e) {
      setDockError(String(e));
    }
  };

  // ---- AI capabilities (all user-confirmed) ----

  const runCommand = async (cmd: string) => {
    if (browserMode) {
      showToast("Running commands needs the Relay desktop app");
      return;
    }
    const trimmed = cmd.trim();
    const destructive = DESTRUCTIVE_RE.test(trimmed);
    const ok = destructive
      ? window.confirm(
          `⚠️ "${trimmed.split("\n")[0]}" looks destructive.\n\nRun it in the terminal anyway?`
        )
      : window.confirm(`Run "${trimmed.split("\n")[0]}" in the terminal?`);
    if (!ok) return;
    try {
      await invoke("run_command", { command: cmd });
      showToast(`Running: ${trimmed.split("\n")[0]}`);
    } catch (e) {
      showToast(String(e));
    }
  };

  // Diff preview before applying an AI write (Complete Docs §8.4 mandates a
  // review step) — replaced the old confirm dialog.
  const applyFileOp = async (op: ScanFileOp) => {
    let rel = op.path;
    if (!rel) {
      rel = window.prompt("Target file (relative to project root):", "");
      if (!rel) return;
    }
    const full = isAbsolutePath(rel) ? rel : joinPath(projectPath, rel);
    let original = "";
    try {
      original = await readFile(full);
    } catch {
      original = ""; // new file
    }
    setDiffTarget({ full, rel, code: op.code, original, lang: op.lang });
  };

  const confirmDiff = async () => {
    if (!diffTarget) return;
    setDiffApplying(true);
    try {
      await writeFile(diffTarget.full, diffTarget.code);
      bumpTree();
      const lines = diffTarget.code.split("\n").length;
      showToast(`Applied ${lines} lines to ${diffTarget.full}`);
      setDiffTarget(null);
    } catch (e) {
      showToast(String(e));
    } finally {
      setDiffApplying(false);
    }
  };

  // File paths mentioned in the AI's latest message → one-click [📖 Read]
  // buttons that read the file and send it into the provider's input.
  const readRequests = useMemo(() => {
    if (!scan?.last_message || !projectPath) return [];
    const found: string[] = [];
    const seen = new Set<string>();
    const re = new RegExp(FILE_REF_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(scan.last_message)) !== null && found.length < 3) {
      const p = m[0];
      if (/^\d/.test(p) || seen.has(p)) continue;
      seen.add(p);
      found.push(p);
    }
    return found;
  }, [scan, projectPath]);

  const readFileForAI = async (rel: string) => {
    if (!active || browserMode) {
      showToast("Reading for the AI needs the Relay desktop app and an active provider");
      return;
    }
    const full = isAbsolutePath(rel) ? rel : joinPath(projectPath, rel);
    try {
      const content = await readFile(full);
      const ext = rel.split(".").pop() ?? "";
      const text = [
        `## FILE: ${rel}`,
        `\`\`\`${ext}`,
        content,
        "```",
        "",
        "Read the file above. Tell me what you'd change or write next.",
      ].join("\n");
      await invoke("dock_context", { provider: active, text });
      showToast(`Sent ${rel} to ${active}'s input — review and send`);
    } catch (e) {
      showToast(String(e));
    }
  };

  const sendContext = async () => {
    if (!active) {
      showToast("Activate a provider first");
      return;
    }
    if (browserMode) {
      showToast("Sending context needs the Relay desktop app");
      return;
    }
    if (!projectPath) {
      showToast("Open a project first");
      return;
    }
    try {
      const tree = await invoke<string>("tree_summary", {
        root: projectPath,
        maxDepth: 3,
      });
      const files = openFiles
        .map((f) => `### ${f.path}\n${f.content.slice(0, 4000)}`)
        .join("\n\n");
      const text = [
        "## PROJECT CONTEXT (for this coding session)",
        `Project root: ${projectPath}`,
        "",
        "### File tree:",
        tree,
        files ? `### Open files:\n${files}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      await invoke("dock_context", { provider: active, text });
      showToast(`Project context sent to ${active}'s input — review and send`);
    } catch (e) {
      showToast(String(e));
    }
  };

  const statusText = () => {
    if (browserMode) return null;
    if (activating) return `Loading ${active}…`;
    if (dockError) return null;
    const msgs = scan?.messages_seen ?? 0;
    if (scan?.preload_missing) {
      return `scan: preload not visible — ${scan.pres ?? 0} <pre> found on page`;
    }
    const d = scan?.diag;
    if (d?.error) return `scan error: ${d.error}`;
    if (d && (d.nodes ?? 0) > 0) {
      const where = d.generic_used ? "generic fallback" : "provider selector";
      return `scan ok (${where}): ${d.nodes} node(s), ${d.pres} <pre>, ${msgs} message(s)`;
    }
    if (scan?.scanned === false) return null;
    return null;
  };

  const hasActions =
    scan &&
    !browserMode &&
    (scan.rate_limited ||
      (scan.commands && scan.commands.length > 0) ||
      (scan.file_ops && scan.file_ops.length > 0));

  return (
    <aside className="panel aidock">
      <div className="panel-title">
        <span>AI Dock</span>
        <span className="hint-sub">embedded webviews (F1)</span>
      </div>

      <div className="dock-tabs">
        {PROVIDERS.map((p) => {
          const status = statusFor(p.id);
          const isActive = active === p.id;
          return (
            <button
              key={p.id}
              className={`dock-tab ${isActive ? "active" : ""}`}
              onClick={() => activate(p.id)}
              title={p.url}
            >
              <span className="provider-glyph">{STATUS_GLYPH[status]}</span>
              <span className="dock-tab-name">{p.name}</span>
              <span className="provider-status">{status.replace("_", " ")}</span>
            </button>
          );
        })}
      </div>

      <div className="dock-webview" ref={areaRef}>
        {browserMode && (
          <div className="empty-hint">
            <p>⚠️ Browser preview has no backend.</p>
            <p className="hint-sub">
              The embedded provider webviews, file reads/writes, and the PTY
              terminal run in Rust. Launch <code>relay.exe</code> or run{" "}
              <code>npm run tauri dev</code> to use the AI capabilities.
            </p>
          </div>
        )}
        {!browserMode && !active && (
          <div className="empty-hint">
            <p>Pick a provider tab to load its web interface here.</p>
            <p className="hint-sub">
              Log in once — cookies persist across restarts. Provider pages
              have no access to your machine (Complete Docs §8.1). If a
              provider changes its DOM, patch selectors in{" "}
              <code>~/.relay/selectors.json</code> (no rebuild needed).
            </p>
          </div>
        )}
        {dockError && (
          <div className="dock-error">
            <p>Could not embed this provider: {dockError}</p>
            <button
              className="primary-btn"
              onClick={() =>
                active &&
                invoke("provider_open_window", { provider: active }).catch((e) =>
                  showToast(String(e))
                )
              }
            >
              Open in separate window
            </button>
          </div>
        )}
      </div>

      <div className="dock-status">
        {statusText() ? (
          <span className="hint-sub">{statusText()}</span>
        ) : (
          <span className="hint-sub">
            AI actions appear here: code blocks become Apply/Run buttons you
            confirm (PRD §6.4-6.6).
          </span>
        )}
      </div>

      {readRequests.length > 0 && (
        <div className="dock-actions">
          <div className="action-row read-row">
            <span className="action-label">AI wants to read:</span>
            {readRequests.map((p) => (
              <button
                key={p}
                className="ghost-btn"
                onClick={() => readFileForAI(p)}
                title={`Read ${p} and send its contents to ${active}`}
              >
                📖 {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasActions && (
        <div className="dock-actions">
          {scan!.rate_limited && (
            <div className="rate-limit-banner">
              <span>🔴 {active} looks rate-limited</span>
              <button className="ghost-btn" onClick={relay} disabled={busy}>
                Relay to next model
              </button>
            </div>
          )}
          {scan!.commands?.map((c, i) => (
            <div key={`c${i}`} className="action-row">
              <code className="action-code" title={c.text}>
                $ {c.text.split("\n")[0]}
              </code>
              <button className="ghost-btn" onClick={() => runCommand(c.text)}>
                ▶ Run
              </button>
              <button
                className="ghost-btn"
                onClick={() => navigator.clipboard.writeText(c.text)}
              >
                📋
              </button>
            </div>
          ))}
          {scan!.file_ops?.map((op, i) => (
            <div key={`f${i}`} className="action-row">
              <code className="action-code" title={op.code}>
                {op.path ?? "pick path"} · {op.code.split("\n").length} lines
              </code>
              <button className="ghost-btn" onClick={() => applyFileOp(op)}>
                💾 Apply
              </button>
              <button
                className="ghost-btn"
                onClick={() => navigator.clipboard.writeText(op.code)}
              >
                📋
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="handoff-box">
        <button
          className="primary-btn handoff-btn"
          onClick={relay}
          disabled={busy || !active || !!dockError || browserMode}
        >
          {busy ? "Relaying…" : "🔄 Relay to next model"}
        </button>
        <button
          className="ghost-btn handoff-btn"
          onClick={sendContext}
          disabled={!active || !!dockError || !projectPath || browserMode}
        >
          📋 Send project context to {active ?? "model"}
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {lastPacket && (
        <div className="packet-inspector">
          <div className="panel-title">
            <span>Relay Packet</span>
            <button
              className="ghost-btn"
              onClick={() =>
                navigator.clipboard.writeText(JSON.stringify(lastPacket, null, 2))
              }
            >
              Copy
            </button>
          </div>
          <pre className="packet-json">{JSON.stringify(lastPacket, null, 2)}</pre>
        </div>
      )}

      {diffTarget && (
        <div className="diff-overlay" onMouseDown={() => setDiffTarget(null)}>
          <div className="diff-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="diff-head">
              <div>
                <strong>Review change</strong>
                <span className="hint-sub">
                  {" "}
                  {diffTarget.rel} · {diffTarget.code.split("\n").length} lines (
                  {diffTarget.original ? "modified" : "new file"})
                </span>
              </div>
              <button className="ghost-btn" onClick={() => setDiffTarget(null)}>
                ✕
              </button>
            </div>
            <div className="diff-body">
              <DiffEditor
                original={diffTarget.original}
                modified={diffTarget.code}
                theme="vs-dark"
                language={diffLang(diffTarget.lang, diffTarget.rel)}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  automaticLayout: true,
                  fontSize: 12,
                }}
              />
            </div>
            <div className="diff-actions">
              <button
                className="ghost-btn"
                onClick={() => setDiffTarget(null)}
              >
                Cancel
              </button>
              <button
                className="primary-btn"
                onClick={confirmDiff}
                disabled={diffApplying}
              >
                {diffApplying ? "Applying…" : "Apply change"}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
