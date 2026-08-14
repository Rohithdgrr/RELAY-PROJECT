import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PROVIDERS, STATUS_GLYPH } from "../relay/providers";
import { useRelayStore } from "../relay/store";

export default function AIDock() {
  const session = useRelayStore((s) => s.session);
  const refreshSession = useRelayStore((s) => s.refreshSession);
  const runHandoff = useRelayStore((s) => s.runHandoff);
  const lastPacket = useRelayStore((s) => s.lastPacket);
  const busy = useRelayStore((s) => s.busy);

  useEffect(() => {
    refreshSession().catch(() => {});
  }, [refreshSession]);

  const statusFor = (id: string) =>
    session?.providers.find((p) => p.id === id)?.status ?? "not_authenticated";

  return (
    <aside className="panel aidock">
      <div className="panel-title">
        <span>AI Dock</span>
        <span className="hint-sub">webviews load your existing logins (F1)</span>
      </div>

      <div className="provider-list">
        {PROVIDERS.map((p) => {
          const status = statusFor(p.id);
          const isActive = session?.active_provider === p.id;
          return (
            <div
              key={p.id}
              className={`provider-tab ${isActive ? "active" : ""}`}
              style={{ borderLeftColor: p.color }}
            >
              <span className="provider-glyph">{STATUS_GLYPH[status]}</span>
              <div className="provider-body">
                <div className="provider-name">{p.name}</div>
                <div className="provider-status">{status.replace("_", " ")}</div>
              </div>
              <button
                className="ghost-btn"
                onClick={() => invoke("open_provider", { providerId: p.id }).catch((e) => alert(e))}
              >
                Open
              </button>
            </div>
          );
        })}
      </div>

      <div className="handoff-box">
        <button className="primary-btn handoff-btn" onClick={() => runHandoff()} disabled={busy}>
          {busy ? "Relaying…" : "🔄 Relay to next model"}
        </button>
        <p className="hint-sub">
          Manual handoff (trigger 3, PRD §6.2). Auto-handoff requires the
          multi-signal detector, wired in Phase 1 (Complete Docs §7.1).
        </p>
      </div>

      {lastPacket && (
        <div className="packet-inspector">
          <div className="panel-title">
            <span>Relay Packet</span>
            <button
              className="ghost-btn"
              onClick={() => navigator.clipboard.writeText(JSON.stringify(lastPacket, null, 2))}
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
