import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { pickProjectDir, readFile, writeFile } from "../lib/fs";
import type { RelayPacket, SessionState } from "./types";

export interface OpenFile {
  path: string;
  content: string;
  dirty: boolean;
}

interface RelayState {
  session: SessionState | null;
  projectPath: string | null;
  openFiles: OpenFile[];
  activeFile: string | null;
  lastPacket: RelayPacket | null;
  busy: boolean;

  openProject: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  updateActiveFile: (content: string) => void;
  saveActiveFile: () => Promise<void>;
  refreshSession: () => Promise<void>;
  runHandoff: () => Promise<RelayPacket | null>;
}

export const useRelayStore = create<RelayState>((set, get) => ({
  session: null,
  projectPath: null,
  openFiles: [],
  activeFile: null,
  lastPacket: null,
  busy: false,

  openProject: async () => {
    const dir = await pickProjectDir();
    if (!dir) return;
    set({ projectPath: dir, busy: true });
    try {
      await invoke("set_project", { path: dir });
      await get().refreshSession();
    } finally {
      set({ busy: false });
    }
  },

  openFile: async (path) => {
    const existing = get().openFiles.find((f) => f.path === path);
    if (existing) {
      set({ activeFile: path });
      return;
    }
    const content = await readFile(path);
    set((s) => ({
      openFiles: [...s.openFiles, { path, content, dirty: false }],
      activeFile: path,
    }));
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
}));
