import Editor from "@monaco-editor/react";
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

function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANG_BY_EXT[ext] ?? "plaintext";
}

export default function EditorPane() {
  const openFiles = useRelayStore((s) => s.openFiles);
  const activeFile = useRelayStore((s) => s.activeFile);
  const updateActiveFile = useRelayStore((s) => s.updateActiveFile);
  const saveActiveFile = useRelayStore((s) => s.saveActiveFile);

  const file = openFiles.find((f) => f.path === activeFile);

  if (!file) {
    return (
      <section className="panel editor-pane empty-editor">
        <div className="empty-hint">
          <p>Open a file from the explorer to start editing.</p>
          <p className="hint-sub">
            AI-suggested changes will arrive here via the File Read/Write Bridge
            (F5) once the provider bridge is wired.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel editor-pane">
      <div className="tab-bar">
        {openFiles.map((f) => (
          <span key={f.path} className={f.path === activeFile ? "tab active" : "tab"}>
            {f.dirty && <span className="dirty-dot">●</span>}
            {f.path.split("/").pop()}
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
          editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            saveActiveFile();
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
