import { getDaemonStatus, restartDaemon, startDaemon, stopDaemon } from '../../daemon.js';
import type { DaemonAction } from '../parser.js';
import { failure, success, type CommandResult } from '../types.js';

export async function runDaemon(action: DaemonAction): Promise<CommandResult> {
  switch (action) {
    case 'start': {
      const result = await startDaemon();
      if (result.success) {
        return success([`\x1b[32m✓ ${result.message}\x1b[0m`]);
      }
      return failure([`\x1b[31m✗ ${result.message}\x1b[0m`]);
    }

    case 'stop': {
      const result = await stopDaemon();
      if (result.success) {
        return success([`\x1b[32m✓ ${result.message}\x1b[0m`]);
      }

      // Preserve historical behavior: non-running stop is a warning, not a failure.
      return {
        exitCode: 0,
        stderrLines: [`\x1b[33m○ ${result.message}\x1b[0m`],
      };
    }

    case 'status': {
      const status = await getDaemonStatus();
      if (status.running) {
        return success([`\x1b[32mRunning\x1b[0m (PID ${status.pid})`]);
      }
      return success(['\x1b[31mStopped\x1b[0m']);
    }

    case 'restart': {
      const result = await restartDaemon();
      if (result.success) {
        return success([`\x1b[32m✓ ${result.message}\x1b[0m`]);
      }
      return failure([`\x1b[31m✗ ${result.message}\x1b[0m`]);
    }
  }
}
