# Development Log

## 2026-05-13

Implemented the initial v0.1 foundation from the Word development document.

### Scope

- Created monorepo-style workspace with `apps/desktop` and `packages/*`.
- Added Electron main/preload security boundary.
- Added React desktop writing cockpit UI.
- Added Zod schemas for project, outline, character, clue, timeline, term and prompt template data.
- Added local project creation/opening, chapter creation, chapter read/write and Markdown/TXT export IPC.
- Added browser demo bridge for renderer development without direct filesystem access.
- Added initial docs for scope, architecture, project format and prompt system.

### Known Gaps

- AI Provider configuration and streaming calls are scaffolded only.
- Character/world/timeline/clue/term CRUD views are represented in navigation but not implemented yet.
- DOCX export is planned for P0-7 and not included in this first pass.
- The editor uses a styled Markdown textarea; CodeMirror integration can be added in the chapter-editing phase.

### Next

- Implement P0-3 refinements: chapter rename/delete, volume operations, stronger autosave recovery.
- Implement P0-4 character cards and worldbuilding CRUD.
- Implement P0-5 secure provider settings in the main process.

## 2026-05-13 Continued

Extended the MVP toward P0-4.

### Scope

- Added `WorldEntrySchema` for structured worldbuilding records.
- Added `LibraryService` in Electron main process for character/world list and save operations.
- Exposed library IPC through preload without renderer filesystem access.
- Added character card editor with profile, state and voice-note fields.
- Added worldbuilding editor with type, tags, summary, content and locked-setting flag.
- Made the center workspace switch by module instead of always showing the chapter editor.
- Connected the AI cockpit quick references to real character/world library state.
- Added separate Markdown and TXT export controls in the top bar.

### Known Gaps

- Delete/rename flows are not implemented yet.
- Timeline, clues and terms still have placeholder screens.
- Character/world relation pickers are text-light for now; richer cross-linking belongs in the long-form management phase.

## 2026-05-13 Provider Settings

Implemented the P0-5 provider configuration foundation for user-supplied API keys.

### Scope

- Added provider config types for `bearer`, `x-api-key`, raw `Authorization`, and no-key modes.
- Added Electron `safeStorage` encrypted API key persistence under app user data.
- Kept renderer status redacted: it only receives provider name, base URL, model, auth mode, masked key and updated time.
- Added main-process OpenAI-compatible `/chat/completions` request execution with readable 401/403/404/429/5xx error messages.
- Added right-panel Provider Settings UI.
- Connected AI cockpit actions to the main-process AI task bridge, with browser demo fallback for UI testing.

### Security Notes

- API keys are not saved to `localStorage`.
- API keys are not written to novel project folders.
- The renderer sends a key only when the user submits the Provider Settings form; persistent storage is handled by the main process.

## 2026-05-13 AI Writing Workflow

Implemented the first P0-6 draft-confirmation loop.

### Scope

- Added `ChapterSummarySchema` for `summaries/*.summary.json`.
- Added `SummaryService` in the Electron main process.
- Extended AI task results with task metadata.
- Added `summary:save` IPC through preload.
- Added draft actions in the AI cockpit:
  - append AI draft to the end of the current chapter
  - save AI draft as a chapter summary
  - clear draft
- Kept AI output in the draft area until the author explicitly confirms a write action.

### Verification

- Typecheck and production build pass.
- Browser QA covered Provider setup, summary generation, summary save, continuation generation, append-to-chapter, and autosave.
- `localStorage` remains empty.

## 2026-05-13 DOCX Export

Implemented the P0-7 DOCX export foundation.

### Scope

- Added `docx` package to the desktop workspace.
- Extended export format types to support `docx`.
- Reworked `ExportService` to produce Markdown, TXT, or DOCX from the same ordered volume/chapter block list.
- Added DOCX output with document title, volume headings, chapter headings, Chinese-friendly paragraph indentation and page margins.
- Added a `DOCX` export action in the top bar.

### Notes

- DOCX export is generated in the Electron main process.
- Markdown/TXT behavior remains unchanged.

## 2026-05-13 P1-1 Local Check System

Started the long-form management and consistency-check phase.

### Scope

- Added `StoryStateService` in the Electron main process.
- Added IPC for:
  - `timeline.json`
  - `clues.json`
  - `terms.json`
  - local story inspection
- Added editable UI modules for Timeline, Clues and Terms.
- Replaced the Overview placeholder with project counts and local consistency findings.
- Added rule checks for missing timeline chapter links, bad chapter IDs, unresolved clues without payoff, duplicate terms and empty term definitions.

### Verification

- Typecheck and production build pass.
- Browser QA covered Overview, Timeline create/save, Clues view and Terms view.
- Console has no errors and `localStorage` remains empty.
