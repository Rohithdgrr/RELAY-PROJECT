import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import EditorPane from "./components/EditorPane";
import TerminalPane from "./components/TerminalPane";
import AIDock from "./components/AIDock";
import StatusBar from "./components/StatusBar";
import CommandPalette from "./components/CommandPalette";
import SearchPanel from "./components/SearchPanel";
import { useRelayStore } from "./relay/store";

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const restoreSession = useRelayStore((s) => s.restoreSession);
  const focusTerminal = useRelayStore((s) => s.focusTerminal);
  const openProject = useRelayStore((s) => s.openProject);

  useEffect(() => {
    restoreSession().catch(() => {});

    // Shared "new file" flow (Ctrl+N and the palette).
    const newFile = async () => {
      const projectPath = useRelayStore.getState().projectPath;
      const name = window.prompt("New file name (relative to project):");
      if (!name || !projectPath) return;
      try {
        await invoke("create_file", { parent: projectPath, name });
        await useRelayStore
          .getState()
          .openFile(`${projectPath.replace(/[\\/]+$/, "")}\\${name}`);
        useRelayStore.getState().bumpTree();
      } catch (e) {
        window.alert(String(e));
      }
    };

    const cycleTab = (dir: 1 | -1) => {
      const s = useRelayStore.getState();
      const paths = s.openFiles.map((f) => f.path);
      if (paths.length < 2) return;
      const idx = Math.max(0, paths.indexOf(s.activeFile ?? ""));
      const next = paths[(idx + dir + paths.length) % paths.length];
      s.setActiveFile(next);
    };

    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (k === "`") {
        e.preventDefault();
        focusTerminal();
      } else if (e.shiftKey && k === "f") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (k === "n") {
        e.preventDefault();
        newFile();
      } else if (k === "tab") {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
      }
    };
    const onSearchEvent = () => setSearchOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("relay://open-search", onSearchEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("relay://open-search", onSearchEvent);
    };
  }, [restoreSession, focusTerminal, openProject]);

  return (
    <div className="app">
      <Header />
      <div className="workspace">
        <Sidebar />
        <div className="center">
          <EditorPane />
          <TerminalPane />
        </div>
        <AIDock />
      </div>
      <StatusBar />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <SearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
