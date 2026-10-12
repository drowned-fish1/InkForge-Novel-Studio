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
npm run format:check
npm run lint
npm run typecheck        # builds workspace packages first
npm test                 # vitest across packages and electron services
npm run build
npm run test:desktop-smoke   # builds, then end-to-end checks against the real main process
npm audit --omit=dev --audit-level=high
npm run dist:windows         # Windows NSIS
npm run dist:mac             # run on macOS: DMG + ZIP
npm run dist:linux           # run on Linux: AppImage + DEB
```

Notes:

- The tracked repository is Prettier-clean; run `npm run format` only for intentional source/document changes.
- Shared pure logic (reference engine, export preflight, token estimator, tool registry) lives in `packages/schemas` so the electron services and the browser mirror cannot diverge.
- Agent tools are declared once in `agentToolRegistry` (`packages/schemas/src/agent.ts`); adding a tool means extending the enum + registry, the tool definition and its `executeTool` handler.

The Remotion project is intentionally isolated from the root npm workspace because it uses its own pinned media toolchain:

```bash
npm ci --prefix promo-video
npm run check:promo
```

Generated WAV files, Remotion bundles and rendered videos are local artifacts and must not be committed.

## Phase Rule

Keep the local-first boundary: no SaaS, login, cloud sync, collaboration or publishing-platform features. All agent writes must go through author-confirmed proposals.
