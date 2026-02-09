import { applyTmuxEnvironment, persistManagedZshrcBlock, buildSwitchOutput } from '../../services/env.js';
import { switchProvider } from '../../services/provider-service.js';
import { failure, success, type CommandResult } from '../types.js';

export async function runSwitchProvider(providerName: string): Promise<CommandResult> {
  try {
    const context = await switchProvider(providerName);
    await persistManagedZshrcBlock(context);
    await applyTmuxEnvironment(context);
    return success(buildSwitchOutput(context));
  } catch (err) {
    const error = err as Error;
    return failure([`\x1b[31mError: ${error.message}\x1b[0m`]);
  }
}
