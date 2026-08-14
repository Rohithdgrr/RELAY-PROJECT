import { invoke } from "@tauri-apps/api/core";

export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
}

export interface GitStatusEntry {
  path: string;
  code: string;
}

export const listDir = (path: string) => invoke<DirEntry[]>("list_dir", { path });
export const readFile = (path: string) => invoke<string>("read_file", { path });
export const writeFile = (path: string, content: string) =>
  invoke<void>("write_file", { path, content });
export const createFile = (parent: string, name: string) =>
  invoke<void>("create_file", { parent, name });
export const createDir = (parent: string, name: string) =>
  invoke<void>("create_dir", { parent, name });
export const renamePath = (path: string, newName: string) =>
  invoke<void>("rename_path", { path, newName });
export const deletePath = (path: string) => invoke<void>("delete_path", { path });
export const gitStatus = (root: string) => invoke<GitStatusEntry[]>("git_status", { root });
export const pickProjectDir = () => invoke<string | null>("pick_project_dir");
