import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { pickProjectDir, readFile, writeFile } from "../lib/fs";
import type { ProviderId, RelayPacket, SessionState } from "./types";

export interface OpenFile {
  path: string;
  content: string;
  dirty: boolean;
}

const LS_LAST_PROJECT = "relay.lastProject";
const LS_OPEN_FILES = "relay.openFiles";
const LS_ACTIVE_FILE = "relay.activeFile";
const LS_RECENT = "relay.recentProjects";

const readLS = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeLS = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable — persistence is best-effort */
  }
};

interface RelayState {
  session: SessionState | null;
  projectPath: string | null;
  openFiles: OpenFile[];
  activeFile: string | null;
  lastPacket: RelayPacket | null;
  busy: boolean;
  treeRevision: number;
  /** Provider whose embedded webview is currently shown (set by the AI dock). */
  activeProvider: ProviderId | null;
  /** Line to reveal in the active editor after it mounts (search results). */
  pendingLine: number | null;
  /** Non-null when the status bar / palette asks the dock to activate a provider. */
  requestedProvider: ProviderId | null;
  /** Incremented to ask the terminal pane to focus its input. */
  terminalFocus: number;
  /** Whether a PTY shell session is currently alive (set by the terminal pane). */
  terminalAlive: boolean;
  recentProjects: string[];

  bumpTree: () => void;
  setActiveProvider: (p: ProviderId | null) => void;
  requestProvider: (p: ProviderId) => void;
  clearRequestedProvider: () => void;
  focusTerminal: () => void;
  setTerminalAlive: (alive: boolean) => void;
  openProject: () => Promise<void>;
  openFile: (path: string, line?: number) => Promise<void>;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateActiveFile: (content: string) => void;
  saveActiveFile: () => Promise<void>;
  refreshSession: () => Promise<void>;
  runHandoff: () => Promise<RelayPacket | null>;
  addRecentProject: (dir: string) => void;
  /** Restore the last project + open tabs from localStorage. */
  restoreSession: () => Promise<void>;
  persist: () => void;
}

const persist = () => {
  const s = useRelayStore.getState();
  writeLS(LS_LAST_PROJECT, s.projectPath ?? "");
  writeLS(LS_OPEN_FILES, JSON.stringify(s.openFiles.map((f) => f.path)));
  writeLS(LS_ACTIVE_FILE, s.activeFile ?? "");
  writeLS(LS_RECENT, JSON.stringify(s.recentProjects));
};

export const useRelayStore = create<RelayState>((set, get) => ({
  session: null,
  projectPath: null,
  openFiles: [],
  activeFile: null,
  lastPacket: null,
  busy: false,
  treeRevision: 0,
  activeProvider: null,
  pendingLine: null,
  requestedProvider: null,
  terminalFocus: 0,
  terminalAlive: false,
  recentProjects: (() => {
    try {
      const raw = readLS(LS_RECENT);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  })(),

  bumpTree: () => set((s) => ({ treeRevision: s.treeRevision + 1 })),
  setActiveProvider: (p) => set({ activeProvider: p }),
  requestProvider: (p) => set({ requestedProvider: p }),
  clearRequestedProvider: () => set({ requestedProvider: null }),
  focusTerminal: () => set((s) => ({ terminalFocus: s.terminalFocus + 1 })),
  setTerminalAlive: (alive) => set({ terminalAlive: alive }),

  openProject: async () => {
    const dir = await pickProjectDir();
    if (!dir) return;
    set({ projectPath: dir, busy: true });
    try {
      await invoke("set_project", { path: dir });
      get().addRecentProject(dir);
      await get().refreshSession();
      persist();
    } finally {
      set({ busy: false });
    }
  },

  openFile: async (path, line) => {
    const existing = get().openFiles.find((f) => f.path === path);
    if (existing) {
      set({ activeFile: path, pendingLine: line ?? null });
      return;
    }
    const content = await readFile(path);
    set((s) => ({
      openFiles: [...s.openFiles, { path, content, dirty: false }],
      activeFile: path,
      pendingLine: line ?? null,
    }));
    persist();
  },

  closeFile: (path) => {
    set((s) => {
      const openFiles = s.openFiles.filter((f) => f.path !== path);
      let activeFile = s.activeFile;
      if (activeFile === path) {
        const idx = s.openFiles.findIndex((f) => f.path === path);
        activeFile = openFiles[Math.min(idx, openFiles.length - 1)]?.path ?? null;
      }
      return { openFiles, activeFile };
    });
    persist();
  },

  setActiveFile: (path) => {
    set({ activeFile: path });
    persist();
  },

  updateActiveFile: (content) => {
    const path = get().activeFile;
    if (!path) return;
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, content, dirty: true } : f
      ),
    }));
  },

  saveActiveFile: async () => {
    const path = get().activeFile;
    if (!path) return;
    const file = get().openFiles.find((f) => f.path === path);
    if (!file) return;
    await writeFile(path, file.content);
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, dirty: false } : f
      ),
    }));
  },

  refreshSession: async () => {
    const session = await invoke<SessionState>("session_status");
    set({ session });
  },

  runHandoff: async () => {
    set({ busy: true });
    try {
      const packet = await invoke<RelayPacket>("handoff", { reason: "manual" });
      set({ lastPacket: packet });
      await get().refreshSession();
      return packet;
    } catch (e) {
      console.error("handoff failed", e);
      return null;
    } finally {
      set({ busy: false });
    }
  },

  addRecentProject: (dir) => {
    set((s) => ({
      recentProjects: [dir, ...s.recentProjects.filter((p) => p !== dir)].slice(0, 6),
    }));
    persist();
  },

  restoreSession: async () => {
    const lastProject = readLS(LS_LAST_PROJECT);
    if (!lastProject) return;
    try {
      await invoke("set_project", { path: lastProject });
    } catch {
      return;
    }
    set({ projectPath: lastProject });
    let openPaths: string[] = [];
    try {
      const raw = readLS(LS_OPEN_FILES);
      if (raw) openPaths = JSON.parse(raw) as string[];
    } catch {
      openPaths = [];
    }
    const restored: OpenFile[] = [];
    for (const path of openPaths.slice(0, 8)) {
      try {
        restored.push({ path, content: await readFile(path), dirty: false });
      } catch {
        /* file gone — skip */
      }
    }
    const active = readLS(LS_ACTIVE_FILE) ?? restored[0]?.path ?? null;
    set({
      openFiles: restored,
      activeFile: restored.some((f) => f.path === active) ? active : restored[0]?.path ?? null,
    });
    await get().refreshSession().catch(() => {});
  },

  persist,
}));
