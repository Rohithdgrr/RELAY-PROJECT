import { useEffect, useRef, useState } from "react";
import { searchFiles, type SearchHit } from "../lib/fs";
import { useRelayStore } from "../relay/store";

const debounce = (fn: () => void, ms: number) => {
  let t: number | undefined;
  return () => {
    window.clearTimeout(t);
    t = window.setTimeout(fn, ms);
  };
};

export default function SearchPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const projectPath = useRelayStore((s) => s.projectPath);
  const openFile = useRelayStore((s) => s.openFile);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    cancelledRef.current = !open;
    return () => {
      cancelledRef.current = true;
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !query.trim() || !projectPath) {
      setResults([]);
      return;
    }
    setSearching(true);
    const run = debounce(async () => {
      try {
        const hits = await searchFiles(projectPath, query.trim(), 200);
        if (!cancelledRef.current) {
          setResults(hits);
          setError(null);
        }
      } catch (e) {
        if (!cancelledRef.current) {
          setError(String(e));
          setResults([]);
        }
      } finally {
        if (!cancelledRef.current) setSearching(false);
      }
    }, 350);
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, projectPath]);

  const openHit = (hit: SearchHit) => {
    onClose();
    openFile(hit.path, hit.line).catch(() => {});
  };

  if (!open) return null;

  return (
    <div className="search-panel" onMouseDown={onClose}>
      <div className="search-body" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-head">
          <input
            ref={inputRef}
            className="search-input"
            placeholder={
              projectPath
                ? "Search project files… (Enter opens first result)"
                : "Open a project first"
            }
            value={query}
            disabled={!projectPath}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) openHit(results[0]);
              if (e.key === "Escape") onClose();
            }}
          />
          <button className="ghost-btn" onClick={onClose}>
            Esc ✕
          </button>
        </div>
        <div className="search-meta">
          {searching
            ? "Searching…"
            : error
              ? `Error: ${error}`
              : query.trim()
                ? `${results.length} result(s)`
                : "Type to search"}
        </div>
        <div className="search-results">
          {results.map((r) => (
            <button
              key={`${r.path}:${r.line}`}
              className="search-hit"
              onClick={() => openHit(r)}
            >
              <span className="search-hit-loc">
                {r.path.replaceAll("\\", "/")}:{r.line}
              </span>
              <code className="search-hit-text">{r.text}</code>
            </button>
          ))}
          {!searching && query.trim() && results.length === 0 && (
            <div className="search-empty">No matches for “{query}”</div>
          )}
        </div>
      </div>
    </div>
  );
}
