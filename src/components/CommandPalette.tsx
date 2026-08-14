import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRelayStore } from "../relay/store";
import type { ProviderId } from "../relay/types";
import { PROVIDERS } from "../relay/providers";

interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

// Subsequence fuzzy match: all query chars appear in the label in order.
function fuzzyScore(query: string, label: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const l = label.toLowerCase();
  let qi = 0;
  let score = 0;
  for (let i = 0; i < l.length && qi < q.length; i++) {
    if (l[i] === q[qi]) {
      score += 10 - i * 0.1;
      qi++;
    }
  }
  return qi === q.length ? score : null;
}

export default function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const activeFile = useRelayStore((s) => s.activeFile);
  const openProject = useRelayStore((s) => s.openProject);
  const requestProvider = useRelayStore((s) => s.requestProvider);
  const focusTerminal = useRelayStore((s) => s.focusTerminal);
  const closeFile = useRelayStore((s) => s.closeFile);
  const saveActiveFile = useRelayStore((s) => s.saveActiveFile);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const actions: PaletteAction[] = useMemo(() => {
    const list: PaletteAction[] = [
      {
        id: "open-project",
        label: "Open / switch project folder",
        hint: "pick a folder",
        run: () => openProject().catch(() => {}),
      },
      {
        id: "new-file",
        label: "New file…",
        hint: "Ctrl+N",
        run: () => window.dispatchEvent(new CustomEvent("relay://new-file")),
      },
      {
        id: "search",
        label: "Project search…",
        hint: "Ctrl+Shift+F",
        run: () => window.dispatchEvent(new CustomEvent("relay://open-search")),
      },
      {
        id: "focus-terminal",
        label: "Focus terminal",
        hint: "Ctrl+`",
        run: () => focusTerminal(),
      },
      {
        id: "close-tab",
        label: "Close current tab",
        hint: "Ctrl+W",
        run: () => activeFile && closeFile(activeFile),
      },
      {
        id: "save",
        label: "Save current file",
        hint: "Ctrl+S",
        run: () => saveActiveFile().catch(() => {}),
      },
      {
        id: "run-command",
        label: "Run command in terminal…",
        hint: "user-confirmed (PRD §11)",
        run: async () => {
          const cmd = window.prompt("Command to run:");
          if (!cmd) return;
          try {
            await invoke("run_command", { command: cmd });
          } catch (e) {
            window.alert(String(e));
          }
        },
      },
    ];
    // Switch provider — one action per provider.
    for (const p of PROVIDERS) {
      list.push({
        id: `provider-${p.id}`,
        label: `Switch provider → ${p.name}`,
        hint: "AI dock",
        run: () => requestProvider(p.id as ProviderId),
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile, openProject, requestProvider, focusTerminal, closeFile, saveActiveFile]);

  const filtered = useMemo(() => {
    const scored = actions
      .map((a) => ({ a, score: fuzzyScore(query, a.label) }))
      .filter((x): x is { a: PaletteAction; score: number } => x.score !== null)
      .sort((x, y) => y.score - x.score);
    return scored.slice(0, 12).map((x) => x.a);
  }, [actions, query]);

  const run = (action: PaletteAction) => {
    onClose();
    action.run();
  };

  if (!open) return null;

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command… (Esc to close)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered[0]) run(filtered[0]);
          }}
        />
        <div className="palette-list">
          {filtered.length === 0 && (
            <div className="palette-empty">No matching commands</div>
          )}
          {filtered.map((a, i) => (
            <button
              key={a.id}
              className={`palette-item ${i === 0 ? "selected" : ""}`}
              onClick={() => run(a)}
            >
              <span className="palette-label">{a.label}</span>
              {a.hint && <span className="palette-hint">{a.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
