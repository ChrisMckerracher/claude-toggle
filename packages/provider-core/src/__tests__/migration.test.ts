import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProviderRepository,
  TOKENS_MIGRATION_LEDGER_KEY,
  migrateTokensJsonToProviderStore,
} from '../index.js';

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

async function createTempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.push(path);
  return path;
}

test('migrates legacy .tokens.json into codex provider credentials and is idempotent', async () => {
  const dataRoot = await createTempDir('provider-core-data-');
  const tokenRoot = await createTempDir('provider-core-token-');
  const tokenPath = join(tokenRoot, '.tokens.json');

  await writeFile(
    tokenPath,
    JSON.stringify(
      {
        refresh_token: 'refresh-token-1',
        access_token: 'access-token-1',
        expires_at: Date.now() + 3600_000,
        expires_in: 3600,
        account_id: 'acct_123',
      },
      null,
      2,
    ),
    'utf-8',
  );

  const first = await migrateTokensJsonToProviderStore({
    rootDir: dataRoot,
    tokenFilePath: tokenPath,
  });

  assert.equal(first.performed, true);

  const repository = new ProviderRepository({ rootDir: dataRoot });
  const codex = await repository.getProvider('codex');
  assert.ok(codex);

  const credentials = await repository.getCredentials(codex!.credentialsRef);
  assert.ok(credentials);
  assert.equal(credentials!.kind, 'codex');
  assert.equal(credentials!.value.extras.refresh_token, 'refresh-token-1');

  const second = await migrateTokensJsonToProviderStore({
    rootDir: dataRoot,
    tokenFilePath: tokenPath,
  });

  assert.equal(second.performed, false);
  assert.equal(second.reason, 'already_migrated');
  assert.equal(await repository.hasMigration(TOKENS_MIGRATION_LEDGER_KEY), true);
});
