<!-- Source: awesome-design-md / linear.app — https://github.com/VoltAgent/awesome-design-md -->
<!-- Adapted for AX's AI RADAR — cyan-neon palette + radar/sweep motion grammar replaces Linear's indigo and stillness. -->

# AX's AI RADAR — Design System

> A dark-mode-native AI intelligence radar. Linear's architecture for the shell, a cyan-neon accent for the active sensor, and a bilingual-first typography stack.

---

## 1. Visual Theme & Atmosphere

AX's AI RADAR extends Linear's dark-first architecture into a slightly cooler, more aquatic palette. The canvas is a deep blue-black (`#0a0d14`) rather than Linear's warm near-black — this evokes *observatory + sensor deck* rather than *issue tracker*. Content emerges through luminance stepping (background opacity stacks from `0.02` → `0.05`) and is punctuated by a single brand accent: **neon cyan `#3ee6e6`**, reserved for primary actions, active navigation, score highlights, the radar sweep, and detected blips. Every primary interactive element gets a soft cyan glow (`0 0 24px rgba(62,230,230,0.18)`) — the only chromatic illumination in the system. Motion grammar is **slow + mechanical**: a 4-second radar sweep, a 3-second pulse on featured cards, a 12-second orbit on the logo. Never flashy, always alive.

Typography is Inter Variable with OpenType features `"cv01", "ss03"` enabled globally, at signature weight 510 for UI emphasis. Because the radar is **bilingual-first (zh primary, en secondary)**, the CJK fallback chain is non-optional: `"PingFang SC", "Noto Sans SC", "Microsoft YaHei"`. Monospace uses JetBrains Mono (open-source alternative to Berkeley Mono) for the diff viewer, agent console, and numeric timestamps.

**Key Characteristics:**
- Dark-mode-native: `#0a0d14` page canvas, `#0f1420` panel/sidebar, `#111a2b` elevated card.
- Inter Variable + `"cv01", "ss03"` globally; JetBrains Mono for code/diffs/timestamps.
- CJK fallback: `"PingFang SC", "Noto Sans SC", "Microsoft YaHei"`.
- Signature weight **510** for most UI text; **400** for long-form Chinese summaries (better rendering).
- **Neon cyan accent** `#3ee6e6` — the only chromatic color in the chrome.
- Subtle cyan glow on primary + active states; soft 1px semi-transparent white borders.
- Elevation via **luminance stepping**, never drop shadows.
- Timeline rails and status dots replace heavy dividers.

---

## 2. Color Palette & Roles

### Background Surfaces
- **Canvas** (`#0a0d14`): The deepest background — page and layout root. Blue-black with ~2% blue saturation for depth on OLED.
- **Panel** (`#0f1420`): Sidebar, topbar, elevated card base. One luminance step above canvas.
- **Elevated** (`#111a2b`): Story cards, metric cards, modal bodies.
- **Hover** (`#1a2438`): Hover state for rows, cards, and menu items.
- **Selected** (`rgba(62,230,230,0.08)`): Active nav item or selected list row — tinted cyan, not hover-gray.

### Text & Content
- **Primary Text** (`#f0f5fa`): Default heading/body. Not pure white — avoids eye strain on dark.
- **Secondary Text** (`#a8b4c2`): Summaries, descriptions, form labels.
- **Tertiary Text** (`#6b7689`): Metadata, timestamps, placeholder text.
- **Muted Text** (`#4a5361`): Disabled states, very low emphasis captions.

### Brand & Accent
- **Cyan Primary** (`#3ee6e6`): Primary buttons, active nav text + indicator, logo dot, focus ring.
- **Cyan Hover** (`#5ef5f5`): Lighter variant on hover.
- **Cyan Dim** (`#22c7c7`): Text on elevated surfaces where full-brightness cyan would burn.
- **Cyan Glow** (`rgba(62,230,230,0.18)`): 24px blur around active primary elements.
- **Cyan Selected Bg** (`rgba(62,230,230,0.08)`): Background fill for active nav and selected rows.

### Status Colors
- **Positive** (`#22c55e`): Thumbs-up, success toast accent, score pill text.
- **Positive Bg** (`rgba(34,197,94,0.14)`): Score pill background, positive metric highlight.
- **Negative** (`#ef4444`): Thumbs-down, destructive confirmation text.
- **Negative Bg** (`rgba(239,68,68,0.12)`): Diff `-` line background.
- **Warning** (`#f59e0b`): `P1` tag, reserved for priority/attention.
- **Neutral Info** (`#60a5fa`): Informational toasts.

