import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CODEX_DUMMY_KEY,
  CODEX_PROXY_BASE_URL,
  TOKENS_MIGRATION_LEDGER_KEY,
} from '../constants.js';
import type { MigrationResult, ProviderRepositoryOptions } from '../types.js';
import { ProviderRepository } from '../repository.js';

interface LegacyTokensFile {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  account_id?: string;
}

export interface TokensMigrationOptions extends ProviderRepositoryOptions {
  tokenFilePath?: string;
}

function getTokenFileCandidates(explicitPath?: string): string[] {
  const candidates = [
    explicitPath,
    process.env.CODEX_PROXY_TOKEN_FILE,
    join(process.cwd(), '.tokens.json'),
    join(homedir(), '.codex-proxy', 'tokens.json'),
    join(homedir(), '.local', 'share', 'ct', 'tokens.json'),
  ].filter((item): item is string => Boolean(item));

  return [...new Set(candidates)];
}

async function readLegacyTokens(path: string): Promise<LegacyTokensFile | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as LegacyTokensFile;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function findFirstExistingPath(paths: string[]): string | null {
  for (const path of paths) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

export async function migrateTokensJsonToProviderStore(
  options: TokensMigrationOptions = {},
): Promise<MigrationResult> {
  const repository = new ProviderRepository(options);

  if (await repository.hasMigration(TOKENS_MIGRATION_LEDGER_KEY)) {
    return {
      performed: false,
      reason: 'already_migrated',
    };
  }

  const sourcePath = findFirstExistingPath(getTokenFileCandidates(options.tokenFilePath));
  if (!sourcePath) {
    return {
      performed: false,
      reason: 'tokens_file_not_found',
    };
  }

  const tokens = await readLegacyTokens(sourcePath);
  if (!tokens?.refresh_token) {
    return {
      performed: false,
      reason: 'tokens_missing_refresh_token',
      sourcePath,
    };
  }

  const credentialsRef = 'provider:codex';

  await repository.saveCredentials(credentialsRef, {
    kind: 'codex',
    value: {
      anthropic_base_url: CODEX_PROXY_BASE_URL,
      anthropic_key: CODEX_DUMMY_KEY,
      extras: {
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        expires_at: tokens.expires_at,
        expires_in: tokens.expires_in,
        account_id: tokens.account_id,
      },
    },
  });

  await repository.ensureCodexProvider(credentialsRef);
  await repository.markMigrationComplete(TOKENS_MIGRATION_LEDGER_KEY);

  return {
    performed: true,
    sourcePath,
  };
}
