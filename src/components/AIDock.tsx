import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { PROVIDERS, STATUS_GLYPH } from "../relay/providers";
import { useRelayStore } from "../relay/store";
import type { ProviderId } from "../relay/types";

export default function AIDock() {
  const session = useRelayStore((s) => s.session);
  const refreshSession = useRelayStore((s) => s.refreshSession);
  const runHandoff = useRelayStore((s) => s.runHandoff);
  const lastPacket = useRelayStore((s) => s.lastPacket);
  const busy = useRelayStore((s) => s.busy);

  const [active, setActive] = useState<ProviderId | null>(null);
  const [activating, setActivating] = useState(false);
  const [dockError, setDockError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    refreshSession().catch(() => {});
    const unlisteners: UnlistenFn[] = [];
    // Page-load diagnostics from the embedded webviews.
    listen<[string, string, string]>("relay://dock-load", (e) => {
      const [prov, evt, url] = e.payload;
      setLoadState((s) => ({ ...s, [prov]: evt }));
      if (evt === "failed") {
        showToast(`${prov} failed to load (${url}) — check the network or try another provider`);
      }
    }).then((u) => unlisteners.push(u));
    return () => unlisteners.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSession]);

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

  const activate = async (id: ProviderId) => {
    const b = areaBounds();
    if (!b) return;
    setActive(id);
    setActivating(true);
    setDockError(null);
    setLoadState((s) => ({ ...s, [id]: "started" }));
    try {
      await invoke("dock_activate", { provider: id, ...b });
      await refreshSession();
    } catch (e) {
      setDockError(String(e));
    } finally {
      setActivating(false);
    }
  };

  const relay = async () => {
    if (!active) return;
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
      await refreshSession();
    } catch (e) {
      setDockError(String(e));
    }
  };

  const statusText = () => {
    if (activating) return `Loading ${active}…`;
    if (dockError) return null;
    const state = active ? loadState[active] : undefined;
    if (state === "finished") return `${active} loaded`;
    if (state === "failed") return `${active} failed to load`;
    return null;
  };

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
        {!active && (
          <div className="empty-hint">
            <p>Pick a provider tab to load its web interface here.</p>
            <p className="hint-sub">
              Log in once — cookies persist across restarts. Provider pages
              have no access to your machine (Complete Docs §8.1).
            </p>
          </div>
        )}
        {dockError && (
          <div className="dock-error">
            <p>Could not embed this provider: {dockError}</p>
            <button
              className="primary-btn"
              onClick={() =>
                active && invoke("provider_open_window", { provider: active }).catch((e) => showToast(String(e)))
              }
            >
              Open in separate window
            </button>
          </div>
        )}
      </div>

      <div className="dock-status">
        {statusText() ?? (
          <span className="hint-sub">
            Assisted handoff (PRD §6.2): context is pre-filled into the next
            model's input for your review.
          </span>
        )}
      </div>

      <div className="handoff-box">
        <button
          className="primary-btn handoff-btn"
          onClick={relay}
          disabled={busy || !active || !!dockError}
        >
          {busy ? "Relaying…" : "🔄 Relay to next model"}
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
    </aside>
  );
}
