# Project Format

Each novel is a folder. The MVP creates:

```text
project.novel.json
outline.json
chapters/volume-001/ch-0001.md
summaries/
characters/
world/power-system.md
world/factions.json
world/locations.json
timeline.json
clues.json
terms.json
prompts/*.prompt.json
exports/
.inkforge/cache.json
.inkforge/app-state.json
```

## Git Guidance

Track:

- `project.novel.json`
- `outline.json`
- `chapters/**/*.md`
- `summaries/*.json`
- `characters/*.json`
- `world/*`
- `timeline.json`
- `clues.json`
- `terms.json`
- `prompts/*.prompt.json`

Ignore:

- `.inkforge/cache.json`
- `.inkforge/app-state.json`
- transient exports when not needed