### Borders & Dividers
- **Border Default** (`rgba(255,255,255,0.08)`): Card edge, input border, section divider.
- **Border Subtle** (`rgba(255,255,255,0.05)`): Inline separators, list dividers.
- **Border Cyan** (`rgba(62,230,230,0.3)`): Active input focus ring, primary button border.
- **Rail** (`rgba(255,255,255,0.06)`): Timeline vertical 1px line.

### Diff Viewer Specific
- **Diff Add** (text `#86efac` on bg `rgba(34,197,94,0.06)`).
- **Diff Remove** (text `#fca5a5` on bg `rgba(239,68,68,0.06)`).
- **Diff Context** (text `#6b7689`, bg transparent).

### Overlay
- **Backdrop** (`rgba(5,8,14,0.85)`): Modal/dialog backdrop.

---

## 3. Typography Rules

### Font Stack
```css
--font-sans: "Inter Variable", "PingFang SC", "Noto Sans SC", "Microsoft YaHei",
             -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
--font-feature-settings: "cv01", "ss03";
```

CJK fallback is positioned **before** system sans so Chinese characters render via PingFang/Noto SC (vastly better than whatever happens to be next in the chain).

### Hierarchy
| Role | Size | Weight | Line Height | Letter Spacing | Notes |
|---|---|---|---|---|---|
| Display | 48px | 510 | 1.00 | -1.056px | Hero headlines (rare) |
| Heading 1 | 32px | 510 | 1.13 | -0.704px | Page titles (e.g., `热点资讯`) |
| Heading 2 | 24px | 510 | 1.33 | -0.288px | Section titles (e.g., `最近反馈`) |
| Heading 3 | 20px | 590 | 1.33 | -0.24px | Card titles, story headlines |
| Body Large | 18px | 400 | 1.60 | -0.165px | Summary text (long-form zh reads better at 400 weight) |
| Body | 16px | 400 | 1.50 | normal | Default reading text |
| UI Medium | 16px | 510 | 1.50 | normal | Navigation, button labels |
| Body Small | 15px | 400 | 1.60 | -0.165px | Secondary body, help text |
| Caption | 13px | 400 | 1.50 | -0.13px | Metadata, source meta line, timestamps |
| Label | 12px | 510 | 1.40 | normal | Tag chip, button label, pill |
| Micro | 11px | 510 | 1.40 | normal | Score pill numeric, tiny labels |
| Mono Body | 14px | 400 | 1.50 | normal | Diff viewer, agent console |
| Mono Caption | 13px | 400 | 1.50 | normal | Timestamps in timeline gutter, version tags |

### Principles
- **510 is the signature weight** for UI (nav, buttons, labels, card titles).
- **400 for Chinese long-form** — Chinese characters at 510 become visually heavy; 400 reads better.
- **OpenType features non-negotiable** — `cv01 ss03` on all Inter.
- **Tabular numerals** (`font-variant-numeric: tabular-nums`) on all numeric pills, score badges, timestamps.
- **Negative letter-spacing only at heading sizes** — body text uses normal.

---

## 4. Component Stylings

### Buttons

**Primary (cyan)**
```css
background: #3ee6e6;
color: #0a0d14;
padding: 8px 16px;
border-radius: 6px;
font: 510 14px/1.4 var(--font-sans);
box-shadow: 0 0 24px rgba(62,230,230,0.18), inset 0 0 0 1px rgba(255,255,255,0.2);
hover: background: #5ef5f5; transform: translateY(-1px);
```

**Ghost (default)**
```css
background: rgba(255,255,255,0.03);
color: #f0f5fa;
padding: 8px 16px;
border-radius: 6px;
border: 1px solid rgba(255,255,255,0.08);
hover: background: rgba(255,255,255,0.05);
```

**Icon Button**
```css
width: 32px; height: 32px;
background: transparent;
border-radius: 6px;
hover: background: rgba(255,255,255,0.05);
active: color: #3ee6e6;
```

**Tab Button (filter tabs)**
```css
/* inactive */ background: transparent; color: #6b7689; padding: 6px 12px;
/* active */ background: rgba(62,230,230,0.12); color: #3ee6e6; border: 1px solid rgba(62,230,230,0.3);
border-radius: 9999px;
```

