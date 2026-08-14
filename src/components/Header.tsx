import { useRelayStore } from "../relay/store";
import { PROVIDERS, STATUS_GLYPH } from "../relay/providers";

export default function Header() {
  const session = useRelayStore((s) => s.session);
  const active = session?.active_provider ?? null;
  const meta = PROVIDERS.find((p) => p.id === active);
  const status = session?.providers.find((p) => p.id === active)?.status;

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark">⚡</span>
        <span className="brand-name">Relay</span>
        <span className="brand-tag">multi-model vibe coding</span>
      </div>
      {active && meta && (
        <div className="active-chip" style={{ borderColor: meta.color }}>
          <span className="chip-glyph">{status ? STATUS_GLYPH[status] : "⚪"}</span>
          <span className="chip-name">{meta.name}</span>
          <span className="chip-model">{active}</span>
        </div>
      )}
    </header>
  );
}
