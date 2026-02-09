/**
 * Shell command generation for provider switching
 * Outputs commands for bash/zsh and tmux environments
 */

import type { Provider, Config } from './config.js';

export interface ShellCommands {
  bash: string[];
  zsh: string[];
  tmux: string[];
  fish: string[];
}

/**
 * Generate shell environment commands for switching providers
 */
export function generateShellCommands(provider: Provider): ShellCommands {
  const commands: ShellCommands = {
    bash: [],
    zsh: [],
    tmux: [],
    fish: []
  };

  // Direct provider - unset API base URL
  if (provider.type === 'direct') {
    commands.bash = [
      '# Switch to direct Anthropic API',
      'unset ANTHROPIC_API_BASE',
      'unset OPENAI_API_BASE',
      'echo "Switched to direct Anthropic API"'
    ];

    commands.zsh = [...commands.bash];
    commands.fish = [
      '# Switch to direct Anthropic API',
      'set -e ANTHROPIC_API_BASE',
      'set -e OPENAI_API_BASE',
      'echo "Switched to direct Anthropic API"'
    ];

    commands.tmux = [
      '# Switch to direct Anthropic API in tmux',
      'tmux set-environment -u ANTHROPIC_API_BASE',
      'tmux set-environment -u OPENAI_API_BASE',
      'echo "Switched to direct Anthropic API"'
    ];

    return commands;
  }

  // Codex or custom provider - set API base URL
  const baseUrl = provider.baseUrl || 'http://127.0.0.1:4096/v1';

  commands.bash = [
    `# Switch to ${provider.name} provider`,
    `export ANTHROPIC_API_BASE="${baseUrl}"`,
    `export OPENAI_API_BASE="${baseUrl}"`,
    `echo "Switched to ${provider.name} provider at ${baseUrl}"`
  ];

  commands.zsh = [...commands.bash];

  commands.fish = [
    `# Switch to ${provider.name} provider`,
    `set -gx ANTHROPIC_API_BASE "${baseUrl}"`,
    `set -gx OPENAI_API_BASE "${baseUrl}"`,
    `echo "Switched to ${provider.name} provider at ${baseUrl}"`
  ];

  commands.tmux = [
    `# Switch to ${provider.name} provider in tmux`,
    `tmux set-environment ANTHROPIC_API_BASE "${baseUrl}"`,
    `tmux set-environment OPENAI_API_BASE "${baseUrl}"`,
    `echo "Switched to ${provider.name} provider at ${baseUrl}"`
  ];

  return commands;
}

/**
 * Format shell commands for output
 */
export function formatCommands(commands: string[], _shell: 'bash' | 'zsh' | 'fish' | 'tmux'): string {
  return commands.join('\n');
}

/**
 * Detect current shell from environment
 */
export function detectShell(): 'bash' | 'zsh' | 'fish' | 'unknown' {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('fish')) return 'fish';
  if (shell.includes('bash')) return 'bash';
  return 'unknown';
}

/**
 * Check if running inside tmux
 */
export function isInTmux(): boolean {
  return process.env.TMUX !== undefined;
}

/**
 * Generate commands for auto-detected environment
 */
export function generateAutoCommands(provider: Provider): string {
  const shellCommands = generateShellCommands(provider);
  const shell = detectShell();
  const inTmux = isInTmux();

  if (inTmux) {
    return formatCommands(shellCommands.tmux, 'tmux');
  }

  switch (shell) {
    case 'zsh':
      return formatCommands(shellCommands.zsh, 'zsh');
    case 'fish':
      return formatCommands(shellCommands.fish, 'fish');
    default:
      return formatCommands(shellCommands.bash, 'bash');
  }
}

/**
 * Generate eval-able output for shell sourcing
 */
export function generateEvalOutput(provider: Provider): string {
  const shellCommands = generateShellCommands(provider);
  const shell = detectShell();

  switch (shell) {
    case 'fish':
      return formatCommands(shellCommands.fish, 'fish');
    default:
      return formatCommands(shellCommands.bash, 'bash');
  }
}

/**
 * Generate per-agent-category commands for CLAUDE.md
 */
export function generateAgentCategoryCommands(config: Config): Map<string, string> {
  const result = new Map<string, string>();

  for (const category of config.agentCategories) {
    const provider = config.providers.find(p => p.name === category.provider);
    if (!provider || !provider.enabled) continue;

    const commands = generateShellCommands(provider);
    result.set(category.name, formatCommands(commands.bash, 'bash'));
  }

  return result;
}

/**
 * Print status to console
 */
export function printStatus(config: Config): void {
  const lines = getStatusLines(config);
  console.log(lines.join('\n'));
}

/**
 * Render status lines for CLI output
 */
export function getStatusLines(config: Config): string[] {
  const lines: string[] = [];
  const active = config.providers.find(p => p.name === config.active);

  if (active?.type === 'direct') {
    lines.push('\x1b[36m✦ direct mode (Anthropic API)\x1b[0m');
  } else if (active) {
    const baseUrl = active.type === 'codex' ? active.baseUrl : active.baseUrl;
    lines.push(`\x1b[33m✦ proxy mode\x1b[0m (${baseUrl})`);
  }

  lines.push('', '\x1b[90mProviders:\x1b[0m');
  for (const p of config.providers) {
    const marker = p.name === config.active ? '\x1b[32m→\x1b[0m' : ' ';
    const status = p.enabled ? '' : ' \x1b[90m(disabled)\x1b[0m';
    lines.push(`  ${marker} ${p.name}${status}`);
  }

  if (config.agentCategories.length > 0) {
    lines.push('', '\x1b[90mAgent Categories:\x1b[0m');
    for (const cat of config.agentCategories) {
      lines.push(`  ${cat.name} → ${cat.provider}`);
    }
  }

  return lines;
}