### Cards

**Story Card**
```css
background: rgba(255,255,255,0.02);
border: 1px solid rgba(255,255,255,0.06);
border-radius: 8px;
padding: 16px 20px;
hover: background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1);
transition: all 200ms ease;
/* subtle top-right gradient glow on featured cards */
background-image: radial-gradient(
  circle at top right,
  rgba(62,230,230,0.04),
  transparent 40%
);
```

**Metric Card (big number)**
```css
background: rgba(255,255,255,0.02);
border: 1px solid rgba(255,255,255,0.08);
border-radius: 12px;
padding: 20px 24px;
/* label */ color: #a8b4c2; font: 510 13px/1.4;
/* number */ color: #f0f5fa; font: 510 36px/1.1 var(--font-sans); font-variant-numeric: tabular-nums;
/* caption */ color: #6b7689; font: 400 13px/1.5;
```

**Featured / Hero Card**
```css
background: linear-gradient(135deg, rgba(62,230,230,0.06), transparent 60%), rgba(255,255,255,0.02);
border: 1px solid rgba(62,230,230,0.12);
border-radius: 12px;
padding: 28px 32px;
```

### Inputs

**Search Input**
```css
background: rgba(255,255,255,0.03);
border: 1px solid rgba(255,255,255,0.08);
border-radius: 8px;
padding: 10px 14px 10px 36px; /* icon-aware */
color: #f0f5fa;
focus: border-color: rgba(62,230,230,0.4); box-shadow: 0 0 0 3px rgba(62,230,230,0.1);
placeholder: color: #6b7689;
```

### Badges & Pills

**Score Pill (green numeric)**
```css
background: rgba(34,197,94,0.14);
color: #22c55e;
border-radius: 9999px;
padding: 2px 10px;
font: 510 13px/1.4 var(--font-sans);
font-variant-numeric: tabular-nums;
```

**Tag Chip**
```css
background: rgba(255,255,255,0.05);
color: #a8b4c2;
border-radius: 4px;
padding: 3px 8px;
font: 510 12px/1.4;
```

**Curation Pill (精选)**
```css
background: rgba(62,230,230,0.12);
color: #3ee6e6;
border-radius: 4px;
padding: 3px 8px;
font: 510 11px/1.4;
```

**Version Pill (`v3`)**
```css
background: rgba(34,197,94,0.14);
color: #22c55e;
border-radius: 4px;
padding: 3px 8px;
font: 510 11px/1.4 var(--font-mono);
```

**P1 Priority Pill**
```css
background: rgba(245,158,11,0.14);
color: #f59e0b;
border-radius: 9999px;
padding: 2px 8px;
font: 510 11px/1.4;
```

### Navigation (Sidebar)

```css
/* base */
background: #0f1420;
border-right: 1px solid rgba(255,255,255,0.06);
width: 192px;
padding: 20px 12px;

/* nav item */
height: 36px;
padding: 0 12px;
border-radius: 6px;
display: flex; align-items: center; gap: 10px;
color: #a8b4c2;
font: 510 14px/1 var(--font-sans);

/* nav item hover */
background: rgba(255,255,255,0.04);
color: #f0f5fa;

/* nav item active */
background: rgba(62,230,230,0.08);
color: #3ee6e6;
box-shadow: inset 2px 0 0 #3ee6e6, 0 0 18px rgba(62,230,230,0.12);
```

### Timeline

**Rail**
```css
position: relative;
/* vertical line */
::before {
  content: '';
  position: absolute;
  left: 80px; /* gutter width */
  top: 0; bottom: 0;
  width: 1px;
  background: rgba(255,255,255,0.06);
}
```

**Timestamp Gutter**
```css
width: 80px;
font: 510 14px/1 var(--font-mono);
color: #f0f5fa;
font-variant-numeric: tabular-nums;
padding-top: 4px;
text-align: right;
padding-right: 20px;
```

**Rail Dot**
```css
position: absolute;
left: 76px; /* centers on rail */
top: 12px;
width: 9px; height: 9px;
border-radius: 50%;
background: #0a0d14;
border: 2px solid #22c7c7;
```

### Agent Console

