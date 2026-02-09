#!/usr/bin/env node
/**
 * CLI entry point for provider switching
 */

import { parseCommand } from './cli/parser.js';
import { runParsedCommand } from './cli/runner.js';

async function main(): Promise<void> {
  const parsed = parseCommand(process.argv.slice(2));
  const result = await runParsedCommand(parsed);

  if (result.launchTui) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error('TUI requires an interactive terminal (raw mode).');
      return;
    }
    const { launchTUI } = await import('./tui.js');
    launchTUI();
    return;
  }

  if (result.stdoutLines && result.stdoutLines.length > 0) {
    console.log(result.stdoutLines.join('\n'));
  }

  if (result.stderrLines && result.stderrLines.length > 0) {
    console.error(result.stderrLines.join('\n'));
  }

  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
