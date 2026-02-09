import {
  CODEX_DEFAULT_MODEL,
  CODEX_SUPPORTED_MODELS,
  NotFoundError,
  type MappingWarning,
  type Provider,
  type ProviderKind,
  type ProviderCredentials,
} from '@codex-proxy/provider-core';
import { ensureProviderStoreReady, getProviderRepository } from './provider-store.js';
import { BUILTIN_ANTHROPIC_PROVIDER_NAME, LEGACY_DIRECT_PROVIDER_NAME } from '../shared/constants.js';

export interface ProviderWithCredentials {
  provider: Provider;
  credentials: ProviderCredentials;
  isDirectMode: boolean;
}

export interface CreateProviderParams {
  name: string;
  kind: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
}

export interface CodexModelOption {
  id: string;
  name: string;
}

const SUPPORTED_CODEX_MODEL_IDS: Set<string> = new Set(CODEX_SUPPORTED_MODELS.map((model) => model.id));

function canonicalRef(name: string): string {
  return `provider:${name.trim().toLowerCase()}`;
}

function canonicalProviderName(name: string): string {
  return name.trim().toLowerCase();
}

function isBuiltinAnthropicName(name: string): boolean {
  return canonicalProviderName(name) === BUILTIN_ANTHROPIC_PROVIDER_NAME;
}

function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[a.length][b.length];
}