```css
background: rgba(0,0,0,0.35);
border: 1px solid rgba(255,255,255,0.06);
border-radius: 8px;
padding: 16px 20px;
font: 400 14px/1.7 var(--font-mono);

/* bullet line */
display: flex; gap: 10px; align-items: baseline;
.dot { width: 6px; height: 6px; border-radius: 50%; }
.dot.info { background: #22c7c7; }
.dot.reading { background: #f59e0b; }
.dot.done { background: #6b7689; }
```

### Diff Viewer

```css
background: rgba(0,0,0,0.3);
border: 1px solid rgba(255,255,255,0.06);
border-radius: 8px;
font: 400 13px/1.7 var(--font-mono);

/* lines */
.line-add     { background: rgba(34,197,94,0.06);  color: #86efac; border-left: 2px solid #22c55e; }
.line-remove  { background: rgba(239,68,68,0.06);  color: #fca5a5; border-left: 2px solid #ef4444; }
.line-context { color: #6b7689; border-left: 2px solid transparent; }
.line { padding: 1px 12px 1px 14px; }
.line-prefix { width: 14px; display: inline-block; opacity: 0.7; }
```

### Feedback Controls

```css
display: flex; gap: 4px;
/* thumb up */
.thumb-up    { color: #6b7689; hover: color: #22c55e; active: color: #22c55e; }
.thumb-down  { color: #6b7689; hover: color: #ef4444; active: color: #ef4444; }
.bookmark    { color: #6b7689; hover: color: #f59e0b; active: color: #f59e0b; fill: currentColor; }
/* each is 28x28 icon button, no background */
```

---

## 5. Layout Principles

### Grid
- **Shell**: 192px sidebar (fixed) + flex main content.
- **Main content max-width**: 1280px, centered within available area.
- **Page gutter**: 24px (desktop), 16px (tablet).
- **Card-to-card vertical rhythm**: 12px for timeline, 20px for dashboard grids.
- **Metric row**: 3-column grid, 20px gap.

### Spacing
Base 4px grid. Scale: `0 — 4 — 8 — 12 — 16 — 20 — 24 — 32 — 48 — 64`.

### Radius Scale
- **Micro** 2px: tag chip corners on dense lists.
- **Small** 4px: tag chips, curation pills.
- **Comfortable** 6px: buttons, nav items, inputs.
- **Card** 8px: story cards, agent console, diff viewer.
- **Panel** 12px: hero card, metric card, modal.
- **Pill** 9999px: score pills, filter tabs, priority pills.
- **Circle** 50%: status dots, logo orbit dot.

### Whitespace philosophy
- **The canvas IS the whitespace**. Generous dark negative space between sections — 48px between major blocks, 24px between sub-sections.
- **Story cards breathe**: 16/20 vertical/horizontal padding, 12px between cards on the timeline.
- **Headings sit with air above them** — 32px above an h2, 24px above h3.

---

## 6. Depth & Elevation

Elevation is luminance stepping + cyan-tinted glow for active elements. No drop shadows.

| Level | Treatment | Use |
|---|---|---|
| 0 Canvas | `#0a0d14` bg, no border | Page background |
| 1 Panel | `#0f1420` bg | Sidebar, topbar |
| 2 Card | `rgba(255,255,255,0.02)` bg + `rgba(255,255,255,0.06)` border | Story card, sources row |
| 3 Elevated | `#111a2b` bg + `rgba(255,255,255,0.08)` border | Metric card, modal body |
| 4 Glow Active | +`0 0 18–24px rgba(62,230,230,0.12–0.2)` | Primary button, active nav, focused input |
| 5 Featured | +`linear-gradient(135deg, rgba(62,230,230,0.06), transparent 60%)` | Hero card (策略迭代 top), featured story |

---

## 7. Do's and Don'ts

### Do
- Use Inter Variable with `cv01 ss03` on every text element.
- Use **weight 510 for UI**, **400 for Chinese long-form** (summaries, notes).
- Reserve cyan (`#3ee6e6`) for primary interactive surfaces and logo.
- Use `font-variant-numeric: tabular-nums` on every numeric pill and timestamp.
- Use elevation-via-luminance (`0.02 → 0.04 → 0.06`) — never solid colored cards.
- Borders semi-transparent white: `0.05 – 0.08`.
- CJK fallback chain must be `"PingFang SC", "Noto Sans SC"` BEFORE system sans.
- Glow on primary + active states: `0 0 24px rgba(62,230,230,0.18)`.
- Diff viewer + agent console + numeric gutter use **JetBrains Mono**.

