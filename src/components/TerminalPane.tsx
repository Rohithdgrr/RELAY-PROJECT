import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "xterm/css/xterm.css";

interface TerminalOutput {
  id: number;
  data: string;
}

export default function TerminalPane() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const idRef = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: { background: "#0A0A0F", foreground: "#E2E2EA" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current!);
    fit.fit();
    termRef.current = term;

    const unlisten = listen<TerminalOutput>("terminal://output", (event) => {
      term.write(event.payload.data);
    });

    term.onData((data) => {
      if (idRef.current != null) {
        invoke("write_stdin", { id: idRef.current, data }).catch(() => {});
      }
    });

    // Spawn the shell at the project root (falls back to $SHELL default cwd).
    invoke<number>("spawn_terminal", { cwd: null })
      .then((id) => {
        if (disposed) return;
        idRef.current = id;
      })
      .catch((e) => term.write(`\r\n\x1b[31mPTY error: ${e}\x1b[0m\r\n`));

    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);
    const t = window.setInterval(() => fit.fit(), 500);

    return () => {
      disposed = true;
      window.clearInterval(t);
      window.removeEventListener("resize", onResize);
      unlisten.then((u) => u());
      term.dispose();
    };
  }, []);

  return (
    <section className="panel terminal-pane">
      <div className="panel-title">
        <span>Terminal</span>
        <span className="hint-sub">commands require your confirmation (PRD §11)</span>
      </div>
      <div ref={containerRef} className="terminal-container" />
    </section>
  );
}
