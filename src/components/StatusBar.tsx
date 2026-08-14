import { useEffect, useState } from "react";
import { gitBranch } from "../lib/fs";
import { useRelayStore } from "../relay/store";
import type { ProviderId } from "../relay/types";
import { STATUS_GLYPH } from "../relay/providers";

export default function StatusBar() {
  const session = useRelayStore((s) => s.session);
  const projectPath = useRelayStore((s) => s.projectPath);
  const terminalAlive = useRelayStore((s) => s.terminalAlive);
  const requestProvider = useRelayStore((s) => s.requestProvider);
  const [branch, setBranch] = useState("");

  useEffect(() => {
    if (!projectPath) {
      setBranch("");
      return;
    }
    let cancelled = false;
    gitBranch(projectPath)
      .then((b) => {
        if (!cancelled) setBranch(b);
      })
      .catch(() => {
        if (!cancelled) setBranch("");
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const handoffs = session?.handoffs.length ?? 0;
  const lastHandoff = session?.handoffs[session.handoffs.length - 1];
  const providers = session?.providers ?? [];

  return (
    <footer className="status-bar">
      <span className="status-item">
        session <code>{session?.id.slice(0, 8) ?? "—"}</code>
      </span>
      <span className="status-item" title={projectPath ?? ""}>
        {projectPath ? projectPath : "no project"}
        {branch && <span className="branch-chip">⎇ {branch}</span>}
      </span>
      <span className="status-item status-providers">
        {providers.map((p) => (
          <button
            key={p.id}
            className="provider-chip"
            title={`Switch to ${p.id} in the AI dock`}
            onClick={() => requestProvider(p.id as ProviderId)}
          >
            {STATUS_GLYPH[p.status] ?? "⚪"} {p.id}
          </button>
        ))}
      </span>
      <span className="status-item">
        term: <strong>{terminalAlive ? "● ready" : "○ none"}</strong>
      </span>
      <span className="status-item">
        handoffs: <strong>{handoffs}</strong>
        {lastHandoff && (
          <span className="hint-sub">
            {" "}
            last: {lastHandoff.from} → {lastHandoff.to}
          </span>
        )}
      </span>
      <span className="status-item status-right hint-sub">
        assisted-only automation · no API keys · data flows only to providers you
        connect (Complete Docs §8.3)
      </span>
    </footer>
  );
}
