# Session Detail Page — Design Brief
*Design specification for `/sessions/[id]`*
*Companion to `design-brief.md` (main dashboard). Shares the same token system and theme.*

---

## Product Context

The session detail page is the **investigation surface**. The user arrives here when they need to go beyond the card summary — to read terminal output, debug a CI failure, review and dispatch unresolved comments, or watch an agent work in real-time.

**User intent on arrival:**
1. "What is this agent actually doing right now?" → terminal
2. "Why is CI failing?" → CI check details + terminal logs
3. "There are review comments — let me dispatch them to the agent" → PR card comment list
4. "The agent is stuck — let me see the last output" → terminal

The session detail page is a **single-task focused view**, not a dashboard. The terminal dominates. Everything above it provides context, not content.

**Primary navigation pattern**: User comes from dashboard card → clicks "terminal" link or session ID → lands here → returns to dashboard via back link. The page must support this flow without friction.

---

## Layout Architecture

```
┌─ Nav bar ───────────────────────────────────────────────────────────────┐
│  ← CAHI                                                   │
└─────────────────────────────────────────────────────────────────────────┘

┌─ Header ────────────────────────────────────────────────────────────────┐
│  cahi-58  [● Active]                                                      │
│  Implement UI/UX research dashboard                                     │
│  [project-id] · [#104] · [session/cahi-58] · [INT-58]                    │
│  Working · Created 2h ago · Active 3m ago                               │
└─────────────────────────────────────────────────────────────────────────┘

┌─ PR Card (conditional) ─────────────────────────────────────────────────┐
│  PR #104: Implement UI/UX research dashboard             +142 -23       │
│  ─────────────────────────────────────────────────────────────────────  │
│  Issues:  ✗ CI failing — 2 checks failed                               │
│           ○ Not approved — awaiting reviewer                            │
│                                                                         │
│  CI CHECKS                                                              │
│  [▶ lint] [▶ typecheck] [✗ test] [✗ build]                             │
│                                                                         │
│  UNRESOLVED COMMENTS (3)                                                │
│  ▶ Missing error handling · equinox   [view →]                         │
│    packages/web/src/...                                                 │
│    "Consider wrapping this..."                                          │
│    [Ask Agent to Fix]                                                   │
└─────────────────────────────────────────────────────────────────────────┘

┌─ Terminal ──────────────────────────────────────────────────────────────┐
│  TERMINAL                                                               │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ ● cahi-58  Connected  XDA             [fullscreen]                    │ │
│ │─────────────────────────────────────────────────────────────────────│ │
│ │                                                                     │ │
│ │  $ claude --dangerously-skip-permissions                            │ │
│ │  ✻ Thinking...                                                      │ │
│ │  ⎿ Reading packages/web/src/components/Dashboard.tsx                │ │
│ │                                                                     │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

**Proportions**: Nav 40px · Header ~100px · PR Card 0–240px (hidden if no PR) · Terminal fills the rest. On a 900px-tall viewport without a PR, the terminal gets ~720px.

**Max content width**: `900px` (narrower than dashboard's `1100px` — this is a focused single-session view, not a grid).

---

## Component Designs

### Navigation Bar

```css
/* Current implementation matches recommendation */
height: 40px;
background: var(--bg-surface);       /* #141419 recommended, currently --color-bg-secondary */
border-bottom: 1px solid var(--border-subtle);
padding: 0 32px;
```

**Back link**: `← CAHI` in `--text-secondary`. On hover: `--text-primary`. No underline, `tracking-wide`.

**Addition (not currently present)**: Show current session ID as a breadcrumb:
```
← CAHI  /  cahi-58
```
`cahi-58` in monospace, `--text-muted`. Helps orient the user without reading the header.

---

### Header

**Session ID line:**
```
[session-id in 20px semibold]  [● Activity Badge]
```

Activity badge: `rounded-full`, 10px font, `color-mix` background at 15% opacity. This matches the current implementation but benefits from the CSS dot replacing the emoji:

| Current | Recommended |
|---------|-------------|
| `⚡ Active` | `● Active` — 8px green CSS dot + "Active" label |
| `🟢 Ready` | `● Ready` — 8px blue CSS dot |
| `😴 Idle` | `● Idle` — 8px muted CSS dot |
| `❓ Waiting for input` | `● Waiting for input` — 8px amber dot |
| `🚧 Blocked` | `● Blocked` — 8px red dot |
| `💀 Exited` | `○ Exited` — 8px hollow/dark circle (terminated state recedes) |

**Summary line**: 14px, `--text-secondary`, `mt-2`. Truncate at 2 lines.

**Meta chips**: Current implementation uses `--bg-tertiary` pill backgrounds. This is correct. Font size 11px for branch (monospace), 12px for other chips.

```css
.meta-chip {
  background: var(--bg-elevated);    /* #1C1C25 */
  border-radius: 4px;                /* --radius-4 for small chips */
  padding: 2px 8px;
  font-size: 11px;
  color: var(--text-secondary);
  text-decoration: none;
}
.meta-chip:hover { color: var(--text-primary); }
.meta-chip--mono { font-family: var(--font-mono); font-size: 11px; }
```

**Status / timestamps line**: `--text-muted`, `text-xs`. Dots as separators. Currently implemented with `relativeTime()` helper — correct.

---

### PR Card

The PR card is a mini-dashboard for this session's PR. It contains three logically separate sub-sections:

**1. Title row** (always visible):
```
PR #104: Implement UI/UX research dashboard        +142  -23
```
- Title: `14px medium`, `--text-primary`, links to PR URL
- Stats: `+additions` in `--status-ready` (`#22C55E`), `-deletions` in `--status-error` (`#EF4444`)
- Draft badge: `--text-muted semibold`. Merged badge: `--accent-violet` (current `#bc8cff`).

