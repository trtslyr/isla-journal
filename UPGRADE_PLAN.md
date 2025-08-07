### Isla Notes – Upgrade Plan (Local, Private, Obsidian‑lite with Ollama RAG)

Objective: Evolve this app into a bulletproof, local‑first notes app (vault‑based Markdown, Bear/MarkText‑clean UI) with built‑in Ollama RAG. Keep everything offline by default.

---

## Phase 0 — Ground rules and goals

- Keep stack: Electron + React + Vite, `better-sqlite3`, Ollama.
- User selects a vault directory. We index recursively, watch changes, and retrieve with hybrid search (FTS5 + embeddings when available).
- Security: production‑safe Electron defaults, minimal IPC surface, contextIsolation.
- Simplicity yet power: clean UI, fast editor, instant search, “Ask your notes” with clear sources.

---

## Phase 1 — Security, IPC, and Data Integrity (Day 1–2)

- Electron security (in `src/main/index.ts`)
  - In production: `webSecurity: true`, remove `allowRunningInsecureContent`, keep `contextIsolation: true`, `nodeIntegration: false`.
  - Do not auto‑open DevTools in prod. Use file logging instead.
  - Add CSP meta to `src/renderer/index.html`:
    ```html
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: file:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' http://127.0.0.1:11434">
    ```

- IPC fixes (align preload ↔ main)
  - Preload: make `answerQuestion` call `content:searchAndAnswer` (or remove if unused).
  - Either implement `chat:clearMessages` or remove from preload.
  - Pass `limit` through for `searchContent(query, limit?)` (preload and main handler).
  - Align `file:createFile` signatures (remove extra `content` arg in preload or add support in main).

- File system ↔ DB integrity
  - Implement DB helpers in `src/main/database/db.ts`:
    - `deleteFileByPath(filePath: string)`
    - `updateFilePath(oldPath: string, newPath: string, newName?: string)`
  - Call them from main IPC handlers:
    - On delete: remove DB rows for files and chunks.
    - On rename/move: update the single record instead of re‑save; keep content/chunks.

- Logging
  - Gate verbose logs behind `process.env.DEBUG`; write production logs to a rotating file in userData.

Checklist
- [ ] Re‑enable prod web security; remove devtools in prod
- [ ] CSP meta added
- [ ] IPC route mismatches fixed
- [ ] DB delete/rename/move implemented
- [ ] Logs gated and file‑based in prod

---

## Phase 2 — Retrieval: FTS5 + Date‑aware RAG (Day 3–5)

- SQLite schema upgrades (add migrations in `db.ts`)
  - Files: add `file_mtime DATETIME` and `note_date DATE` columns.
  - Create an FTS5 virtual table for chunk text with content=content_chunks:
    ```sql
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      chunk_text,
      file_id UNINDEXED,
      content='content_chunks', content_rowid='id'
    );
    ```
  - Maintain FTS with triggers or manual upserts when updating chunks.

- Chunking and indexing
  - On save/index: set `file_mtime` from real FS mtime; derive `note_date` from filename/frontmatter/first date heading if present.
  - After chunk updates, sync `chunks_fts` for those chunk rows.

- Ranked search API
  - Implement `searchContentFTS(query: string, limit = 20, dateRange?: {start: Date, end: Date})` using FTS5 with BM25 and `snippet()` for highlights.
  - Boost rules: title/header matches > body; newer notes slight boost.

- Lightweight date parsing
  - Add `extractDateFilter(query: string): { start: Date; end: Date } | null` (supports ISO dates and relative: today/yesterday/last N days/week/month; see snippet below).
  - If date filter present, prefilter by `note_date` OR `file_mtime` in `[start, end)` before FTS.

