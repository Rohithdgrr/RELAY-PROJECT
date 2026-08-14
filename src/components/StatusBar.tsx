import { useRelayStore } from "../relay/store";

export default function StatusBar() {
  const session = useRelayStore((s) => s.session);
  const projectPath = useRelayStore((s) => s.projectPath);

  const handoffs = session?.handoffs.length ?? 0;
  const lastHandoff = session?.handoffs[session.handoffs.length - 1];

  return (
    <footer className="status-bar">
      <span className="status-item">
        session <code>{session?.id.slice(0, 8) ?? "—"}</code>
      </span>
      <span className="status-item">
        {projectPath ? projectPath : "no project"}
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
        assisted-only automation · no API keys · data flows only to providers you connect (Complete Docs §8.3)
      </span>
    </footer>
  );
}
