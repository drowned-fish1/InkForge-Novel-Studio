# Architecture

InkForge uses Electron + Vite + React + TypeScript.

```text
Renderer React UI
  -> window.inkforge preload bridge
  -> Electron Main IPC
  -> ProjectService / FileRepository / ExportService / AiProviderService
  -> Local project folder + future OS credential store
```

## Security Boundary

- `contextIsolation` is enabled.
- `nodeIntegration` is disabled.
- Renderer code cannot access `fs` or Electron APIs directly.
- API keys must only be handled by main-process services.
- AI output is treated as text suggestions, never executable instructions.

## Current Modules

- `ProjectService`: create/open projects, create chapters, validate metadata.
- `FileRepository`: UTF-8 text/JSON I/O, atomic writes, project path guard.
- `ExportService`: export ordered volume/chapter text to Markdown or TXT.
- `AiProviderService`: P0-5 placeholder for OpenAI-compatible provider calls.
- `PromptEngine`: template rendering and context-summary metadata.
