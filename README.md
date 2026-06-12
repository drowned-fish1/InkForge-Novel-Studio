# InkForge Local Novel Studio

InkForge is a local-first AI novel writing cockpit for solo authors. Your chapters, outlines and worldbuilding stay in your own project folder.

## Current Scope

This repository is initialized from `InkForge_Local_Novel_Studio_项目开发文档.docx` and currently implements the v0.1 foundation:

- Electron + Vite + React + TypeScript desktop app.
- Secure preload bridge with `contextIsolation=true` and `nodeIntegration=false`.
- Local novel project folder creation/opening.
- Zod schemas for core project data.
- Chapter tree, Markdown writing surface, autosave/manual save, and word count.
- Main-process export to Markdown and TXT.
- Main-process AI provider boundary placeholder; API keys are not stored in renderer state or localStorage.

## Development

```bash
npm install
npm run dev
```

Open the Vite URL for renderer development. To run the desktop shell:

```bash
npm run desktop
```

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
