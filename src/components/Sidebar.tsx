import { useEffect, useState } from "react";
import { listDir, type DirEntry } from "../lib/fs";
import { useRelayStore } from "../relay/store";

function fileIcon(name: string): string {
  if (name.endsWith(".ts") || name.endsWith(".tsx")) return "🟦";
  if (name.endsWith(".js") || name.endsWith(".jsx")) return "🟨";
  if (name.endsWith(".json")) return "🧾";
  if (name.endsWith(".rs")) return "🦀";
  if (name.endsWith(".py")) return "🐍";
  if (name.endsWith(".md")) return "📄";
  if (name.endsWith(".html") || name.endsWith(".css")) return "🎨";
  return "📄";
}

function TreeItem({
  entry,
  depth,
  expanded,
  children,
  onToggle,
  onOpen,
}: {
  entry: DirEntry;
  depth: number;
  expanded: boolean;
  children?: DirEntry[];
  onToggle: (entry: DirEntry) => void;
  onOpen: (entry: DirEntry) => void;
}) {
  const padding = { paddingLeft: `${8 + depth * 14}px` };
  return (
    <div>
      <button
        className={`tree-item ${entry.is_dir ? "tree-dir" : "tree-file"}`}
        style={padding}
        onClick={() => (entry.is_dir ? onToggle(entry) : onOpen(entry))}
        title={entry.path}
      >
        <span className="tree-caret">{entry.is_dir ? (expanded ? "▾" : "▸") : ""}</span>
        <span className="tree-icon">
          {entry.is_dir ? "📁" : fileIcon(entry.name)}
        </span>
        <span className="tree-name">{entry.name}</span>
        {!entry.is_dir && entry.size != null && (
          <span className="tree-size">
            {entry.size > 1024 ? `${(entry.size / 1024).toFixed(1)}K` : `${entry.size}B`}
          </span>
        )}
      </button>
      {expanded &&
        children?.map((c) => (
          <TreeItem
            key={c.path}
            entry={c}
            depth={depth + 1}
            expanded={expandedPaths.has(c.path)}
            children={childMap.get(c.path)}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        ))}
    </div>
  );
}

// Module-level caches so expansion survives re-renders.
const expandedPaths = new Set<string>();
const childMap = new Map<string, DirEntry[]>();

export default function Sidebar() {
  const projectPath = useRelayStore((s) => s.projectPath);
  const busy = useRelayStore((s) => s.busy);
  const openProject = useRelayStore((s) => s.openProject);
  const openFile = useRelayStore((s) => s.openFile);
  const activeFile = useRelayStore((s) => s.activeFile);

  const [root, setRoot] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) return;
    setRoot(null);
    expandedPaths.clear();
    childMap.clear();
    listDir(projectPath)
      .then(setRoot)
      .catch((e) => setError(String(e)));
  }, [projectPath]);

  const toggle = async (entry: DirEntry) => {
    if (expandedPaths.has(entry.path)) {
      expandedPaths.delete(entry.path);
    } else {
      expandedPaths.add(entry.path);
      if (!childMap.has(entry.path)) {
        childMap.set(entry.path, await listDir(entry.path));
      }
    }
    setRoot([...(root ?? [])]); // re-render
  };

  const open = (entry: DirEntry) => {
    if (entry.is_dir) return;
    openFile(entry.path).catch((e) => setError(String(e)));
  };

  return (
    <aside className="panel sidebar">
      <div className="panel-title">
        <span>Explorer</span>
        <button className="ghost-btn" onClick={openProject} disabled={busy}>
          {projectPath ? "Switch" : "Open Project"}
        </button>
      </div>
      {projectPath && <div className="project-name">{projectPath}</div>}
      {error && <div className="error-text">{error}</div>}
      {!projectPath && (
        <div className="empty-hint">
          <p>No project open.</p>
          <button className="primary-btn" onClick={openProject} disabled={busy}>
            Open a project folder
          </button>
          <p className="hint-sub">
            Relay restricts file access to this folder (PRD §11).
          </p>
        </div>
      )}
      {projectPath &&
        (root ? (
          <div className="tree">
            {root.map((entry) => (
              <TreeItem
                key={entry.path}
                entry={entry}
                depth={0}
                expanded={expandedPaths.has(entry.path)}
                children={childMap.get(entry.path)}
                onToggle={toggle}
                onOpen={open}
              />
            ))}
          </div>
        ) : (
          <div className="loading">Indexing…</div>
        ))}
      {activeFile && (
        <div className="active-file-hint">Active: {activeFile}</div>
      )}
    </aside>
  );
}
