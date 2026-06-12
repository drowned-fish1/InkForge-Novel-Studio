# Prompt System

Prompts live in the project folder under `prompts/*.prompt.json`. New projects seed one editable JSON template per AI task, such as `continue.prompt.json`, `rewrite.prompt.json`, and `typo.prompt.json`.

```json
{
  "id": "continue_default_v1",
  "name": "Continue chapter",
  "system": "You are a fiction writing copilot...",
  "userTemplate": "Task: {{taskInstruction}}\nChapter goal: {{chapterGoal}}\nRecent prose:\n{{recentText}}",
  "output": "markdown"
}
```

The prompt engine renders template variables and returns metadata:

- task id and name
- system prompt
- user prompt
- output type
- context summary
- generated timestamp

AI results must enter a draft or suggestion area first. They must not directly overwrite chapter files.
