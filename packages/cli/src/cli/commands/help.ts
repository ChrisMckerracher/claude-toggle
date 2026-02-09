import { success, type CommandResult } from '../types.js';

const HELP_TEXT = `
\x1b[1mct\x1b[0m - Provider switcher for AI agents

\x1b[36mUsage:\x1b[0m
  ct [<provider>]      Switch to provider (outputs shell commands for eval)
  ct status            Show current provider and daemon status
  ct --repo init       Initialize repository-managed teammate instructions
  ct daemon <cmd>      Manage the codex proxy daemon
  ct codex [--flag]    Codex lifecycle actions (--status/--daemon/--auth/--onboard/--model)
  ct provider <cmd>    Manage providers
  ct mapping <cmd>     Manage agent-type provider mappings
  ct init              Append provider configuration to CLAUDE.md
  ct help              Show this help

\x1b[36mDaemon Commands:\x1b[0m
  ct daemon start      Start the codex proxy in background
  ct daemon stop       Stop the codex proxy
  ct daemon status     Check if proxy is running
  ct daemon restart    Restart the proxy

\x1b[36mCodex Commands:\x1b[0m
  ct codex             Switch to codex provider
  ct codex --status    Show daemon/auth status
  ct codex --daemon    Start if stopped, restart if running
  ct codex --auth      Auth if missing/expired, reauth if valid
  ct codex --onboard   Ensure provider, start daemon, run auth flow
  ct codex --model     Show current/supported codex models
  ct codex --model <id> Set codex model
  ct codex status      Show daemon/auth status
  ct codex daemon      Start if stopped, restart if running
  ct codex auth        Auth if missing/expired, reauth if valid
  ct codex model [id]  Show/set codex model

\x1b[36mProvider Commands:\x1b[0m
  ct provider list
  ct provider add <name> <generic|codex> [baseUrl] [apiKey]
  ct provider delete <name>
  ct provider enable <name>
  ct provider disable <name>

\x1b[36mMapping Commands:\x1b[0m
  ct mapping list
  ct mapping set <agentType> <provider> [teammateSuffix]
  ct mapping delete <agentType>

\x1b[36mExamples:\x1b[0m
  eval "$(ct codex)"   Switch to codex provider
  eval "$(ct openrouter)" Switch to a named provider
  ct status            Show current status
  ct daemon start      Start the proxy server
  ct --repo init       Initialize CLAUDE.md managed section

\x1b[36mConfiguration:\x1b[0m
  Built-in provider: anthropic (system-managed, immutable)
  Config file: ~/.local/share/ct/providers.json
  PID file: ~/.local/share/ct/codex.pid
  Log file: ~/.local/share/ct/codex.log
`;

export function runHelp(): CommandResult {
  return success(HELP_TEXT.trimEnd().split('\n'));
}
