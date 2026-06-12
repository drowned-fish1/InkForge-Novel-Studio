# Security

InkForge stores novel project data locally in user-selected folders.

## API Keys

API keys must not be stored in renderer localStorage, project folders or exported manuscripts. Provider credentials belong in main-process secure storage.

## AI Requests

InkForge should only send writing context when the user explicitly starts an AI task. The UI should show enough context summary for the author to understand what will be sent.

## Reports

Please report vulnerabilities through the repository issue tracker until a dedicated security contact is published.
