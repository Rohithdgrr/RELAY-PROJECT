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
  const [browserMode, setBrowserMode] = useState(false);
  const [lineWrap, setLineWrap] = useState(true);
  const terminalFocus = useRelayStore((s) => s.terminalFocus);
  const setTerminalAlive = useRelayStore((s) => s.setTerminalAlive);

  // Spawn the shell at the project root (or the app default when none is set).
  const spawn = async (term: Terminal) => {
    const cwd = useRelayStore.getState().projectPath;
    try {
      const id = await invoke<number>("spawn_terminal", { cwd });
      idRef.current = id;
      setExited(false);
      setTerminalAlive(true);
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
      setTerminalAlive(false);
    }
  };

  useEffect(() => {
    // Browser preview has no Tauri backend — show a friendly note instead
    // of a dead xterm pane with raw invoke errors in it.
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      setBrowserMode(true);
      return;
    }
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
      if (event.payload.id === idRef.current) {
        setExited(true);
        setTerminalAlive(false);
      }
    }).then((u) => unlisteners.push(u));

    spawn(term);

    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      setTerminalAlive(false);
      window.removeEventListener("resize", onResize);
      unlisteners.forEach((u) => u());
      // Clean up the PTY (kills the shell) so nothing leaks across remounts.
      if (idRef.current != null) {
        invoke("kill_terminal", { id: idRef.current }).catch(() => {});
      }
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track shell liveness for the status bar; keep the PTY state truthful.
  useEffect(() => {
    if (browserMode) return;
    if (idRef.current != null) setTerminalAlive(!exited);
  }, [exited, browserMode, setTerminalAlive]);

  // Focus requested from the status bar / palette (Ctrl+`).
  useEffect(() => {
    if (terminalFocus > 0) termRef.current?.focus();
  }, [terminalFocus]);

  const pasteClipboard = async () => {
    if (browserMode || idRef.current == null) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        await invoke("write_stdin", { id: idRef.current, data: text }).catch(() => {});
      }
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const toggleWrap = () => {
    setLineWrap((prev) => {
      const next = !prev;
      if (termRef.current) {
        (termRef.current.options as { lineWrap?: boolean }).lineWrap = next;
      }
      return next;
    });
  };

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
        <div className="title-actions">
          {!browserMode && (
            <>
              <button className="ghost-btn" title="Line wrap" onClick={toggleWrap}>
                {lineWrap ? "⤶ wrap" : "⤹ nowrap"}
              </button>
              <button
                className="ghost-btn"
                title="Clear viewport"
                onClick={() => termRef.current?.clear()}
              >
                🧹
              </button>
            </>
          )}
          {exited ? (
            <button className="ghost-btn" onClick={restart}>
              ↻ Restart shell
            </button>
          ) : (
            !browserMode && (
              <span className="hint-sub">
                right-click paste · commands need your confirmation (PRD §11)
              </span>
            )
          )}
        </div>
      </div>
      {browserMode ? (
        <div className="terminal-browser-note">
          Browser preview: the terminal needs the Relay desktop app (the
          PTY shell runs in Rust). Launch <code>relay.exe</code> or run{" "}
          <code>npm run tauri dev</code>.
        </div>
      ) : (
        <div
          ref={containerRef}
          className="terminal-container"
          onContextMenu={(e) => {
            e.preventDefault();
            pasteClipboard();
          }}
        />
      )}
    </section>
  );
}
