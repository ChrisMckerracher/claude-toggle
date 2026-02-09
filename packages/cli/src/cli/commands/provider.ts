import type { ProviderKind } from '@codex-proxy/provider-core';
import {
  createProvider,
  deleteProvider,
  listProvidersDetailed,
  setProviderEnabled,
} from '../../services/provider-service.js';
import { BUILTIN_ANTHROPIC_PROVIDER_NAME } from '../../shared/constants.js';
import { failure, success, type CommandResult } from '../types.js';

export async function runProviderList(): Promise<CommandResult> {
  try {
    const providers = await listProvidersDetailed();
    const lines = ['Providers:', ''];

    for (const item of providers) {
      const status = item.provider.enabled ? 'enabled' : 'disabled';
      const kind = item.provider.kind;
      const builtin = item.provider.name === BUILTIN_ANTHROPIC_PROVIDER_NAME ? ' (builtin)' : '';
      const base = item.credentials.value.anthropic_base_url || '(unset)';
      lines.push(`- ${item.provider.name} [${kind}] ${status}${builtin}`);
      lines.push(`  ref: ${item.provider.credentialsRef}`);
      lines.push(`  base_url: ${base}`);
    }

    if (providers.length === 0) {
      lines.push('(none)');
    }

    return success(lines);
  } catch (err) {
    const error = err as Error;
    return failure([`\x1b[31mError: ${error.message}\x1b[0m`]);
  }
}

export async function runProviderCreate(args: {
  name: string;
  kind: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
}): Promise<CommandResult> {
  try {
    const provider = await createProvider(args);
    return success([`\x1b[32m✓ Created provider '${provider.name}' (${provider.kind})\x1b[0m`]);
  } catch (err) {
    const error = err as Error;
    return failure([`\x1b[31mError: ${error.message}\x1b[0m`]);
  }
}

export async function runProviderDelete(name: string): Promise<CommandResult> {
  try {
    await deleteProvider(name);
    return success([`\x1b[32m✓ Deleted provider '${name}'\x1b[0m`]);
  } catch (err) {
    const error = err as Error;
    return failure([`\x1b[31mError: ${error.message}\x1b[0m`]);
  }
}

export async function runProviderEnable(name: string): Promise<CommandResult> {
  try {
    await setProviderEnabled(name, true);
    return success([`\x1b[32m✓ Enabled provider '${name}'\x1b[0m`]);
  } catch (err) {
    const error = err as Error;
    return failure([`\x1b[31mError: ${error.message}\x1b[0m`]);
  }
}

export async function runProviderDisable(name: string): Promise<CommandResult> {
  try {
    await setProviderEnabled(name, false);
    return success([`\x1b[32m✓ Disabled provider '${name}'\x1b[0m`]);
  } catch (err) {
    const error = err as Error;
    return failure([`\x1b[31mError: ${error.message}\x1b[0m`]);
  }
}
