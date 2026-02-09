import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  BUILTIN_ANTHROPIC_PROVIDER_NAME,
  CODEX_BASE_URL,
  CODEX_DUMMY_KEY_VALUE,
  MANAGED_BASE_URL_VARS,
  MANAGED_KEY_VARS,
  ZSHRC_MANAGED_ENV_END,
  ZSHRC_MANAGED_ENV_START,
} from '../shared/constants.js';
import type { ProviderWithCredentials } from './provider-service.js';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function normalizeBaseUrlForClaudeCode(baseUrl: string | null): string | null {
  if (!baseUrl) {
    return baseUrl;
  }

  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/v1')) {
    return trimmed.slice(0, -3);
  }

  return trimmed;
}

function buildEnvAssignments(context: ProviderWithCredentials): {
  baseUrl: string | null;
  key: string | null;
} {
  const credentials = context.credentials;

  if (context.provider.name === BUILTIN_ANTHROPIC_PROVIDER_NAME) {
    return {
      baseUrl: null,
      key: null,
    };
  }

  if (context.provider.kind === 'codex') {
    return {
      baseUrl: normalizeBaseUrlForClaudeCode(CODEX_BASE_URL),
      key: CODEX_DUMMY_KEY_VALUE,
    };
  }

  if (context.isDirectMode) {
    return {
      baseUrl: null,
      key: credentials.value.anthropic_key ?? null,
    };
  }

  return {
    baseUrl: normalizeBaseUrlForClaudeCode(credentials.value.anthropic_base_url),
    key: credentials.value.anthropic_key ?? null,
  };
}

function renderShellCommands(baseUrl: string | null, key: string | null): string[] {
  const lines: string[] = [];

  for (const variable of MANAGED_BASE_URL_VARS) {
    if (baseUrl === null || baseUrl === '') {
      lines.push(`unset ${variable}`);
    } else {
      lines.push(`export ${variable}=${shellQuote(baseUrl)}`);
    }
  }

  for (const variable of MANAGED_KEY_VARS) {
    if (!key) {
      lines.push(`unset ${variable}`);
    } else {
      lines.push(`export ${variable}=${shellQuote(key)}`);
    }
  }

  return lines;
}

async function runTmux(args: string[]): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn('tmux', args, { stdio: 'ignore' });
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });
}

function extractManagedBlock(content: string): { prefix: string; suffix: string } {
  const startCount = (content.match(new RegExp(ZSHRC_MANAGED_ENV_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
  const endCount = (content.match(new RegExp(ZSHRC_MANAGED_ENV_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;

  if (startCount > 1 || endCount > 1) {
    throw new Error('Malformed ~/.zshrc managed env markers: multiple blocks found');
  }

  if (startCount !== endCount) {
    throw new Error('Malformed ~/.zshrc managed env markers: start/end mismatch');
  }

  if (startCount === 0) {
    return { prefix: content.trimEnd(), suffix: '' };
  }

  const startIndex = content.indexOf(ZSHRC_MANAGED_ENV_START);
  const endIndex = content.indexOf(ZSHRC_MANAGED_ENV_END);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error('Malformed ~/.zshrc managed env markers: invalid ordering');
  }

  const suffixIndex = endIndex + ZSHRC_MANAGED_ENV_END.length;

  return {
    prefix: content.slice(0, startIndex).trimEnd(),
    suffix: content.slice(suffixIndex).trim(),
  };
}

export async function persistManagedZshrcBlock(context: ProviderWithCredentials): Promise<void> {
  const zshrcPath = process.env.CT_ZSHRC_PATH ?? join(homedir(), '.zshrc');
  const { baseUrl, key } = buildEnvAssignments(context);
  const commands = renderShellCommands(baseUrl, key);

  const block = [
    ZSHRC_MANAGED_ENV_START,
    ...commands,
    ZSHRC_MANAGED_ENV_END,
  ].join('\n');

  const current = existsSync(zshrcPath) ? await readFile(zshrcPath, 'utf-8') : '';
  const { prefix, suffix } = extractManagedBlock(current);

  const parts = [prefix, suffix, block].map((part) => part.trim()).filter((part) => part.length > 0);
  const next = `${parts.join('\n\n')}\n`;

  await mkdir(dirname(zshrcPath), { recursive: true });
  await writeFile(zshrcPath, next, 'utf-8');
}

export async function applyTmuxEnvironment(context: ProviderWithCredentials): Promise<void> {
  const { baseUrl, key } = buildEnvAssignments(context);

  for (const variable of MANAGED_BASE_URL_VARS) {
    if (baseUrl === null || baseUrl === '') {
      await runTmux(['set-environment', '-u', variable]);
    } else {
      await runTmux(['set-environment', variable, baseUrl]);
    }
  }

  for (const variable of MANAGED_KEY_VARS) {
    if (!key) {
      await runTmux(['set-environment', '-u', variable]);
    } else {
      await runTmux(['set-environment', variable, key]);
    }
  }
}

export function buildSwitchOutput(context: ProviderWithCredentials): string[] {
  const { baseUrl, key } = buildEnvAssignments(context);
  return renderShellCommands(baseUrl, key);
}