### Don't
- Don't use pure `#ffffff` as primary text — use `#f0f5fa`.
- Don't apply cyan decoratively — it's reserved for interaction, active state, and score highlights.
- Don't use weight 600+ on Chinese text — 590 max for headings, 510 for UI.
- Don't use solid borders on dark surfaces — always semi-transparent white (except focus ring).
- Don't use drop shadows for elevation — use luminance stepping.
- Don't forget `cv01 ss03` OpenType features — without them Inter looks generic.
- Don't hard-code CJK fonts without including Inter first — Latin still leads the stack.
- Don't use red outside of negative feedback and diff-remove lines.

---

## 8. Responsive Behavior

### Breakpoints
| Name | Width | Key changes |
|---|---|---|
| Mobile | <768px | Sidebar becomes bottom tab bar; timeline collapses timestamp to inline caption |
| Tablet | 768–1024px | Sidebar narrows to icon-only (48px); 2-column metric grid |
| Desktop | 1024–1440px | Full sidebar (192px), 3-column metric grid, 1280px content max |
| Wide | >1440px | Same as desktop with larger side gutters |

### Collapsing strategy
- Timeline rail removes vertical line on mobile; timestamps inline above card.
- Story-card tag row wraps to 2 rows on narrow viewports.
- Diff viewer becomes horizontally scrollable (no wrap) on mobile — monospace grid must hold.

---

## 9. Agent Prompt Guide

### Quick reference
- **Canvas bg**: `#0a0d14`
- **Panel bg**: `#0f1420`
- **Card bg**: `rgba(255,255,255,0.02)` with `rgba(255,255,255,0.06)` border, 8px radius
- **Primary cyan**: `#3ee6e6` (text on dark: use `#22c7c7` for adequate contrast on elevated bg)
- **Primary text**: `#f0f5fa`; **secondary**: `#a8b4c2`; **meta**: `#6b7689`
- **Positive**: `#22c55e` on `rgba(34,197,94,0.14)` bg
- **Negative**: `#ef4444` on `rgba(239,68,68,0.12)` bg
- **Warning / P1**: `#f59e0b`
- **Font**: `Inter Variable` + CJK fallback, features `"cv01", "ss03"`; **mono** JetBrains Mono
- **Sig weight 510**; Chinese summary body at 400
- **Radius** 6 / 8 / 12 / pill / circle
- **Glow** `0 0 24px rgba(62,230,230,0.18)` on primary/active

### Example prompts
- *"Build a story card: dark elevated surface (`rgba(255,255,255,0.02)` bg, `rgba(255,255,255,0.06)` border, 8px radius, 16px padding). Source meta caption 13px color `#6b7689`. Title 20px weight 590, letter-spacing -0.24px, color `#f0f5fa`. Summary 15px weight 400 color `#a8b4c2` line-height 1.6. Tag chips below. Score pill top-right: `rgba(34,197,94,0.14)` bg, `#22c55e` text, pill radius, tabular-nums."*
- *"Build a cyan primary button: `#3ee6e6` bg, `#0a0d14` text, 8px 16px padding, 6px radius, 14px weight 510. Glow `0 0 24px rgba(62,230,230,0.18)`, hover bg `#5ef5f5`."*
- *"Build the sidebar active nav item: `rgba(62,230,230,0.08)` bg, `#3ee6e6` text, 6px radius, 2px inset-left cyan bar, 0 0 18px rgba(62,230,230,0.12) glow."*
- *"Build the diff viewer: JetBrains Mono 13px line-height 1.7, dark bg `rgba(0,0,0,0.3)`. `+` lines `rgba(34,197,94,0.06)` bg with `#86efac` text + 2px left border `#22c55e`. `-` lines mirror in red."*

### Iteration Guide
1. All Inter text gets `font-feature-settings: "cv01", "ss03"`.
2. CJK fallback must come BEFORE generic system-sans.
3. UI text 510, Chinese long-form 400.
4. Cyan is interaction-only — never decoration.
5. Elevation via `rgba(255,255,255, 0.02 → 0.04 → 0.06)`; add cyan glow for "active".
6. Tabular-nums on every numeric token.
7. JetBrains Mono for diffs, agent logs, timeline timestamps, version pills.