**2. Merge readiness / issues section:**

*Ready state:* Single green line `✓ Ready to merge` — should dominate visually. This should be a distinct banner rather than a small text line:
```css
.merge-ready-banner {
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.2);
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
/* CheckCircle2 icon 16px + "Ready to merge" in 13px/600 green */
```

*Issues list:* Matches current implementation well. Icons `✗` (red), `●` (amber), `○` (muted) are semantically clear. Consider switching to Lucide icons (`XCircle`, `Clock`, `Circle`) for consistency with the icon system.

**3. CI Checks section:**

```
CI CHECKS
[✓ lint] [✓ typecheck] [✗ test failed →] [✗ build failed →]
```

- Passing check: `--bg-elevated` background, `--status-ready` text, `CheckCircle2` 12px
- Failed check: `rgba(--status-error, 0.12)` background, `--status-error` text, `XCircle` 12px, **links to check URL**
- When failures exist: expand to full list (current `layout="expanded"` behavior — correct)
- When all pass: inline collapsed row (current `layout="inline"` behavior — correct)

**4. Unresolved Comments section:**

The `<details>` / `<summary>` accordion pattern is correct for this use case. Visual refinements:

```
▶ Missing error handling  · equinox        [view →]
  packages/web/src/components/Dashboard.tsx
  ┊ "Consider wrapping this fetch() call in a try/catch..."

  [Ask Agent to Fix]
```

- Chevron: `▶` rotates to `▼` on open — use `transition-transform` (current `group-open:rotate-90` — correct)
- `c.path` in monospace, `--text-muted`, 10px
- Comment body: left-border (`2px solid --border-default`), `pl-3`, `--text-secondary` — current implementation correct
- "Ask Agent to Fix" button states:

| State | Background | Text |
|-------|-----------|------|
| Default | `--accent` (`#5B7EF8`) | white |
| Sending... | `--accent` at 70% opacity, disabled | white |
| Sent! (3s) | `--status-ready` (`#22C55E`) | white |
| Failed (3s) | `--status-error` (`#EF4444`) | white |

*Current implementation uses `--color-accent-blue`, `--color-accent-green`, `--color-accent-red` for these states — semantically correct, will just need color token update.*

**Card border-radius**: Current is `rounded-lg` (8px). This matches the brief's `--radius-8` for panels — correct for a card of this complexity.

---

### Terminal Panel

The terminal is rendered via `DirectTerminal.tsx` (xterm.js + WebSocket). Design refinements:

**Terminal chrome (the top bar):**

Current:
```
[● green] cahi-58  Connected  XDA        [fullscreen]
```

Recommended additions:
```
[● green] cahi-58  Connected  [XDA]      ────────────  [↕ fullscreen]
```

