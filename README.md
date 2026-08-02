# InkForge Local Novel Studio

InkForge is a local-first AI novel writing cockpit for solo authors. Your chapters, outlines and worldbuilding stay in your own project folder — every core workflow (writing, story data, revision, backup, export) works with **no API key configured**, and every AI write goes through an author-confirmed proposal.

## v1.0 RC Feature Overview

**Manual writing workbench（章节写作台）**

- Markdown editor with find/replace, heading jump, format shortcuts (Ctrl+B/I in the editor), typewriter scrolling and paragraph-focus mode.
- Selection-based annotations, revision marks (待修改) with a resolve lifecycle, and bookmarks.
- Daily word counts, writing-session durations and a 7-day history from local session records.
- Collapsible Agent panel with persisted state; autosave with crash-recovery drafts and per-chapter history versions.

**Story data & relationships**

- Full CRUD pages for characters, worldbuilding, locations, factions, conflicts, events, timeline, clues and terms — all backed by one source of truth in the project folder.
- Relationship centre with bidirectional reference views across every entity family including chapters.
- Reference-checked deletion: cancel, unlink everywhere, or replace with a new name.

**Revision workbench**

- Aggregates annotations, revision marks, rule-based quality findings, continuity issues and pending Agent proposals across all chapters.
- Accept / ignore / defer / reopen with batch operations, filters, sorting and per-chapter quality scores with baseline deltas.
- Proposal before/after line diffs; applying a chapter proposal re-runs the local quality evaluation.

**Backups, drafts & recovery**

- Automatic snapshots with configurable interval, retention, disk cap and an optional external backup directory.
- Integrity verification (chapter hashes), per-snapshot changed-chapter lists and a pre-restore diff with a protected rollback point.
- Corrupted-project recovery from the start screen; draft box with batch operations, aggregated history diffs and inspiration fragments.

**Agent control**

- 22 registered tools with a single read/proposal registry; writes are proposal-only and author-confirmed, previewable, revertible and traced.
- Pre-send token estimates (clearly marked as estimates) with optional cost estimation, per-tool ask-before-each-call authorization, decision logging in run traces, cancellation that aborts in-flight provider calls, and session-file compaction.
- Prompt packs, task templates and workflow templates with JSON import/export.

**Delivery**

- Unified export to Markdown, TXT, DOCX (auto page breaks) and full EPUB 3: cover image, copyright page, volume-nested TOC + NCX, configurable typography — with pre-export checks and post-build structural/XHTML validation.
- Project-level export configuration persisted inside the project.

## Development

Prerequisites: Node.js 22 and npm 10 or newer.

```bash
npm ci
npm run dev        # renderer dev server (browser preview with mock desktop services)
npm run desktop    # desktop shell
```

Quality gates:

```bash
npm run lint
npm run typecheck
npm test
npm run test:desktop-smoke   # builds and exercises the real main process end to end
```

Build a local Windows application directory or installer:

```bash
npm run pack:desktop
npm run dist:windows
```

Public distribution still requires a code-signing certificate and an update feed — see `docs/release-windows.md`.

## Project Data

Each novel is stored as a folder with Markdown and JSON files — see `docs/project-format.md` for the full layout:

```text
project.novel.json
outline.json
chapters/
summaries/
characters/
world/
timeline.json
clues.json
terms.json
conflicts.json
prompts/
exports/
.inkforge/        # app state: backups, history, quality, agent sessions, configs
```

Files under `.inkforge/` are local app state/cache and should not be committed with a novel project.

## Documentation

- `docs/user-guide.md` — end-user walkthrough of every module.
- `docs/architecture.md`, `docs/dev-guide.md` — codebase orientation.
- `docs/long-novel-continuation-design.md` — 600–700 万字未完结小说的续写工程改造设计。
- `docs/v1-implementation-status.md` — v1.0 RC phase log, decisions and known limitations.
- `docs/release-windows.md` — Windows packaging, installer verification, update feed and signing integration.

## Contributing and Security

Contributions are welcome. Read `CONTRIBUTING.md` before opening a pull request. Please report security issues privately as described in `SECURITY.md`.

## License

InkForge is released under the MIT License. See `LICENSE`.
