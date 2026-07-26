# Architecture

InkForge uses Electron + Vite + React + TypeScript.

```text
Renderer React UI
  -> window.inkforge preload bridge
  -> Electron Main IPC
  -> ChatAgentService / QualityService / BranchService / BatchProductionService / ReleaseService
  -> ProjectService / FileRepository / ExportService / AiProviderService
  -> Local project folder + future OS credential store
```

## Security Boundary

- `contextIsolation` is enabled.
- `nodeIntegration` is disabled.
- Renderer code cannot access `fs` or Electron APIs directly.
- API keys must only be handled by main-process services.
- AI output is treated as text suggestions, never executable instructions.
- Agent write tools create pending proposals; only explicit author confirmation can change a chapter.

## Current Modules

- `ProjectService`: create/open projects, create chapters, validate metadata.
- `FileRepository`: UTF-8 text/JSON I/O, atomic writes, project path guard.
- `ExportService`: export ordered volume/chapter text to Markdown, TXT, DOCX, or EPUB.
- `AiProviderService`: OpenAI-compatible text and tool-call SSE streaming, cancellation, timeout and transient retry handling.
- `ChatAgentService`: budgeted tool-call loop, live run events, structured text/data proposals, source citations, chapter locks and confirmed writes.
- `AgentTraceService`: bounded per-chapter run history with latency, Token, tool and replay metadata.
- `SemanticIndexService`: local multilingual vector index and hybrid semantic retrieval.
- `ChapterMemoryService`: durable per-chapter summaries, compressed project digest and retrieval metadata.
- `ScenePlanService`: project-backed scene-plan storage.
- `AgentService`: checkpointed planning, drafting, review, revision and memory pipeline.
- `QualityService`: deterministic chapter evaluation, bounded report history and author-selected baselines.
- `BranchService`: isolated story alternatives, ordered line diffs and snapshot-backed application.
- `BatchProductionService`: sequential generation with token budgets, cancellation and author checkpoints.
- `ReleaseService`: provider, quality, branch, batch and manuscript readiness aggregation.
- `PromptEngine`: template rendering and context-summary metadata.

## Production Safety

- Batch output is always stored as a story branch first.
- Applying a branch uses `ChapterService`, so the previous chapter is written to history automatically.
- Quality baselines are immutable report references and are never changed by a later evaluation.
- Provider probing sends a minimal compatibility request and reports tool-call support separately from basic reachability.
- `electron-builder` can create a local Windows package; signing and update publishing stay explicit deployment steps.

See [Chat Agent](./agent-chat.md) for the tool protocol and confirmation boundary.
