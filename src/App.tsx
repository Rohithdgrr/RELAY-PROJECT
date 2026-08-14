import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import EditorPane from "./components/EditorPane";
import TerminalPane from "./components/TerminalPane";
import AIDock from "./components/AIDock";
import StatusBar from "./components/StatusBar";

export default function App() {
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
    </div>
  );
}
