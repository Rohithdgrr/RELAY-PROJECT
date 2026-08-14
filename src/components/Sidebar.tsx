import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listDir, readFile, type DirEntry } from "../lib/fs";
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

// Windows and POSIX separators both handled.
const SEP = /[\\/]/;
const basename = (p: string) => p.split(SEP).pop() ?? p;
const parentOf = (p: string) => {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx > 0 ? p.slice(0, idx) : p;
};

export interface GitStatusEntry {
  path: string;
  code: string;
}

// Map git porcelain codes to a single-letter badge (docs §3.1: M/A/U/D/C).
function gitBadge(code: string): string | null {
  if (code.startsWith("??")) return "U";
  if (code.includes("R")) return "R";
  if (code.includes("C")) return "C";
  if (code.includes("A")) return "A";
  if (code.includes("D")) return "D";
  if (code.includes("M")) return "M";
  const trimmed = code.trim();
  return trimmed ? trimmed[0] : null;
}

interface MenuState {
  x: number;
  y: number;
  entry: DirEntry;
  isDir: boolean;
}

export default function Sidebar() {
  const projectPath = useRelayStore((s) => s.projectPath);
  const busy = useRelayStore((s) => s.busy);
  const openProject = useRelayStore((s) => s.openProject);
  const openFile = useRelayStore((s) => s.openFile);
  const activeFile = useRelayStore((s) => s.activeFile);
  const treeRevision = useRelayStore((s) => s.treeRevision);
  const activeProvider = useRelayStore((s) => s.activeProvider);

  const [root, setRoot] = useState<DirEntry[] | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [children, setChildren] = useState<ReadonlyMap<string, DirEntry[]>>(new Map());
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set());
  const [git, setGit] = useState<ReadonlyMap<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Guards against double-firing toggles before state settles.
  const inflight = useRef<Set<string>>(new Set());

  const relPath = useCallback(
    (abs: string) => {
      if (!projectPath) return abs;
      const rootNorm = projectPath.replaceAll("\\", "/").replace(/\/$/, "");
      const absNorm = abs.replaceAll("\\", "/");
      return absNorm.startsWith(rootNorm + "/")
        ? absNorm.slice(rootNorm.length + 1)
        : absNorm;
    },
    [projectPath]
  );

  const loadGit = useCallback(async (rootPath: string) => {
    try {
      const entries = await invoke<GitStatusEntry[]>("git_status", { root: rootPath });
      setGit(new Map(entries.map((e) => [e.path, e.code])));
    } catch {
      setGit(new Map());
    }
  }, []);

  const refreshDir = useCallback(
    async (dirPath: string) => {
      try {
        const list = await listDir(dirPath);
        if (dirPath === projectPath) {
          setRoot(list);
        } else {
          setChildren((prev) => new Map(prev).set(dirPath, list));
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [projectPath]
  );

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    setRoot(null);
    setExpanded(new Set());
    setChildren(new Map());
    setLoading(new Set());
    setError(null);
    listDir(projectPath)
      .then((r) => {
        if (!cancelled) setRoot(r);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    loadGit(projectPath);
    return () => {
      cancelled = true;
    };
  }, [projectPath, treeRevision, loadGit]);

  // Close the context menu on any outside click.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);

  const toggle = async (entry: DirEntry) => {
    const path = entry.path;
    if (inflight.current.has(path)) return;
    const willExpand = !expanded.has(path);

    setExpanded((prev) => {
      const next = new Set(prev);
      if (willExpand) next.add(path);
      else next.delete(path);
      return next;
    });

    if (willExpand && !children.has(path)) {
      inflight.current.add(path);
      setLoading((prev) => new Set(prev).add(path));
      try {
        const list = await listDir(path);
        setChildren((prev) => new Map(prev).set(path, list));
      } catch (e) {
        setError(String(e));
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      } finally {
        inflight.current.delete(path);
        setLoading((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    }
  };

  const open = (entry: DirEntry) => {
    if (entry.is_dir) return;
    openFile(entry.path).catch((e) => setError(String(e)));
  };

  const runAction = async (
    action:
      | "new-file"
      | "new-folder"
      | "rename"
      | "delete"
      | "copy-path"
      | "send-to-ai",
    entry: DirEntry,
    isDir: boolean
  ) => {
    setMenu(null);
    const isRoot = entry.path === projectPath;
    try {
      const targetDir = isDir ? entry.path : parentOf(entry.path);
      switch (action) {
        case "new-file": {
          const name = window.prompt("New file name:", "");
          if (name) await invoke("create_file", { parent: targetDir, name });
          break;
        }
        case "new-folder": {
          const name = window.prompt("New folder name:", "");
          if (name) await invoke("create_dir", { parent: targetDir, name });
          break;
        }
        case "rename": {
          if (isRoot) throw new Error("Cannot rename the project root");
          const name = window.prompt("Rename to:", basename(entry.path));
          if (name && name !== basename(entry.path)) {
            await invoke("rename_path", { path: entry.path, newName: name });
          }
          break;
        }
        case "delete": {
          if (isRoot) throw new Error("Cannot delete the project root");
          const kind = isDir ? "folder" : "file";
          if (
            window.confirm(
              `Delete ${kind} "${basename(entry.path)}"? This cannot be undone.`
            )
          ) {
            await invoke("delete_path", { path: entry.path });
          }
          break;
        }
        case "copy-path": {
          await navigator.clipboard.writeText(entry.path);
          return;
        }
        case "send-to-ai": {
          // User-initiated READ: send this file's contents into the active
          // provider's input. Relay never reads a file the user did not
          // explicitly pick (Complete Docs §8.5).
          if (!activeProvider) {
            setError("No provider active — open the AI Dock and pick a model first");
            return;
          }
          const content = await readFile(entry.path);
          const ext = entry.name.split(".").pop() ?? "";
          const rel = relPath(entry.path);
          const text = [
            `## FILE: ${rel}`,
            `\`\`\`${ext}`,
            content,
            "```",
            "",
            "Read the file above. Tell me what you'd change or write next.",
          ].join("\n");
          await invoke("dock_context", { provider: activeProvider, text });
          setNotice(`Sent ${rel} to ${activeProvider}'s input — review and send`);
          return;
        }
      }
      if (projectPath) {
        await refreshDir(projectPath);
        await refreshDir(targetDir);
        await loadGit(projectPath);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const renderItem = (entry: DirEntry, depth: number) => {
    const isExpanded = expanded.has(entry.path);
    const childList = children.get(entry.path);
    const isLoading = loading.has(entry.path);
    const badge = entry.is_dir ? null : gitBadge(git.get(relPath(entry.path)) ?? "");
    const isActive = entry.path === activeFile;
    return (
      <div key={entry.path}>
        <button
          className={`tree-item ${isActive ? "active" : ""}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => (entry.is_dir ? toggle(entry) : open(entry))}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, entry, isDir: entry.is_dir });
          }}
          title={entry.path}
        >
          <span className="tree-caret">
            {entry.is_dir ? (isExpanded ? "▾" : "▸") : ""}
          </span>
          <span className="tree-icon">
            {entry.is_dir ? "📁" : fileIcon(entry.name)}
          </span>
          <span className="tree-name">{entry.name}</span>
          {badge && <span className={`git-badge badge-${badge}`}>{badge}</span>}
          {!entry.is_dir && entry.size != null && (
            <span className="tree-size">
              {entry.size > 1024
                ? `${(entry.size / 1024).toFixed(1)}K`
                : `${entry.size}B`}
            </span>
          )}
        </button>
        {isExpanded &&
          (childList
            ? childList.map((c) => renderItem(c, depth + 1))
            : isLoading && (
                <div
                  className="loading-row"
                  style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}
                >
                  Loading…
                </div>
              ))}
      </div>
    );
  };

  const rootEntry: DirEntry = {
    name: basename(projectPath ?? ""),
    path: projectPath ?? "",
    is_dir: true,
    size: null,
  };

  return (
    <aside className="panel sidebar">
      <div className="panel-title">
        <span>Explorer</span>
        <div className="title-actions">
          {projectPath && (
            <button
              className="ghost-btn"
              title="Refresh"
              onClick={() => {
                refreshDir(projectPath);
                loadGit(projectPath);
              }}
            >
              ↻
            </button>
          )}
          <button className="ghost-btn" onClick={openProject} disabled={busy}>
            {projectPath ? "Switch" : "Open Project"}
          </button>
        </div>
      </div>

      {projectPath && <div className="project-name">{projectPath}</div>}
      {error && (
        <div className="error-text">
          {error}
          <button className="ghost-btn" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}
      {notice && (
        <div className="notice-text">
          {notice}
          <button className="ghost-btn" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

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

      {projectPath && (
        <div
          className="tree"
          onContextMenu={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              setMenu({
                x: e.clientX,
                y: e.clientY,
                entry: rootEntry,
                isDir: true,
              });
            }
          }}
        >
          {root ? (
            root.map((entry) => renderItem(entry, 0))
          ) : (
            <div className="loading">Indexing…</div>
          )}
        </div>
      )}

      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="context-item"
            onClick={() => runAction("new-file", menu.entry, menu.isDir)}
          >
            📄 New File
          </button>
          <button
            className="context-item"
            onClick={() => runAction("new-folder", menu.entry, menu.isDir)}
          >
            📁 New Folder
          </button>
          <div className="context-sep" />
          {!menu.isDir && (
            <button
              className="context-item"
              onClick={() => runAction("send-to-ai", menu.entry, menu.isDir)}
            >
              🤖 Send to AI dock
            </button>
          )}
          <button
            className="context-item"
            onClick={() => runAction("rename", menu.entry, menu.isDir)}
          >
            ✏️ Rename
          </button>
          <button
            className="context-item"
            onClick={() => runAction("copy-path", menu.entry, menu.isDir)}
          >
            📋 Copy Path
          </button>
          <button
            className="context-item danger"
            onClick={() => runAction("delete", menu.entry, menu.isDir)}
          >
            🗑️ Delete
          </button>
        </div>
      )}
    </aside>
  );
}
