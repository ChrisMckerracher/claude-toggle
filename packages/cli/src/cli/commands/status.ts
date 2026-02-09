import { getCodexStatus } from '../../daemon.js';
import { getProviderSnapshot } from '../../services/provider-service.js';
import { formatProviderStatus } from '../../services/status.js';
import { success, type CommandResult } from '../types.js';

export async function runStatus(): Promise<CommandResult> {
  const snapshot = await getProviderSnapshot();
  const lines = formatProviderStatus(snapshot);

  const codexStatus = await getCodexStatus();
  lines.push('', '\x1b[90mDaemon:\x1b[0m');

  if (codexStatus.daemon === 'running') {
    lines.push('  \x1b[32m●\x1b[0m Running');
  } else {
    lines.push('  \x1b[31m○\x1b[0m Stopped');
  }

  lines.push('\x1b[90mCodex Auth:\x1b[0m');
  if (codexStatus.auth === 'valid') {
    lines.push('  \x1b[32m✓\x1b[0m Valid');
  } else if (codexStatus.auth === 'expired') {
    lines.push('  \x1b[33m!\x1b[0m Expired');
  } else {
    lines.push('  \x1b[31m✗\x1b[0m Missing');
  }

  return success(lines);
}
