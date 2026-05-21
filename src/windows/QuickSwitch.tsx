import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MODEL_CATALOG, STYLE_CATALOG } from "../lib/catalog";

type Kind = "model" | "style";

interface Row {
  kind: Kind;
  id: string;
  name: string;
  active: boolean;
}

// Backend AI mode -> Style display id (mirrors Style.tsx).
function mapMode(mode: string): string {
  if (mode === "clean") return "grammar";
  if (mode === "translate") return "summary";
  if (mode === "clean_translate") return "grammar";
  return mode;
}

export default function QuickSwitch() {
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const searchRef = useRef<HTMLDivElement>(null);
  const clearTimerRef = useRef<number[]>([]);

  function clearPendingSearchResets() {
    for (const timer of clearTimerRef.current) {
      window.clearTimeout(timer);
    }
    clearTimerRef.current = [];
  }

  function resetSearch() {
    setQuery("");
    setHighlight(0);
  }

  function focusBlankSearch() {
    clearPendingSearchResets();
    resetSearch();
    const clearInput = () => {
      searchRef.current?.focus();
    };
    window.requestAnimationFrame(clearInput);
    for (const delay of [0, 25, 75, 150, 300]) {
      const timer = window.setTimeout(clearInput, delay);
      clearTimerRef.current.push(timer);
    }
  }

  function closePalette() {
    resetSearch();
    void invoke("hide_quickswitch_cmd");
  }

  async function loadData() {
    resetSearch();

    // Models: keep only downloaded ones.
    const activeModel = await invoke<string>("get_active_model_id").catch(() => "");
    const modelRows: Row[] = [];
    for (const m of MODEL_CATALOG) {
      const status = await invoke<{ all_present: boolean }>("get_model_status", { modelId: m.id }).catch(() => null);
      if (status?.all_present) {
        modelRows.push({ kind: "model", id: m.id, name: m.name, active: m.id === activeModel });
      }
    }

    // Styles: all when AI on, else only "raw".
    const aiOn = await invoke<boolean>("get_ai_enabled").catch(() => false);
    const activeStyle = mapMode(await invoke<string>("get_ai_default_mode").catch(() => "raw"));
    const styleSource = aiOn ? STYLE_CATALOG : STYLE_CATALOG.filter((s) => s.id === "raw");
    const styleRows: Row[] = styleSource.map((s) => ({
      kind: "style", id: s.id, name: s.name, active: s.id === activeStyle,
    }));

    setRows([...modelRows, ...styleRows]);
  }

  // Reload + focus every time the window is shown.
  useEffect(() => {
    void loadData();
    focusBlankSearch();
    const unlistenShow = listen("quickswitch-show", () => {
      focusBlankSearch();
      void loadData();
    });
    const unlistenHide = listen("quickswitch-hide", () => {
      resetSearch();
    });
    return () => {
      clearPendingSearchResets();
      void unlistenShow.then((f) => f());
      void unlistenHide.then((f) => f());
    };
  }, []);

  // Close when the window loses focus (click-away).
  useEffect(() => {
    const win = getCurrentWindow();
    const un = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        focusBlankSearch();
        void loadData();
      } else {
        closePalette();
      }
    });
    return () => { void un.then((f) => f()); };
  }, []);

  useEffect(() => {
    const unlistenActiveModel = listen<string>("active-model-changed", (event) => {
      setRows((current) => current.map((row) => (
        row.kind === "model" ? { ...row, active: row.id === event.payload } : row
      )));
    });

    const unlistenActiveStyle = listen<string>("ai-default-mode-changed", (event) => {
      const activeStyle = mapMode(event.payload);
      setRows((current) => current.map((row) => (
        row.kind === "style" ? { ...row, active: row.id === activeStyle } : row
      )));
    });

    return () => {
      void unlistenActiveModel.then((f) => f());
      void unlistenActiveStyle.then((f) => f());
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  // Keep highlight in range as the filtered list changes.
  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  async function applyRow(row: Row) {
    try {
      if (row.kind === "model") {
        await invoke("set_active_model_id", { modelId: row.id });
        setRows((current) => current.map((candidate) => (
          candidate.kind === "model" ? { ...candidate, active: candidate.id === row.id } : candidate
        )));
      } else {
        await invoke("set_ai_default_mode", { mode: row.id });
        setRows((current) => current.map((candidate) => (
          candidate.kind === "style" ? { ...candidate, active: candidate.id === row.id } : candidate
        )));
      }
      closePalette();
    } catch (err) {
      console.error(err);
    }
  }

  function onKeyDown(e: { key: string; preventDefault: () => void }) {
    if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (filtered.length ? (h + 1) % filtered.length : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (filtered.length ? (h - 1 + filtered.length) % filtered.length : 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = filtered[highlight];
      if (row) void applyRow(row);
    }
  }

  function onSearchKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Backspace") {
      e.preventDefault();
      setQuery((q) => q.slice(0, -1));
      setHighlight(0);
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      resetSearch();
      return;
    }
    if (e.key === " " && query.length === 0) {
      e.preventDefault();
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      setQuery((q) => q + e.key);
      setHighlight(0);
    }
  }

  // Handle keys even when focus has moved from the input to a result row.
  useEffect(() => {
    const onWindowKeyDown = (e: KeyboardEvent) => {
      onKeyDown(e);
      onSearchKeyDown(e);
    };
    window.addEventListener("keydown", onWindowKeyDown, true);
    return () => window.removeEventListener("keydown", onWindowKeyDown, true);
  }, [filtered, highlight, query]);

  return (
    <div className="qs-root">
      <div
        ref={searchRef}
        className={"qs-search qs-search-display" + (query ? "" : " qs-search-empty")}
        tabIndex={0}
      >
        {query || "Switch model or style..."}
      </div>
      <div className="qs-list">
        {filtered.length === 0 && <div className="qs-empty">No matches</div>}
        {filtered.map((row, i) => (
          <button
            key={`${row.kind}:${row.id}`}
            type="button"
            className={"qs-item" + (i === highlight ? " qs-item-on" : "")}
            onMouseEnter={() => setHighlight(i)}
            onClick={() => void applyRow(row)}
          >
            <span className="qs-item-name">
              {row.name}
              {row.active && <span className="qs-item-active">active</span>}
            </span>
            <span className="qs-item-kind">{row.kind}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