function nearestProviderNames(target: string, names: string[]): string[] {
  return [...names]
    .map((name) => ({ name, score: editDistance(target.toLowerCase(), name.toLowerCase()) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((item) => item.name);
}

async function getProviderWithCredentialsByName(name: string): Promise<ProviderWithCredentials> {
  const repository = getProviderRepository();
  const provider = await repository.getProvider(name);

  if (!provider) {
    const names = (await repository.listProviders()).map((item) => item.name);
    const nearest = nearestProviderNames(name, names);
    const suggestion = nearest.length > 0 ? ` Did you mean: ${nearest.join(', ')}?` : '';
    throw new NotFoundError(`Provider not found: ${name}.${suggestion}`);
  }

  if (!provider.enabled) {
    throw new Error(`Provider is disabled: ${name}`);
  }

  const credentials = await repository.getCredentials(provider.credentialsRef);
  if (!credentials) {
    throw new Error(`Credentials missing for provider '${name}'`);
  }

  const isDirectMode = provider.kind === 'anthropic' && credentials.value.anthropic_base_url.trim() === '';

  return {
    provider,
    credentials,
    isDirectMode,
  };
}

export async function switchProvider(providerName: string): Promise<ProviderWithCredentials> {
  await ensureProviderStoreReady();
  const repository = getProviderRepository();
  const providers = await repository.listProviders();
  if (providers.length === 0) {
    throw new Error('No providers configured. Add one with `ct provider add <name> <generic|codex>`');
  }

  const normalized = canonicalProviderName(providerName);
  const resolvedName = normalized === LEGACY_DIRECT_PROVIDER_NAME ? BUILTIN_ANTHROPIC_PROVIDER_NAME : providerName;
  const context = await getProviderWithCredentialsByName(resolvedName);
  await repository.setActiveProvider(context.provider.name);
  return context;
}

export async function getActiveProviderWithCredentials(): Promise<ProviderWithCredentials | null> {
  await ensureProviderStoreReady();
  const repository = getProviderRepository();
  const active = await repository.getActiveProvider();
  if (!active) {
    return null;
  }
  return getProviderWithCredentialsByName(active.name);
}

export async function getProviderSnapshot(): Promise<{
  activeProviderName: string | null;
  providers: Provider[];
  mappingWarnings: MappingWarning[];
}> {
  await ensureProviderStoreReady();
  const repository = getProviderRepository();

  const active = await repository.getActiveProvider();
  const providers = await repository.listProviders();
  const mappingWarnings = await repository.validateMappings();

  return {
    activeProviderName: active?.name ?? null,
    providers,
    mappingWarnings,
  };
}

export async function getMappingsAndProviders() {
  await ensureProviderStoreReady();
  const repository = getProviderRepository();
  const mappings = await repository.listAgentProviderMappings();
  const providers = await repository.listProviders();
  const warnings = await repository.validateMappings();

  return { mappings, providers, warnings };
}

export async function listProvidersDetailed(): Promise<Array<ProviderWithCredentials>> {
  await ensureProviderStoreReady();
  const repository = getProviderRepository();
  const providers = await repository.listProviders();
  const result: Array<ProviderWithCredentials> = [];

  for (const provider of providers) {
    const credentials = await repository.getCredentials(provider.credentialsRef);
    if (!credentials) {
      continue;
    }

    result.push({
      provider,
      credentials,
      isDirectMode: provider.kind === 'anthropic' && credentials.value.anthropic_base_url.trim() === '',
    });
  }

  return result;
}

export async function createProvider(params: CreateProviderParams): Promise<Provider> {
  await ensureProviderStoreReady();
  const repository = getProviderRepository();
  const name = params.name.trim();
  const canonicalName = canonicalProviderName(name);

  if (isBuiltinAnthropicName(canonicalName)) {
    throw new Error(`Provider '${BUILTIN_ANTHROPIC_PROVIDER_NAME}' is system-managed and cannot be created manually`);
  }

  const credentialsRef = canonicalRef(name);

  if (params.kind === 'generic' && (!params.baseUrl || params.baseUrl.trim() === '')) {
    throw new Error('Generic provider requires baseUrl');
  }

  const baseUrl = params.kind === 'codex' ? '' : params.baseUrl ?? '';

  const credentials: ProviderCredentials =
    params.kind === 'codex'
      ? {
          kind: 'codex',
          value: {
            anthropic_base_url: '',
            anthropic_key: undefined,
            extras: {
              refresh_token: '',
            },
          },
        }
      : {
          kind: params.kind,
          value: {
            anthropic_base_url: baseUrl,
            anthropic_key: params.apiKey,
            extras: {},
          },
        };

  return repository.createProvider({
    name,
    kind: params.kind,
    enabled: true,
    credentialsRef,
    credentials,
  });
}

export async function deleteProvider(name: string): Promise<void> {
  await ensureProviderStoreReady();
  if (isBuiltinAnthropicName(name)) {
    throw new Error(`Provider '${BUILTIN_ANTHROPIC_PROVIDER_NAME}' is system-managed and cannot be deleted`);
  }
  const repository = getProviderRepository();
  await repository.deleteProvider(name);
}

export async function setProviderEnabled(name: string, enabled: boolean): Promise<void> {
  await ensureProviderStoreReady();
  if (isBuiltinAnthropicName(name)) {
    throw new Error(`Provider '${BUILTIN_ANTHROPIC_PROVIDER_NAME}' is system-managed and always enabled`);
  }
  const repository = getProviderRepository();
  await repository.updateProvider(name, { enabled });
}

export async function listMappingsWithWarnings(): Promise<{
  mappings: Array<{ agentType: string; provider: string; teammateSuffix?: string }>;
  warnings: MappingWarning[];
}> {
  await ensureProviderStoreReady();
  const repository = getProviderRepository();
  const mappings = await repository.listAgentProviderMappings();
  const warnings = await repository.validateMappings();
  return { mappings, warnings };
}

export async function setMapping(
  agentType: string,
  providerName: string,
  teammateSuffix?: string,
): Promise<void> {
  await ensureProviderStoreReady();
  const repository = getProviderRepository();
  await repository.setAgentProviderMapping(agentType, providerName, teammateSuffix);
}

export async function deleteMapping(agentType: string): Promise<void> {
  await ensureProviderStoreReady();
  const repository = getProviderRepository();
  await repository.deleteAgentProviderMapping(agentType);
}

export function listCodexModels(): CodexModelOption[] {
  return CODEX_SUPPORTED_MODELS.map((model) => ({ id: model.id, name: model.name }));
}

export async function getCodexModel(): Promise<string> {
  await ensureProviderStoreReady();
  const repository = getProviderRepository();
  const provider = await repository.getProvider('codex');

  if (!provider || provider.kind !== 'codex') {
    return CODEX_DEFAULT_MODEL;
  }

  const credentials = await repository.getCredentials(provider.credentialsRef);
  if (!credentials || credentials.kind !== 'codex') {
    return CODEX_DEFAULT_MODEL;
  }

  const model = credentials.value.extras.model;
  if (typeof model !== 'string' || !SUPPORTED_CODEX_MODEL_IDS.has(model)) {
    return CODEX_DEFAULT_MODEL;
  }

  return model;
}

export async function setCodexModel(modelId: string): Promise<string> {
  await ensureProviderStoreReady();
  const normalized = modelId.trim();

  if (!SUPPORTED_CODEX_MODEL_IDS.has(normalized)) {
    const available = [...SUPPORTED_CODEX_MODEL_IDS].join(', ');
    throw new Error(`Unsupported codex model '${modelId}'. Available: ${available}`);
  }

  const repository = getProviderRepository();
  const provider = await repository.getProvider('codex');
  if (!provider || provider.kind !== 'codex') {
    throw new Error('Codex provider is not configured');
  }

  const credentials = await repository.getCredentials(provider.credentialsRef);
  if (!credentials || credentials.kind !== 'codex') {
    throw new Error('Codex credentials are not configured');
  }

  await repository.saveCredentials(provider.credentialsRef, {
    kind: 'codex',
    value: {
      ...credentials.value,
      extras: {
        ...credentials.value.extras,
        model: normalized,
      },
    },
  });

  return normalized;
}
