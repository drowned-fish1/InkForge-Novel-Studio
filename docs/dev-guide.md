# Development Guide

## Setup

```bash
npm install
npm run dev
```

The renderer can run in a normal browser with an in-memory demo bridge. Desktop-only features use the Electron preload API.

## Desktop

```bash
npm run desktop
```

## Checks

```bash
npm run typecheck
npm run build
```

## Phase Rule

Follow the development document's phase boundaries. Do not add SaaS, login, cloud sync, collaboration or publishing-platform features while working on P0 desktop foundations.
