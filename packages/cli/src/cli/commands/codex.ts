import { runCodexAuthAction } from '../../auth.js';
import { getCodexStatus, runCodexDaemonAction } from '../../daemon.js';
import { persistManagedZshrcBlock } from '../../services/env.js';
import { getCodexModel, listCodexModels, setCodexModel, setProviderEnabled, switchProvider } from '../../services/provider-service.js';
import { failure, success, type CommandResult } from '../types.js';

export async function runCodexStatus(): Promise<CommandResult> {
  const status = await getCodexStatus();
  const model = await getCodexModel();
  const lines: string[] = [
    'Codex status:',
    `- daemon: ${status.daemon}`,
    `- auth: ${status.auth}`,
    `- model: ${model}`,
  ];

  return success(lines);
}

export async function runCodexDaemon(): Promise<CommandResult> {
  try {
    const result = await runCodexDaemonAction();
    if (!result.success) {
      return failure([`\x1b[31m✗ ${result.message}\x1b[0m`]);
    }

    return success([`\x1b[32m✓ ${result.message}\x1b[0m`]);
  } catch (err) {
    const error = err as Error;
    return failure([`\x1b[31mError: ${error.message}\x1b[0m`]);
  }
}

export async function runCodexAuth(): Promise<CommandResult> {
  try {
    const result = await runCodexAuthAction();
    const verb = result === 'reauthenticated' ? 'Re-authenticated' : 'Authenticated';
    return success([`\x1b[32m✓ ${verb} with codex proxy\x1b[0m`]);
  } catch (err) {
    const error = err as Error;
    return failure([`\x1b[31mError: ${error.message}\x1b[0m`]);
  }
}

export async function runCodexOnboard(): Promise<CommandResult> {
  try {
    const lines: string[] = [];

    await setProviderEnabled('codex', true);
    const context = await switchProvider('codex');
    await persistManagedZshrcBlock(context);
    lines.push('\x1b[32m✓ Codex provider active\x1b[0m');

    const daemonResult = await runCodexDaemonAction();
    if (!daemonResult.success) {
      return failure([`\x1b[31m✗ ${daemonResult.message}\x1b[0m`]);
    }
    lines.push(`\x1b[32m✓ ${daemonResult.message}\x1b[0m`);

    const authResult = await runCodexAuthAction();
    lines.push(`\x1b[32m✓ ${authResult === 'reauthenticated' ? 'Re-authenticated' : 'Authenticated'} with codex proxy\x1b[0m`);

    return success(lines);
  } catch (err) {
    const error = err as Error;
    return failure([`\x1b[31mError: ${error.message}\x1b[0m`]);
  }
}

export async function runCodexModel(modelId?: string): Promise<CommandResult> {
  try {
    if (modelId) {
      const selected = await setCodexModel(modelId);
      return success([`\x1b[32m✓ Codex model set to ${selected}\x1b[0m`]);
    }

    const current = await getCodexModel();
    const supported = listCodexModels();
    const lines = ['Codex model:', `- current: ${current}`, '- supported:'];
    for (const model of supported) {
      const marker = model.id === current ? '  *' : '   ';
      lines.push(`${marker} ${model.id} (${model.name})`);
    }

    return success(lines);
  } catch (err) {
    const error = err as Error;
    return failure([`\x1b[31mError: ${error.message}\x1b[0m`]);
  }
}