- General, conversational prompt (notes‑focused)
  - Build blocks in `ContentService.searchAndAnswer`:
    - `PINNED_BLOCK` (up to 5 short snippets)
    - `DATE_SCOPED_BLOCK` (chronological snippets if a date range was detected)
    - `RETRIEVED_BLOCK` (top‑k ranked snippets from FTS/embeddings)
  - Template:
    ```text
    You are a concise, friendly assistant for the user's local notes.
    Today is {TODAY} (timezone: {TZ}).

    Context from notes:
    {PINNED_BLOCK}
    {DATE_SCOPED_BLOCK}
    {RETRIEVED_BLOCK}

    User’s request: {QUERY}

    Instructions:
    - Prefer the supplied context; cite filenames.
    - Keep answers tight (2–4 short paragraphs; bullets for steps).
    - If context is sparse, say so and suggest next steps or date ranges.
    - If the request implies dates, prioritize those notes.
    - End with 1–2 helpful follow‑ups.
    ```

Snippet: date extractor (TS)
```ts
export type DateFilter = { start: Date; end: Date } | null
export function extractDateFilter(qIn: string, now = new Date()): DateFilter {
  const q = qIn.toLowerCase()
  const iso = q.match(/\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/)
  if (iso) {
    const y = +iso[1], m = +iso[2]-1, d = iso[3] ? +iso[3] : 1
    const start = new Date(Date.UTC(y,m,d))
    const end = iso[3] ? new Date(Date.UTC(y,m,d+1)) : new Date(Date.UTC(y,m+1,1))
    return { start, end }
  }
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const today = startOfDay(now)
  if (q.includes('today')) return { start: today, end: new Date(+today + 86400000) }
  if (q.includes('yesterday')) { const y = new Date(+today - 86400000); return { start: y, end: today } }
  if (q.includes('last week')) return { start: new Date(+today - 7*86400000), end: today }
  const m = q.match(/last (\d+)\s*days?/) ; if (m) { const n = Math.min(365, +m[1]||7); return { start: new Date(+today - n*86400000), end: today } }
  return null
}
```

Checklist
- [ ] DB columns added; FTS5 table + triggers/upserts
- [ ] Date extractor implemented and used in retrieval
- [ ] Ranked search with highlights; API returns filename, path, snippet, score
- [ ] Prompt refactored to general notes assistant with blocks

---

## Phase 3 — Embeddings (Local‑only) & Hybrid Retrieval (Day 6–8)

- Table: `embeddings` (chunk_id INTEGER PRIMARY KEY, vector BLOB/JSON, dim INTEGER, model TEXT, created_at DATETIME)
- Generation:
  - Use Ollama embeddings endpoint for each chunk text; store vectors.
  - Run in a background worker (Node worker_threads or child process) to avoid blocking the main process; send progress via IPC.
  - Compute lazily: on demand for new/changed chunks; batch on idle.
- Retrieval pipeline:
  1) If embeddings available: compute query vector → cosine similarity over stored vectors (in JS, memory‑mapped or simple scan for small vaults).
  2) Union with FTS5 top‑k; de‑dupe by chunk/file; re‑rank (e.g., weighted score: 0.6 sim + 0.4 BM25 + recency boost).
  3) Build `RETRIEVED_BLOCK` from final top‑k with short snippets and clickable file refs.
- Graceful fallback: if embeddings unavailable, use FTS5 only.

Checklist
- [ ] `embeddings` table + worker to (re)build
- [ ] Cosine similarity + hybrid union/re‑rank
- [ ] Progress IPC and settings to choose embedding model

---

## Phase 4 — UI Facelift (Bear/MarkText‑clean) (Day 9–12)

- Layout
  - Three panes: `Sidebar` (filters/tags), `NoteList` (cards), `EditorPane` (toolbar + editor). Keep 240px / 360px / flexible layout.
  - Center editor content area to ~800px max width; line‑height ~1.6.

- Design tokens (CSS variables)
  ```css
  :root{
    --bg:#0f1115; --surface:#171a21; --muted:#8b91a1; --text:#e6e9ef;
    --card:#1b1f27; --border:#20232b; --accent:#5b8cff;
    --radius:12px; --shadow:0 4px 16px rgba(0,0,0,.25);
    --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-6:24px;
    --content-max:820px;
  }
  .panel{background:var(--surface); border-right:1px solid var(--border)}
  .note-card{background:var(--card); border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow)}
  .prose{max-width:var(--content-max); margin:0 auto; color:var(--text); line-height:1.6}
  .ghost-btn{background:transparent; border:0; color:var(--muted)}
  .ghost-btn:hover{color:var(--text); background:rgba(255,255,255,.04); border-radius:8px}
  ```

