import { initClaudeMdManagedSection } from '../../services/claude.js';
import { failure, success, type CommandResult } from '../types.js';

export async function runInit(): Promise<CommandResult> {
  try {
    await initClaudeMdManagedSection();
    return success(['\x1b[32m✓ Updated managed teammate section in CLAUDE.md\x1b[0m']);
  } catch (err) {
    const error = err as Error;
    return failure([`\x1b[31mError: ${error.message}\x1b[0m`]);
  }
}
