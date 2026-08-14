import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useRelayStore } from "../relay/store";

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
  toml: "ini",
  yaml: "yaml",
  yml: "yaml",
};

// Works with both Windows (\) and POSIX (/) paths.
const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANG_BY_EXT[ext] ?? "plaintext";
}

export default function EditorPane() {
  const openFiles = useRelayStore((s) => s.openFiles);
  const activeFile = useRelayStore((s) => s.activeFile);
  const pendingLine = useRelayStore((s) => s.pendingLine);
  const updateActiveFile = useRelayStore((s) => s.updateActiveFile);
  const saveActiveFile = useRelayStore((s) => s.saveActiveFile);
  const closeFile = useRelayStore((s) => s.closeFile);
  const setActiveFile = useRelayStore((s) => s.setActiveFile);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const file = openFiles.find((f) => f.path === activeFile);

  // Reveal a search result line after the editor mounts / the target changes.
  useEffect(() => {
    if (pendingLine == null || !editorRef.current) return;
    editorRef.current.revealLineInCenter(pendingLine);
    editorRef.current.setPosition({ lineNumber: pendingLine, column: 1 });
    editorRef.current.focus();
    useRelayStore.setState({ pendingLine: null });
  }, [pendingLine, activeFile]);

  if (!file) {
    return (
      <section className="panel editor-pane empty-editor">
        <div className="empty-hint">
          <p>Open a file from the explorer to start editing.</p>
          <p className="hint-sub">
            AI-suggested changes arrive here via the File Read/Write Bridge (F5)
            — apply them from the AI Dock.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel editor-pane">
      <div className="tab-bar">
        {openFiles.map((f) => (
          <span
            key={f.path}
            className={`tab ${f.path === activeFile ? "active" : ""}`}
            onClick={() => setActiveFile(f.path)}
            onAuxClick={(e) => {
              if (e.button === 1) closeFile(f.path); // middle-click closes
            }}
            title={f.path}
          >
            {f.dirty && <span className="dirty-dot">●</span>}
            {basename(f.path)}
            <button
              className="tab-close"
              title="Close (Ctrl+W)"
              onClick={(e) => {
                e.stopPropagation();
                closeFile(f.path);
              }}
            >
              ✕
            </button>
          </span>
        ))}
        <span className="tab-spacer" />
        <button
          className="ghost-btn"
          onClick={() => saveActiveFile()}
          disabled={!file.dirty}
        >
          {file.dirty ? "Save (Ctrl+S)" : "Saved"}
        </button>
      </div>
      <Editor
        key={file.path}
        path={file.path}
        language={languageFor(file.path)}
        value={file.content}
        theme="vs-dark"
        onChange={(value) => updateActiveFile(value ?? "")}
        onMount={(editor, monaco) => {
          editorRef.current = editor;
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            saveActiveFile();
          });
          // Ctrl+W closes the tab (browser default is suppressed).
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => {
            if (file) closeFile(file.path);
          });
        }}
        options={{
          fontSize: 13,
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        }}
      />
    </section>
  );
}