- Editor
  - Monaco remains “Source” mode; add a simple toolbar (BIU, link, list, code, checklist) and optional live preview toggle.
  - Keyboard shortcuts: Cmd/Ctrl+N (new), Cmd/Ctrl+P (quick open), Cmd/Ctrl+S (save), Cmd/Ctrl+F (search), Cmd/Ctrl+K (link).

- Notes list
  - Card items with 12px radius, hover, clamped preview (2–3 lines), tiny timestamp; virtualize when long.

- AI panel
  - Stream responses; display source chips (filename) that open file and scroll to the snippet.
  - Context controls (Settings): max sources, recency bias, pinned weight, system prompt, temperature.

Checklist
- [ ] Tokens + layout applied; components split out of `App.tsx`
- [ ] Toolbar + preview; shortcuts
- [ ] Virtualized NoteList; clean empty states & skeletons
- [ ] AI streaming + clickable sources

---

## Phase 5 — Watcher, Packaging & Cleanup (Day 13–14)

- File watcher
  - Use `chokidar` to watch the vault (include/exclude globs: ignore `.git`, `node_modules`, images, etc.).
  - On add/change: update or (re)chunk and enqueue embeddings; on unlink: delete DB rows; on move/rename: update path.
  - Debounce bursts; cap file size; skip binaries.

- Dependencies & packaging
  - Remove unused deps (`express`, `cors`, `dotenv`, `stripe`…) to shrink artifacts.
  - Stick with Electron Forge makers (already configured); drop duplicate `electron-builder` config if not needed.
  - Keep ASAR on; ensure native module rebuilds in CI remain.

- Licensing & privacy
  - Optionally store license key in OS keychain; keep cached validation separately.
  - No telemetry by default; optional “write diagnostics to file”.

Checklist
- [ ] Watcher with ignore rules + debounced indexing
- [ ] Pruned dependencies
- [ ] CI/packaging simplified and stable
- [ ] Optional keychain storage

---

## Implementation Notes (file map)

- `src/main/index.ts`
  - Security flags; remove prod devtools; CSP is in renderer HTML.
  - Add IPC: embeddings worker progress; search limit passthrough; date status if needed.

- `src/preload/index.ts`
  - Align methods and signatures; add `searchContent(query: string, limit?: number)`; remove dead routes.

- `src/main/database/db.ts`
  - New columns, FTS5 table, triggers/upserts; delete/update helpers; ranked search; stats include FTS size.

- `src/main/services/contentService.ts`
  - Date filter extraction; prompt builder using PINNED/DATE/RETRIEVED blocks; source list returned.

- `src/main/services/llamaService.ts`
  - Expose embeddings methods or a dedicated `EmbeddingsService` for background computation.

- `src/renderer/*`
  - Split `App.tsx` into `Sidebar`, `NoteList`, `EditorPane`, `EditorToolbar`, `AIPanel`, `CommandPalette`.
  - Apply tokens stylesheet; replace 1s polling with event‑driven settings updates.

---

## Acceptance criteria

- Cold start < 2s on modern machines; UI remains responsive while indexing.
- Instant ranked search with highlights; clicking result opens note at snippet.
- “Ask your notes” streams answers; shows clickable sources; respects pinned files and date ranges.
- Works fully offline (Ollama optional). No devtools, secure defaults.
- Clean, Bear‑like look: centered editor, tidy list cards, subtle chrome.

---

## Nice‑to‑have (post‑MVP)

- Frontmatter support (title, tags, date) for indexing and filters.
- Command palette (quick switch, new note, search).
- Import helpers for Obsidian/Notes.

---

## Task Tracker (checklist)

- [ ] Phase 1 complete
- [ ] Phase 2 complete
- [ ] Phase 3 complete
- [ ] Phase 4 complete
- [ ] Phase 5 complete

