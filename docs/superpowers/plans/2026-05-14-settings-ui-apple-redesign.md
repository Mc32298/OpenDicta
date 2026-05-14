# Settings UI Apple Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the settings window so it feels closer to macOS System Settings with a soft frosted, premium, restrained Apple-like visual language while preserving all existing behavior.

**Architecture:** Keep the existing settings window structure and state flow intact, and concentrate the redesign in the shell, sidebar, grouped panels, and shared controls. Use CSS and small JSX refinements rather than a component-system rewrite so the behavior remains stable while the hierarchy, materials, and spacing shift toward a calmer native-inspired feel.

**Tech Stack:** React 18, TypeScript, Tauri window shell, shared CSS in `src/styles.css`, shared settings controls in `src/ui/controls.tsx`

---

## File Structure

- Modify: `src/windows/Settings.tsx`
  Responsibility: settings shell structure, sidebar/header markup, tab page wrappers, small layout hooks for the redesign.
- Modify: `src/styles.css`
  Responsibility: visual system, window chrome, sidebar, grouped settings panels, rows, buttons, segmented controls, inputs, motion, responsive behavior.
- Modify: `src/ui/controls.tsx`
  Responsibility: shared settings primitives whose markup or class naming needs slight refinement for the new styling.

No backend files should change for this redesign.

### Task 1: Rework the Settings Shell and Sidebar

**Files:**
- Modify: `src/windows/Settings.tsx`
- Modify: `src/styles.css`
- Test: `npm run build`

- [ ] **Step 1: Add a shell-level page wrapper hook in the settings window**

Update the settings page mounting in `src/windows/Settings.tsx` so every tab uses a common page wrapper class that can animate and share spacing rules.

```tsx
<main className="wv-main">
  <ToastProvider>
    <section className="wv-page" data-active={page === "general" ? "1" : "0"} style={{ display: page === "general" ? "" : "none" }}>
      <GeneralTab />
    </section>
    <section className="wv-page" data-active={page === "shortcut" ? "1" : "0"} style={{ display: page === "shortcut" ? "" : "none" }}>
      <ShortcutTab />
    </section>
  </ToastProvider>
</main>
```

- [ ] **Step 2: Refine the sidebar header markup for a denser System Settings feel**

Adjust the sidebar header block in `src/windows/Settings.tsx` so the brand and version text can stack more cleanly under tighter visual spacing.

```tsx
<div className="wv-sidebar-head">
  <span className="wv-brand-mark"><MicIcon /></span>
  <div className="wv-brand-block">
    <div className="wv-brand-name">VoiceNote</div>
    <div className="wv-brand-ver">Version 0.1.0</div>
  </div>
</div>
```

- [ ] **Step 3: Restyle the window chrome, sidebar, and nav states**

Update `src/styles.css` to introduce the softer frosted shell, calmer chrome, denser sidebar, and subtler active state.

```css
.wv-chrome {
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  background: linear-gradient(180deg, rgba(36, 38, 44, 0.78), rgba(28, 30, 36, 0.68));
  border-bottom: 1px solid rgba(255,255,255,0.08);
}

.wv-sidebar {
  width: 208px;
  background: linear-gradient(180deg, rgba(44, 46, 54, 0.72), rgba(26, 28, 34, 0.82));
  backdrop-filter: blur(28px) saturate(185%);
  -webkit-backdrop-filter: blur(28px) saturate(185%);
  border-right: 1px solid rgba(255,255,255,0.07);
}

.wv-nav-item[data-active="1"] {
  background: rgba(255,255,255,0.16);
  color: rgba(255,255,255,0.97);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
}
```

- [ ] **Step 4: Run the frontend build**

Run: `npm run build`

Expected: Vite and TypeScript complete successfully with no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/windows/Settings.tsx src/styles.css
git commit -m "style: refine settings shell and sidebar"
```

### Task 2: Convert Grouped Panels and Rows to a Softer Native Hierarchy

**Files:**
- Modify: `src/styles.css`
- Modify: `src/ui/controls.tsx`
- Test: `npm run build`

- [ ] **Step 1: Slightly enrich the group and row markup only if needed for styling hooks**

Keep `SettingsSection` and `SettingsRow` structurally simple, but add only the classes needed for the new hierarchy if the current markup is insufficient.

```tsx
export function SettingsSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="wv-group">
      {title && <div className="wv-group-title">{title}</div>}
      <div className="wv-group-card">{children}</div>
    </section>
  );
}
```

- [ ] **Step 2: Restyle grouped panels away from chunky cards**

Update `src/styles.css` so section containers feel embedded into one page instead of stacked heavy blocks.

```css
.wv-group-card {
  background: linear-gradient(180deg, rgba(255,255,255,0.085), rgba(255,255,255,0.055));
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
  overflow: hidden;
}

.wv-row {
  min-height: 54px;
  padding: 13px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.055);
}

.wv-row-label > div:first-child {
  font-size: 13px;
  font-weight: 500;
}
```

- [ ] **Step 3: Tighten page typography and rhythm**

Refine pane title and subtitle styling in `src/styles.css` so the content area feels more native and less web-app-like.

```css
.wv-pane {
  padding: 30px 32px 36px;
}

