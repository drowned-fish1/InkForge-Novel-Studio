# Security

InkForge stores novel project data locally in user-selected folders.

## Supported Versions

Security fixes are provided for the latest release candidate or stable release only.

## API Keys

API keys must not be stored in renderer localStorage, project folders or exported manuscripts. Provider credentials belong in main-process secure storage.

## AI Requests

InkForge should only send writing context when the user explicitly starts an AI task. The UI should show enough context summary for the author to understand what will be sent.

## Reports

Please do not disclose vulnerabilities in a public issue. Use GitHub's private vulnerability reporting from the repository's **Security** tab. Include reproduction steps, affected versions and the potential impact. If private reporting is temporarily unavailable, open a public issue containing no vulnerability details and ask the maintainers for a private contact channel.
