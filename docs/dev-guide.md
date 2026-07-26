# Development Guide

## Setup

```bash
npm install
npm run dev
```

The renderer can run in a normal browser with an in-memory demo bridge. Desktop-only features use the Electron preload API. Every new `InkforgeApi` method MUST be mirrored in `apps/desktop/src/lib/browserBridge.ts` — the `InkforgeApi` type annotation there makes typecheck the enforcement gate.

## Desktop

```bash
npm run desktop
```

## Quality Gates

```bash
npm run lint
npm run typecheck        # builds workspace packages first
npm test                 # vitest across packages and electron services
npm run build
npm run test:desktop-smoke   # builds, then end-to-end checks against the real main process
```

Notes:

- The repo is not prettier-clean at baseline; format only files you touched.
- Shared pure logic (reference engine, export preflight, token estimator, tool registry) lives in `packages/schemas` so the electron services and the browser mirror cannot diverge.
- Agent tools are declared once in `agentToolRegistry` (`packages/schemas/src/agent.ts`); adding a tool means extending the enum + registry, the tool definition and its `executeTool` handler.

## Phase Rule

Keep the local-first boundary: no SaaS, login, cloud sync, collaboration or publishing-platform features. All agent writes must go through author-confirmed proposals.
