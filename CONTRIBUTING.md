# Contributing

InkForge is local-first and solo-author focused. Contributions should preserve that scope.

## Rules

- Keep user writing data local by default.
- Do not introduce account systems, cloud sync, billing or collaboration features without a scope change.
- Add or update Zod schemas before implementing new project data writes.
- Keep API keys out of renderer state, localStorage, project files and logs.
- Treat AI output as untrusted text suggestions.

## Development

Run checks before opening a pull request:

```bash
npm run typecheck
npm run build
```
