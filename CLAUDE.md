# CLAUDE.md — Flowra

Project-specific guidance. Global rules (language, commit style, commit workflow) live in `~/.claude/CLAUDE.md`.

## Stack

- **React 19** + **Vite 7** (ESM, `type: module`)
- **Tailwind v4** for utility classes (compiled via `@tailwindcss/cli`)
- Inline `styles` object pattern in `personal_finance_cashflow_simulator.jsx` for the main app — Tailwind is used for grid / spacing helpers, the styles object handles the component-level styling
- **Supabase** (`@supabase/supabase-js`) for cloud sync — see `lib/flowraSupabase.js`
- **dnd-kit** for drag-sort in lists
- **recharts** for charts
- **xlsx**, **jspdf**, **html-to-image** for export (XLSX / PDF / PNG)
- **pnpm** workspace, Node-driven dev scripts

## Commands

```bash
pnpm dev           # Vite dev server on 127.0.0.1
pnpm build:web     # production build
pnpm preview       # serve the built output
pnpm build:css     # rebuild styles/flowra.css from styles/flowra.tailwind.css
pnpm build:check   # esbuild smoke bundle (fast syntax / type-of-bundle check)
```

`pnpm build:check` is the fastest way to confirm the JSX still compiles after edits — prefer it over a full Vite build during iterative work.

## Layout

- `personal_finance_cashflow_simulator.jsx` — the entire main app (single-file React component). Contains the `styles` object, all sub-components (charts, pickers, item rows, modals), and the default export.
- `index.html` / `main.jsx` — Vite entry
- `components/ui/chart.jsx` — recharts wrappers + `CHART_THEME_VARS` (chart palette CSS vars)
- `lib/flowraSupabase.js` — Supabase client + auth/sync helpers
- `lib/templates/index.js` — default scenario template
- `styles/flowra.tailwind.css` — Tailwind source (regenerate `flowra.css` via `pnpm build:css`); do NOT hand-edit `flowra.css`
- `supabase/migrations/` — schema migrations

## Conventions

- **Locale**: UI text is Traditional Chinese (zh-TW). Currency is NT$ (TWD), formatted via `currency()` / `maskCurrency()` helpers in the main file.
- **Months**: stored as `YYYY-MM` strings; manipulate via `addMonths` / `parseYearMonth` / `formatMonthLabel` helpers.
- **Effects style**: the app deliberately avoids 3D / shadow / gradient effects — flat surfaces, slate-grey neutrals, semantic colors only for data (`#16a34a` income green, `#dc2626` expense red, `#0284c7` sky for accents). When adding UI, follow this flat aesthetic.
- **Animations**: use the iOS-style ease `cubic-bezier(0.32, 0.72, 0, 1)` at `300ms` for expand/collapse via the `Collapsible` component (CSS Grid `grid-template-rows: 0fr ↔ 1fr` trick).
- **Icons**: prefer inline SVG with `currentColor` strokes so they inherit theme color. See `Chevron`, `DownloadIcon`, drag-grip SVG for examples.
- **Drag handles**: discreet by default (low opacity, no border), fade in on `.flowra-sortable-item:hover`.

## Editing notes

- `personal_finance_cashflow_simulator.jsx` is large (~3000 lines). Use targeted `Edit` calls; avoid full rewrites.
- `app/static/test_page.html`-style pages do not exist here — UI lives in the React component.
- Cloud features short-circuit when `isSupabaseConfigured()` is false; keep that gating intact when changing auth/sync code.
- The `<style>{`...`}</style>` block embedded inside the main JSX (inside the report container) holds `.flowra-*` hover and animation rules — update it when adding new interactive surfaces.
