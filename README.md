# InkForge Local Novel Studio

InkForge is a local-first AI novel writing cockpit for solo authors. Your chapters, outlines and worldbuilding stay in your own project folder.

## Current Scope

This repository is initialized from `InkForge_Local_Novel_Studio_项目开发文档.docx` and currently implements the v0.1 foundation:

- Electron + Vite + React + TypeScript desktop app.
- Secure preload bridge with `contextIsolation=true` and `nodeIntegration=false`.
- Local novel project folder creation/opening.
- Zod schemas for core project data.
- Chapter tree, Markdown writing surface, autosave/manual save, and word count.
- Main-process export to Markdown, TXT, DOCX, and EPUB.
- Main-process AI provider boundary placeholder; API keys are not stored in renderer state or localStorage.
- Chat-based writing Agent with source citations, long-term chapter memory and author-confirmed project tools.
- Streaming Agent responses with live tool status, reliable cancellation and a replayable run-trace panel.
- Tool-free Plan mode with explicit author confirmation before execution.
- Per-request context, tool permission and Token budgets, plus conversation branches, favorites and task templates.
- Collapsible provider reasoning and tool-call audit details, separate from rendered Markdown answers.
- Batch proposal approval, guarded rollback confirmation and an opt-in AI YOLO mode for auto-applying only the current run's new proposals.
- Local semantic retrieval, automatic context budgets and compressed long-term project memory.
- Structured paragraph diffs with per-block review, stale-source protection, automatic snapshots and rollback.
- Checkpointed planning, drafting, review, revision and memory Agent workflow.
- Six-dimension chapter quality reports with stable regression baselines.
- Isolated story branches with line diffs, explicit apply and automatic chapter-history snapshots.
- Budgeted batch chapter production that pauses at author checkpoints and writes only to reviewable branches.
- OpenAI-compatible cloud/local/gateway presets, capability probing and project release-readiness checks.
- Windows unpacked-app and NSIS installer packaging through electron-builder.

## Development

```bash
npm install
npm run dev
```

Open the Vite URL for renderer development. To run the desktop shell:

```bash
npm run desktop
```

Build a local Windows application directory or installer:

```bash
npm run pack:desktop
npm run dist:windows
```

Public distribution still requires a code-signing certificate and an update feed.

## Project Data

Each novel is stored as a folder with Markdown and JSON files:

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
prompts/
exports/
.inkforge/
```

Files under `.inkforge/` are local app state/cache and should not be committed with a novel project.
