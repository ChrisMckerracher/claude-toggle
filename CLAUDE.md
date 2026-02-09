# Project Context

Add your project-specific context here.

## Agent Provider Configuration

The following providers are configured for different agent categories:

| Category | Provider | Command |
|----------|----------|---------|
| High-Quality | direct (Anthropic) | `ct direct` |
| High-Volume | codex (ChatGPT) | `ct codex` |

**The Team Lead is responsible for toggling to the correct mode BEFORE spawning agents.**

### Usage
- `ct direct` - Use direct Anthropic API
- `ct codex` - Use ChatGPT/Codex via local proxy
- `ct status` - Show current provider

<!-- TEAMMATE INSTRUCTIONS START -->
## Agent Provider Configuration

| Agent Type | Provider | Command |
|------------|----------|---------|
| High-Quality | direct | `ct direct` |
| High-Volume | codex | `ct codex` |
| test mapping | codex | `ct codex` |

### Provider Commands
- `ct direct`
- `ct codex`
- `ct status`

<!-- TEAMMATE INSTRUCTIONS END -->
