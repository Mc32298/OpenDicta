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
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadData() {
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
    setQuery("");
    setHighlight(0);
  }

  // Reload + focus every time the window is shown.
  useEffect(() => {
    void loadData();
    inputRef.current?.focus();
    const un = listen("quickswitch-show", () => {
      void loadData();
      inputRef.current?.focus();
    });
    return () => { void un.then((f) => f()); };
  }, []);

  // Close when the window loses focus (click-away).
  useEffect(() => {
    const win = getCurrentWindow();
    const un = win.onFocusChanged(({ payload: focused }) => {
      if (!focused) void invoke("hide_quickswitch_cmd");
    });
    return () => { void un.then((f) => f()); };
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
    if (row.kind === "model") {
      await invoke("set_active_model_id", { modelId: row.id }).catch(console.error);
    } else {
      await invoke("set_ai_default_mode", { mode: row.id }).catch(console.error);
    }
    await invoke("hide_quickswitch_cmd").catch(() => {});
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      void invoke("hide_quickswitch_cmd");
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

  return (
    <div className="qs-root">
      <input
        ref={inputRef}
        className="qs-search"
        placeholder="Switch model or style…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
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
