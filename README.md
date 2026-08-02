<p align="center">
  <img src="./apps/desktop/build/icon.png" width="88" alt="InkForge logo" />
</p>

<h1 align="center">InkForge Local Novel Studio</h1>

<p align="center">
  A local-first AI writing cockpit for novelists who want assistance without giving up authorship or control of their drafts.
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/drowned-fish1/InkForge-Novel-Studio/actions/workflows/ci.yml"><img src="https://github.com/drowned-fish1/InkForge-Novel-Studio/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-0f766e" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/status-v1.0.0--rc.1-c58b3a" alt="v1.0.0 RC 1" />
  <img src="https://img.shields.io/badge/platform-Windows-2563eb" alt="Windows" />
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#product-tour">Product tour</a> ·
  <a href="./docs/user-guide.md">User guide</a> ·
  <a href="./docs/architecture.md">Architecture</a> ·
  <a href="./docs/roadmap-next.md">Roadmap</a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/writing-workspace-dark.png" />
  <img src="./docs/assets/readme/writing-workspace-light.png" alt="InkForge chapter writing workspace with the chapter tree, Markdown editor, and author-controlled Agent panel" />
</picture>

> [!IMPORTANT]
> InkForge is currently a **v1.0 release candidate**. The application is usable and covered by automated tests, but public Windows builds are unsigned and may trigger SmartScreen. See [release status](#project-status).

## Why InkForge

| Your work stays yours                                                                                                                          | AI stays under control                                                                                                   | One workspace for a whole novel                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Chapters, outlines, story data, history, and backups live in a folder you choose. Core writing workflows do not require an account or API key. | Agent writes are proposals: preview the diff, accept or reject it, trace what happened, and roll back confirmed changes. | Draft, plan, inspect continuity, manage story entities, revise across chapters, back up, and export without stitching together separate tools. |

InkForge is deliberately built for **solo long-form fiction**. It does not include accounts, cloud sync, billing, ads, or team permissions.

## Product tour

### Write with context-aware agents

The writing workspace combines a Markdown editor, chapter goals, search, annotations, revision marks, bookmarks, writing statistics, and an optional Agent panel. Agent roles can inspect approved context, coordinate tool calls, and return author-reviewable proposals.

![Multi-Agent collaboration inside the InkForge writing workspace](./docs/assets/readme/multi-agent-collaboration.png)

### Review the manuscript, not only the current page

Run deterministic local quality checks, compare chapter baselines, inspect continuity and reference issues, and collect annotations and pending proposals in one revision workflow. AI is optional for these checks.

![InkForge manuscript quality review with dimension scores and history](./docs/assets/readme/quality-review.png)

## What is included

| Area           | Capabilities                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Writing        | CodeMirror Markdown editor, chapter tree, focus and typewriter modes, find/replace, headings, annotations, revision marks, bookmarks, session statistics, and crash-recovery drafts |
| Story planning | Volumes and outlines, characters, worldbuilding, locations, factions, events, timeline, clues, terms, conflicts, and bidirectional relationship views                               |
| Revision       | Project-wide quality sweep, continuity and reference checks, centralized dispositions, proposal diffs, immutable quality baselines, and story branches                              |
| Agent control  | OpenAI-compatible providers, multi-role Agent sessions, tool authorization, token and cost estimates, cancellation, trace history, templates, and proposal-only writes              |
| Delivery       | Automatic snapshots, integrity verification, protected restore, Markdown/TXT/DOCX export, and validated EPUB 3 with cover, metadata, nested TOC, NCX, and typography options        |

The complete walkthrough lives in the [user guide](./docs/user-guide.md).

## Quick start

### Prerequisites

- Node.js 22
- npm 10 or newer
- Windows for the packaged desktop target; the browser preview can run on other development platforms

### Run the desktop app from source

```bash
git clone https://github.com/drowned-fish1/InkForge-Novel-Studio.git
cd InkForge-Novel-Studio
npm ci
npm run desktop
```

To run the renderer with mock desktop services in a browser:

```bash
npm run dev
```

To build a local Windows application directory or an unsigned NSIS installer:

```bash
npm run pack:desktop
npm run dist:windows
```

See the [Windows release guide](./docs/release-windows.md) before distributing a build.

## Privacy and AI boundary

- All non-AI writing, planning, revision, backup, and export workflows work without a provider.
- Novel data is stored in user-selected project folders; provider credentials stay outside the project and renderer storage.
- Writing context is sent only when the author explicitly starts an AI task.
- Agent tools separate reads from writes. Writes create pending proposals and require author confirmation.
- AI output is treated as untrusted text, never as executable instructions.

Supported presets include OpenAI, Gemini's OpenAI-compatible endpoint, Ollama, compatible Claude gateways, DeepSeek, and other OpenAI-compatible services. Tool-calling capability depends on the selected model.

Read the [Agent protocol](./docs/agent-chat.md), [prompt system](./docs/prompt-system.md), and [security policy](./SECURITY.md) for details.

## Architecture

```text
React renderer
  → context-isolated preload bridge
  → Electron main-process services
  → local Markdown / JSON project folder
  → optional OpenAI-compatible provider
```

This npm-workspaces monorepo contains:

| Path                     | Responsibility                                                      |
| ------------------------ | ------------------------------------------------------------------- |
| `apps/desktop`           | Electron shell, React UI, preload bridge, IPC, and desktop services |
| `packages/schemas`       | Zod schemas and shared project contracts                            |
| `packages/prompt-engine` | Prompt templates and rendering                                      |
| `packages/ai-provider`   | OpenAI-compatible transport and error handling                      |
| `packages/agent-engine`  | Context compilation, pipelines, review, and Agent session logic     |

Start with [architecture](./docs/architecture.md), [developer guide](./docs/dev-guide.md), and [project format](./docs/project-format.md).

## Development

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:desktop-smoke
```

The CI workflow runs the same gates on Windows and Ubuntu, then builds an unsigned Windows installer for manual verification.

## Project status

InkForge is at `v1.0.0-rc.1`. Current intentional limitations:

- Windows is the only packaging target.
- Public builds are unsigned until a code-signing certificate and update feed are available.
- Browser preview uses reduced-fidelity backup and EPUB implementations; the Electron app contains the complete implementations.
- Images referenced inside chapter Markdown are reported during export checks but are not embedded in exported manuscripts.

See the [implementation status](./docs/v1-implementation-status.md) and [post-v1 candidates](./docs/roadmap-next.md) for the detailed record.

## Contributing

Issues and focused pull requests are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before making changes. Security vulnerabilities should be reported privately according to [SECURITY.md](./SECURITY.md).

## License

InkForge is released under the [MIT License](./LICENSE).
