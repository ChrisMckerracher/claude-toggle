import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderRepository, ValidationError } from '../index.js';

const pathsToCleanup: string[] = [];

afterEach(async () => {
  while (pathsToCleanup.length > 0) {
    const path = pathsToCleanup.pop();
    if (path) {
      await rm(path, { recursive: true, force: true });
    }
  }
});

async function createRepo(): Promise<ProviderRepository> {
  const root = await mkdtemp(join(tmpdir(), 'provider-core-'));
  pathsToCleanup.push(root);
  return new ProviderRepository({ rootDir: root });
}

test('creates provider, sets active provider, and validates disabled mapping warnings', async () => {
  const repository = await createRepo();

  await repository.createProvider({
    name: 'direct',
    kind: 'anthropic',
    credentialsRef: 'provider:direct',
    credentials: {
      kind: 'anthropic',
      value: {
        anthropic_base_url: '',
        extras: {},
      },
    },
  });

  await repository.createProvider({
    name: 'openrouter',
    kind: 'generic',
    credentialsRef: 'provider:openrouter',
    credentials: {
      kind: 'generic',
      value: {
        anthropic_base_url: 'https://openrouter.ai/api/v1',
        anthropic_key: 'abc123',
        extras: {},
      },
    },
  });

  await repository.setActiveProvider('openrouter');
  await repository.setAgentProviderMapping('research', 'openrouter');

  const active = await repository.getActiveProvider();
  assert.equal(active?.name, 'openrouter');

  await repository.updateProvider('openrouter', { enabled: false });
  const warnings = await repository.validateMappings();

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].reason, 'disabled_provider');
});

test('rejects provider near-duplicates by canonical name', async () => {
  const repository = await createRepo();

  await repository.createProvider({
    name: 'zai',
    kind: 'generic',
    credentialsRef: 'provider:zai',
    credentials: {
      kind: 'generic',
      value: {
        anthropic_base_url: 'https://z.ai/v1',
        extras: {},
      },
    },
  });

  await assert.rejects(
    async () => {
      await repository.createProvider({
        name: ' ZAI ',
        kind: 'generic',
        credentialsRef: 'provider:zai2',
        credentials: {
          kind: 'generic',
          value: {
            anthropic_base_url: 'https://z.ai/v2',
            extras: {},
          },
        },
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.match((error as Error).message, /near-duplicate/i);
      return true;
    },
  );
});

test('migrates legacy providers.json shape on first read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'provider-core-legacy-'));
  pathsToCleanup.push(root);

  await writeFile(
    join(root, 'providers.json'),
    JSON.stringify(
      {
        version: 1,
        providers: [
          { name: 'direct', type: 'direct', enabled: true },
          { name: 'codex', type: 'codex', baseUrl: 'http://127.0.0.1:4096/v1', enabled: true },
        ],
        active: 'direct',
        agentCategories: [{ name: 'coder', provider: 'codex' }],
      },
      null,
      2,
    ),
    'utf-8',
  );

  const repository = new ProviderRepository({ rootDir: root });
  const providers = await repository.listProviders();
  const mappings = await repository.listAgentProviderMappings();

  assert.equal(providers.length, 2);
  assert.equal(providers[0].kind, 'anthropic');
  assert.equal(mappings.length, 1);
  assert.equal(mappings[0].agentType, 'coder');
});
