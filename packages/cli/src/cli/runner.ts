import type { ParsedCommand } from './parser.js';
import type { CommandResult } from './types.js';
import { runCodexAuth, runCodexDaemon, runCodexModel, runCodexOnboard, runCodexStatus } from './commands/codex.js';
import { runDaemon } from './commands/daemon.js';
import { runHelp } from './commands/help.js';
import { runInit } from './commands/init.js';
import { runMappingDelete, runMappingList, runMappingSet } from './commands/mapping.js';
import {
  runProviderCreate,
  runProviderDelete,
  runProviderDisable,
  runProviderEnable,
  runProviderList,
} from './commands/provider.js';
import { runStatus } from './commands/status.js';
import { runSwitchProvider } from './commands/switch-provider.js';

export async function runParsedCommand(command: ParsedCommand): Promise<CommandResult> {
  try {
    switch (command.kind) {
      case 'tui':
        return { exitCode: 0, launchTui: true };

      case 'help':
        return runHelp();

      case 'status':
        return runStatus();

      case 'init':
        return runInit();

      case 'daemon':
        return runDaemon(command.action);

      case 'provider-list':
        return runProviderList();

      case 'provider-add':
        return runProviderCreate({
          name: command.name,
          kind: command.providerKind,
          baseUrl: command.baseUrl,
          apiKey: command.apiKey,
        });

      case 'provider-delete':
        return runProviderDelete(command.name);

      case 'provider-enable':
        return runProviderEnable(command.name);

      case 'provider-disable':
        return runProviderDisable(command.name);

      case 'mapping-list':
        return runMappingList();

      case 'mapping-set':
        return runMappingSet(command.agentType, command.providerName, command.teammateSuffix);

      case 'mapping-delete':
        return runMappingDelete(command.agentType);

      case 'codex-status':
        return runCodexStatus();

      case 'codex-daemon-action':
        return runCodexDaemon();

      case 'codex-auth-action':
        return runCodexAuth();

      case 'codex-onboard-action':
        return runCodexOnboard();

      case 'codex-model-show':
        return runCodexModel();

      case 'codex-model-set':
        return runCodexModel(command.modelId);

      case 'switch-provider':
        return runSwitchProvider(command.providerName);

      case 'error':
        return {
          exitCode: command.exitCode,
          stderrLines: [command.message],
        };
    }
  } catch (error) {
    const err = error as Error;
    return {
      exitCode: 1,
      stderrLines: [`\x1b[31mError: ${err.message}\x1b[0m`],
    };
  }
}
