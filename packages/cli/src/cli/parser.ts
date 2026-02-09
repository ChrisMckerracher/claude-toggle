export type DaemonAction = 'start' | 'stop' | 'status' | 'restart';
export type ProviderKindArg = 'generic' | 'codex';

export type ParsedCommand =
  | { kind: 'tui' }
  | { kind: 'help' }
  | { kind: 'status' }
  | { kind: 'init' }
  | { kind: 'daemon'; action: DaemonAction }
  | { kind: 'provider-list' }
  | { kind: 'provider-add'; name: string; providerKind: ProviderKindArg; baseUrl?: string; apiKey?: string }
  | { kind: 'provider-delete'; name: string }
  | { kind: 'provider-enable'; name: string }
  | { kind: 'provider-disable'; name: string }
  | { kind: 'mapping-list' }
  | { kind: 'mapping-set'; agentType: string; providerName: string; teammateSuffix?: string }
  | { kind: 'mapping-delete'; agentType: string }
  | { kind: 'codex-status' }
  | { kind: 'codex-daemon-action' }
  | { kind: 'codex-auth-action' }
  | { kind: 'codex-onboard-action' }
  | { kind: 'codex-model-show' }
  | { kind: 'codex-model-set'; modelId: string }
  | { kind: 'switch-provider'; providerName: string }
  | { kind: 'error'; message: string; exitCode: number };

const DAEMON_ACTIONS = new Set<DaemonAction>(['start', 'stop', 'status', 'restart']);
const PROVIDER_KINDS = new Set(['generic', 'codex']);

export function parseCommand(args: string[]): ParsedCommand {
  if (args.length === 0) {
    return { kind: 'tui' };
  }

  const [cmd, subCmd, arg3, arg4, arg5] = args;

  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    return { kind: 'help' };
  }

  if (cmd === 'status') {
    return { kind: 'status' };
  }

  if (cmd === 'init') {
    return { kind: 'init' };
  }

  if (cmd === '--repo') {
    if (subCmd === 'init') {
      return { kind: 'init' };
    }

    return {
      kind: 'error',
      message: 'Usage: ct --repo init',
      exitCode: 1,
    };
  }

  if (cmd === 'daemon') {
    if (subCmd && DAEMON_ACTIONS.has(subCmd as DaemonAction)) {
      return { kind: 'daemon', action: subCmd as DaemonAction };
    }

    return {
      kind: 'error',
      message: 'Usage: ct daemon <start|stop|status|restart>',
      exitCode: 1,
    };
  }

  if (cmd === 'provider') {
    if (subCmd === 'list') {
      return { kind: 'provider-list' };
    }

    if (subCmd === 'add') {
      if (!arg3 || !arg4) {
        return {
          kind: 'error',
          message: 'Usage: ct provider add <name> <generic|codex> [baseUrl] [apiKey]',
          exitCode: 1,
        };
      }

      if (!PROVIDER_KINDS.has(arg4)) {
        return {
          kind: 'error',
          message: `Unknown provider kind: ${arg4}`,
          exitCode: 1,
        };
      }

      const providerKind = arg4 as ProviderKindArg;

      const baseUrl = providerKind === 'codex' ? undefined : arg5 ?? undefined;
      const apiKey = providerKind === 'codex' ? undefined : args[5];

      return {
        kind: 'provider-add',
        name: arg3,
        providerKind,
        baseUrl,
        apiKey,
      };
    }

    if ((subCmd === 'delete' || subCmd === 'enable' || subCmd === 'disable') && arg3) {
      if (subCmd === 'delete') return { kind: 'provider-delete', name: arg3 };
      if (subCmd === 'enable') return { kind: 'provider-enable', name: arg3 };
      return { kind: 'provider-disable', name: arg3 };
    }

    return {
      kind: 'error',
      message: 'Usage: ct provider <list|add|delete|enable|disable> ...',
      exitCode: 1,
    };
  }

  if (cmd === 'mapping') {
    if (subCmd === 'list') {
      return { kind: 'mapping-list' };
    }

    if (subCmd === 'set' && arg3 && arg4) {
      return {
        kind: 'mapping-set',
        agentType: arg3,
        providerName: arg4,
        teammateSuffix: arg5,
      };
    }

    if (subCmd === 'delete' && arg3) {
      return {
        kind: 'mapping-delete',
        agentType: arg3,
      };
    }

    return {
      kind: 'error',
      message: 'Usage: ct mapping <list|set|delete> ...',
      exitCode: 1,
    };
  }

  if (cmd === 'codex') {
    if (!subCmd) {
      return { kind: 'switch-provider', providerName: 'codex' };
    }

    if (subCmd === 'status' || subCmd === '--status') {
      return { kind: 'codex-status' };
    }

    if (subCmd === 'daemon' || subCmd === '--daemon') {
      return { kind: 'codex-daemon-action' };
    }

    if (subCmd === 'auth' || subCmd === '--auth') {
      return { kind: 'codex-auth-action' };
    }

    if (subCmd === '--onboard') {
      return { kind: 'codex-onboard-action' };
    }

    if (subCmd === 'model' || subCmd === '--model') {
      if (arg3) {
        return { kind: 'codex-model-set', modelId: arg3 };
      }

      return { kind: 'codex-model-show' };
    }

    return {
      kind: 'error',
      message: 'Usage: ct codex [--status|--daemon|--auth|--onboard|--model <id>] (or ct codex <status|daemon|auth|model [id]>)',
      exitCode: 1,
    };
  }

  // Unknown flags should fail explicitly; unknown words are treated as provider names.
  if (cmd.startsWith('-')) {
    return {
      kind: 'error',
      message: `Unknown option: ${cmd}`,
      exitCode: 1,
    };
  }

  return { kind: 'switch-provider', providerName: cmd };
}