- Connection status dot: green/red/amber pulsing — current correct, uses CSS classes from design token colors
- Session ID: `--font-mono`, `--text-muted`, `12px` — current correct
- Status text: uppercase, `tracking-wide`, semantic color — current correct
- XDA badge: keep as-is, explains the clipboard feature (useful for power users)
- Divider: `flex: 1` spacer pushing fullscreen button to the right — better than `ml-auto`
- Fullscreen button: `↕` icon (Lucide `Maximize2` / `Minimize2`) instead of text label. Or text is fine — don't over-engineer.

**Terminal area:**

Current xterm.js config:
```typescript
{
  background: "#000000",       // pure black
  foreground: "#ffffff",
  cursor: "#ffffff",
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace'
}
```

Recommended:
```typescript
{
  background: "#0A0A0F",       // slightly off-black, matches brief's terminal bg
  foreground: "#D4D4D8",       // warmer white (VS Code-style)
  cursor: "#5B7EF8",           // brand blue distinguishes cursor from content
  cursorAccent: "#0A0A0F",
  selection: "rgba(91, 126, 248, 0.3)",
  fontSize: 13,                // 13px recommended (current 14px is fine too)
  fontFamily: '"JetBrains Mono", "SF Mono", Menlo, Monaco, monospace'
}
```

*The pure black `#000000` is jarring against the dark surface background when the terminal doesn't fill the frame. `#0A0A0F` is less stark and harmonizes.*

**Height:**
- Normal: `600px` (current) — fine for most viewports
- Fullscreen: `calc(100vh - 40px)` (current, height minus chrome bar) — correct
- **Consideration**: `600px` fixed height means on a 768px laptop, terminal is cut short and page still scrolls. Consider `max(400px, calc(100vh - 360px))` to fill remaining viewport. On 900px viewport with no PR: terminal gets ~760px. With PR: terminal gets ~400px. Both reasonable.

---

## Page States

| State | Behavior |
|-------|---------|
| Loading | Full-screen centered spinner: `text-sm text-[--text-muted] "Loading session..."`. No skeleton — the terminal itself will show connecting state |
| Error / 404 | Full-screen centered red error text. Add link back to dashboard |
| No PR | PR Card section hidden entirely. Terminal moves up. |
| PR merged | PR Card shows with purple "Merged" badge. Terminal still usable. |
| Session exited | Activity badge: `● Exited` (red). Terminal shows last output (disconnected state). Restore button visible |
| Fullscreen | Nav and header hidden (`position: fixed; inset: 0`). Only terminal. `?fullscreen=true` in URL |

---

## Current Implementation Audit

### What's already correct

- Nav bar structure and back link ✅
- Activity badge with color-mix backgrounds ✅
- Meta chips (project, PR #, branch, issue) ✅
- Relative timestamps (`relativeTime()` helper) ✅
- PR title + diff stats line ✅
- IssuesList with semantic icons ✅
- CI check list with expanded/inline layout modes ✅
- `<details>` accordion for unresolved comments ✅
- "Ask Agent to Fix" with sending/sent/error states ✅
- XDA terminal clipboard support ✅
- Fullscreen mode with URL sync ✅
- 5-second polling for session updates ✅

### Design deltas (priority order)

| Priority | Change | File | Notes |
|----------|--------|------|-------|
| 1 | Breadcrumb in nav: `← CAHI / cahi-58` | `SessionDetail.tsx` | Orientation |
| 2 | Activity indicator: CSS dot instead of emoji | `SessionDetail.tsx` — `activityLabel` map | Visual precision |
| 3 | "Ready to merge" → banner card instead of text line | `SessionDetail.tsx` — `PRCard` | Primary action prominence |
| 4 | Terminal theme: `#0A0A0F` bg, `#5B7EF8` cursor, JetBrains Mono | `DirectTerminal.tsx` | Terminal quality |
| 5 | Terminal height: dynamic `calc(100vh - Npx)` instead of fixed `600px` | `DirectTerminal.tsx` | Viewport utilization |
| 6 | Meta chip border-radius: `4px` instead of `rounded-md` (6px) | `SessionDetail.tsx` | Token consistency |
| 7 | Color tokens: update to recommended palette when `globals.css` is updated | All | Follows main dashboard token migration |

---

*Companion document to `design-brief.md`. Same token system, same typography, same component style.*
*Compiled February 2026.*
