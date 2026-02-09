import {
  migrateTokensJsonToProviderStore,
  ProviderRepository,
  type ProviderCredentials,
  type MigrationResult,
} from '@codex-proxy/provider-core';
import {
  BUILTIN_ANTHROPIC_PROVIDER_NAME,
  CODEX_BASE_URL,
  CODEX_DUMMY_KEY_VALUE,
  LEGACY_DIRECT_PROVIDER_NAME,
} from '../shared/constants.js';

let repository: ProviderRepository | null = null;
let migrationPromise: Promise<MigrationResult> | null = null;

export function getProviderRepository(): ProviderRepository {
  if (!repository) {
    repository = new ProviderRepository();
  }

  return repository;
}

export async function ensureProviderStoreReady(): Promise<MigrationResult> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const result = await migrateTokensJsonToProviderStore();
      await ensureBootstrapProviders(getProviderRepository());
      return result;
    })();
  }

  return migrationPromise;
}

async function ensureBootstrapProviders(repository: ProviderRepository): Promise<void> {
  const providers = await repository.listProviders();
  const hasAnthropic = providers.some((provider) => provider.name === BUILTIN_ANTHROPIC_PROVIDER_NAME);
  const hasCodex = providers.some((provider) => provider.kind === 'codex');

  if (!hasAnthropic) {
    const legacyDirect = providers.find((provider) => provider.name === LEGACY_DIRECT_PROVIDER_NAME && provider.kind === 'anthropic');

    if (legacyDirect) {
      const legacyCredentials = await repository.getCredentials(legacyDirect.credentialsRef);
      const credentials: ProviderCredentials = legacyCredentials ?? {
        kind: 'anthropic',
        value: {
          anthropic_base_url: '',
          extras: {},
        },
      };

      await repository.createProvider({
        name: BUILTIN_ANTHROPIC_PROVIDER_NAME,
        kind: 'anthropic',
        credentialsRef: `provider:${BUILTIN_ANTHROPIC_PROVIDER_NAME}`,
        credentials,
      });

      const mappings = await repository.listAgentProviderMappings();
      for (const mapping of mappings.filter((item) => item.provider === LEGACY_DIRECT_PROVIDER_NAME)) {
        await repository.setAgentProviderMapping(mapping.agentType, BUILTIN_ANTHROPIC_PROVIDER_NAME, mapping.teammateSuffix);
      }

      const active = await repository.getActiveProvider();
      if (active?.name === LEGACY_DIRECT_PROVIDER_NAME) {
        await repository.setActiveProvider(BUILTIN_ANTHROPIC_PROVIDER_NAME);
      }

      await repository.deleteProvider(LEGACY_DIRECT_PROVIDER_NAME);
    } else {
      await repository.createProvider({
        name: BUILTIN_ANTHROPIC_PROVIDER_NAME,
        kind: 'anthropic',
        credentialsRef: `provider:${BUILTIN_ANTHROPIC_PROVIDER_NAME}`,
        credentials: {
          kind: 'anthropic',
          value: {
            anthropic_base_url: '',
            extras: {},
          },
        },
      });
    }
  }

  const anthropic = await repository.getProvider(BUILTIN_ANTHROPIC_PROVIDER_NAME);
  if (anthropic && !anthropic.enabled) {
    await repository.updateProvider(BUILTIN_ANTHROPIC_PROVIDER_NAME, { enabled: true });
  }

  if (!hasCodex) {
    await repository.createProvider({
      name: 'codex',
      kind: 'codex',
      credentialsRef: 'provider:codex',
      credentials: {
        kind: 'codex',
        value: {
          anthropic_base_url: CODEX_BASE_URL,
          anthropic_key: CODEX_DUMMY_KEY_VALUE,
          extras: {
            refresh_token: '',
          },
        },
      },
    });
  }
}

export function resetProviderStoreForTests(): void {
  repository = null;
  migrationPromise = null;
}
