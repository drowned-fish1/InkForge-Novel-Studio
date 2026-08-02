# Contributing

InkForge is local-first and solo-author focused. Contributions should preserve that scope.

## Rules

- Keep user writing data local by default.
- Do not introduce account systems, cloud sync, billing or collaboration features without a scope change.
- Add or update Zod schemas before implementing new project data writes.
- Keep API keys out of renderer state, localStorage, project files and logs.
- Treat AI output as untrusted text suggestions.

## Development

Use Node.js 22 and install the locked dependency tree:

```bash
npm ci
```

Run the same quality gates as CI before opening a pull request:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:desktop-smoke
```

Keep pull requests focused, explain user-visible behavior changes, and add or update tests for changed behavior.
