import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useRelayStore } from "../relay/store";
import "xterm/css/xterm.css";

interface TerminalOutput {
  id: number;
  data: string;
}

interface TerminalExit {
  id: number;
}

export default function TerminalPane() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<number | null>(null);
  const [exited, setExited] = useState(false);

  // Spawn the shell at the project root (or the app default when none is set).
  const spawn = async (term: Terminal) => {
    const cwd = useRelayStore.getState().projectPath;
    try {
      const id = await invoke<number>("spawn_terminal", { cwd });
      idRef.current = id;
      setExited(false);
      // Push the current viewport size to the freshly spawned PTY (the
      // onResize hook may have fired before the spawn resolved).
      const dims = fitRef.current?.proposeDimensions();
      if (dims) {
        invoke("resize_terminal", {
          id,
          cols: dims.cols,
          rows: dims.rows,
        }).catch(() => {});
      }
    } catch (e) {
      term.write(`\r\n\x1b[31mPTY error: ${e}\x1b[0m\r\n`);
      setExited(true);
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: { background: "#0A0A0F", foreground: "#E2E2EA" },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    // Keep the PTY size in sync with the viewport (fires when fit.fit()
    // changes the terminal dimensions).
    term.onResize(({ cols, rows }) => {
      if (idRef.current != null) {
        invoke("resize_terminal", { id: idRef.current, cols, rows }).catch(
          () => {}
        );
      }
    });

    term.onData((data) => {
      if (idRef.current != null) {
        invoke("write_stdin", { id: idRef.current, data }).catch(() => {});
      }
    });

    listen<TerminalOutput>("terminal://output", (event) => {
      if (!disposed) term.write(event.payload.data);
    }).then((u) => unlisteners.push(u));

    listen<TerminalExit>("terminal://exit", (event) => {
      if (event.payload.id === idRef.current) setExited(true);
    }).then((u) => unlisteners.push(u));

    spawn(term);

    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      unlisteners.forEach((u) => u());
      // Clean up the PTY (kills the shell) so nothing leaks across remounts.
      if (idRef.current != null) {
        invoke("kill_terminal", { id: idRef.current }).catch(() => {});
      }
      term.dispose();
    };
  }, []);

  const restart = () => {
    if (idRef.current != null) {
      invoke("kill_terminal", { id: idRef.current }).catch(() => {});
    }
    idRef.current = null;
    termRef.current?.reset();
    if (termRef.current) spawn(termRef.current);
  };

  return (
    <section className="panel terminal-pane">
      <div className="panel-title">
        <span>Terminal</span>
        {exited ? (
          <button className="ghost-btn" onClick={restart}>
            ↻ Restart shell
          </button>
        ) : (
          <span className="hint-sub">
            commands require your confirmation (PRD §11)
          </span>
        )}
      </div>
      <div ref={containerRef} className="terminal-container" />
    </section>
  );
}