.wv-pane-title {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: 0;
}

.wv-pane-sub {
  margin-top: 6px;
  max-width: 620px;
  color: rgba(235,235,245,0.56);
}
```

- [ ] **Step 4: Run the frontend build**

Run: `npm run build`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/styles.css src/ui/controls.tsx
git commit -m "style: soften settings groups and row hierarchy"
```

### Task 3: Restyle Controls Toward Native Mac Feel

**Files:**
- Modify: `src/styles.css`
- Modify: `src/ui/controls.tsx`
- Modify: `src/windows/Settings.tsx`
- Test: `npm run build`

- [ ] **Step 1: Slim down segmented choice controls**

Adjust the segmented-choice styling in `src/styles.css` so AI mode/model/provider options read closer to desktop segmented controls than broad web pills.

```css
.wv-choice-group {
  gap: 6px;
}

.wv-choice-btn {
  min-height: 30px;
  border-radius: 10px;
  padding: 6px 11px;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.10);
}

.wv-choice-btn[data-active="1"] {
  background: rgba(125, 184, 255, 0.22);
  color: #f7fbff;
  border-color: rgba(153, 201, 255, 0.34);
}
```

- [ ] **Step 2: Restyle inputs, buttons, and switches**

Update the shared controls in `src/styles.css` so they feel more precise and less bulky.

```css
.wv-input,
.wv-select {
  min-height: 32px;
  border-radius: 9px;
  background: rgba(255,255,255,0.075);
  border: 1px solid rgba(255,255,255,0.11);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
}

.wv-btn {
  min-height: 32px;
  border-radius: 9px;
  background: rgba(255,255,255,0.09);
}

.wv-switch {
  background: rgba(255,255,255,0.14);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05);
}
```

- [ ] **Step 3: Make the AI key action row feel quieter and more native**

Adjust the save/delete button arrangement in `src/windows/Settings.tsx` only if needed to support the refined control styling without crowding.

```tsx
<div className="wv-inline wv-inline-stack">
  <input className="wv-input" type="password" ... />
  <div className="wv-inline">
    <Button onClick={() => void saveOpenAiKey()}>Save</Button>
    <Button variant="danger" onClick={() => void deleteOpenAiKey()}>Delete</Button>
  </div>
</div>
```

- [ ] **Step 4: Run the frontend build**

Run: `npm run build`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/styles.css src/ui/controls.tsx src/windows/Settings.tsx
git commit -m "style: align settings controls with native mac feel"
```

### Task 4: Add Motion, Responsive Polish, and Visual QA

**Files:**
- Modify: `src/styles.css`
- Modify: `src/windows/Settings.tsx`
- Test: `npm run build`

- [ ] **Step 1: Add restrained page and state transitions**

Introduce subtle motion rules in `src/styles.css` for page changes, row hover, and control selection.

```css
.wv-page {
  animation: wv-page-in 160ms ease;
}

@keyframes wv-page-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.wv-row,
.wv-nav-item,
.wv-choice-btn,
.wv-btn,
.wv-input {
  transition: background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast), box-shadow var(--motion-fast), transform var(--motion-fast), opacity var(--motion-fast);
}
```

- [ ] **Step 2: Tighten the existing responsive rules for the redesigned layout**

Update the mobile or narrow-width section in `src/styles.css` so the denser Apple-like layout still wraps cleanly.

```css
@media (max-width: 900px) {
  .wv-sidebar {
    width: 196px;
    flex-basis: 196px;
  }

  .wv-pane {
    padding: 22px 20px 28px;
  }

  .wv-choice-group {
    justify-content: flex-start;
  }
}
```

- [ ] **Step 3: Run the build and manually inspect all settings tabs**

Run: `npm run build`

Expected: PASS

Manual QA checklist:

- General tab spacing and row hierarchy feel consistent
- Sidebar active state is subtle but visible
- AI chips, inputs, and key action buttons do not crowd
- Diagnostics and About tabs still read cleanly
- Narrow-width layout wraps without overlapping labels and controls

- [ ] **Step 4: Commit**

```bash
git add src/styles.css src/windows/Settings.tsx
git commit -m "style: add settings motion and responsive polish"
```

## Self-Review

### Spec Coverage

- System Settings-inspired direction: covered by Tasks 1 and 2
- Soft frosted materials: covered by Tasks 1 and 2
- Reduced chunky card feel: covered by Task 2
- Native-feeling controls: covered by Task 3
- Minimal purposeful motion: covered by Task 4
- No behavior change: preserved by keeping scope to `Settings.tsx`, `styles.css`, and `controls.tsx`

No gaps found against the approved spec.

### Placeholder Scan

No `TODO`, `TBD`, or unresolved placeholders remain in the plan.

### Type and Naming Consistency

- Uses existing file names and component names consistently
- Keeps the current `SettingsSection`, `SettingsRow`, `Button`, and page component names
- Does not invent new backend interfaces

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-settings-ui-apple-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

