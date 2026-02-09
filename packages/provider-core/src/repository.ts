import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CODEX_DUMMY_KEY, CODEX_PROXY_BASE_URL, CREDENTIALS_VERSION, PROVIDERS_VERSION } from './constants.js';
import { NotFoundError, ParseError, ValidationError } from './errors.js';
import { resolveProviderPaths, type ProviderPaths } from './paths.js';
import {
  credentialsDocumentSchema,
  legacyProvidersDocumentSchema,
  providerCredentialsSchema,
  providersDocumentSchema,
} from './schema.js';
import type {
  AgentProviderMapping,
  CreateProviderInput,
  CredentialsDocument,
  MappingWarning,
  Provider,
  ProviderCredentials,
  ProviderRepositoryOptions,
  ProvidersDocument,
  UpdateProviderInput,
} from './types.js';

const DEFAULT_PROVIDERS_DOC: ProvidersDocument = {
  version: PROVIDERS_VERSION,
  activeProvider: null,
  providers: [],
  agentTypeMappings: [],
  migrationLedger: {},
};

const DEFAULT_CREDENTIALS_DOC: CredentialsDocument = {
  version: CREDENTIALS_VERSION,
  credentials: {},
};

function canonicalProviderName(name: string): string {
  return name.trim().toLowerCase();
}

function defaultCredentialRef(name: string): string {
  return `provider:${canonicalProviderName(name)}`;
}

function ensureKindMatchesCredentials(kind: Provider['kind'], credentials: ProviderCredentials): void {
  if (kind !== credentials.kind) {
    throw new ValidationError(`Provider kind '${kind}' does not match credentials kind '${credentials.kind}'`);
  }
}

function normalizeCredentials(credentials: ProviderCredentials): ProviderCredentials {
  if (credentials.kind === 'codex') {
    return {
      kind: 'codex',
      value: {
        anthropic_base_url: CODEX_PROXY_BASE_URL,
        anthropic_key: CODEX_DUMMY_KEY,
        extras: { ...credentials.value.extras },
      },
    };
  }

  return credentials;
}

export class ProviderRepository {
  readonly paths: ProviderPaths;

  constructor(options: ProviderRepositoryOptions = {}) {
    this.paths = resolveProviderPaths(options);
  }

  async createProvider(input: CreateProviderInput): Promise<Provider> {
    const providersDoc = await this.readProvidersDocument();
    const credentialsDoc = await this.readCredentialsDocument();

    this.assertProviderNameAvailable(input.name, providersDoc);
    this.assertCodexUniqueness(input.kind, providersDoc);
    ensureKindMatchesCredentials(input.kind, input.credentials);

    const credentials = normalizeCredentials(providerCredentialsSchema.parse(input.credentials));
    credentialsDoc.credentials[input.credentialsRef] = credentials;

    const provider: Provider = {
      name: input.name,
      kind: input.kind,
      enabled: input.enabled ?? true,
      credentialsRef: input.credentialsRef,
    };

    providersDoc.providers.push(provider);
    if (!providersDoc.activeProvider && provider.enabled) {
      providersDoc.activeProvider = provider.name;
    }

    await this.writeCredentialsDocument(credentialsDoc);
    await this.writeProvidersDocument(providersDoc);

    return provider;
  }

  async getProvider(name: string): Promise<Provider | null> {
    const doc = await this.readProvidersDocument();
    return doc.providers.find((provider) => provider.name === name) ?? null;
  }

  async listProviders(): Promise<Provider[]> {
    const doc = await this.readProvidersDocument();
    return [...doc.providers];
  }

  async updateProvider(name: string, updates: UpdateProviderInput): Promise<Provider> {
    const doc = await this.readProvidersDocument();
    const provider = doc.providers.find((item) => item.name === name);

    if (!provider) {
      throw new NotFoundError(`Provider not found: ${name}`);
    }

    if (updates.kind && updates.kind !== provider.kind) {
      this.assertCodexUniqueness(updates.kind, doc, provider.name);
      provider.kind = updates.kind;
    }

    if (updates.enabled !== undefined) {
      provider.enabled = updates.enabled;
    }

    if (updates.credentialsRef) {
      const credentialsDoc = await this.readCredentialsDocument();
      if (!credentialsDoc.credentials[updates.credentialsRef]) {
        throw new ValidationError(`Credentials ref not found: ${updates.credentialsRef}`);
      }
      provider.credentialsRef = updates.credentialsRef;
    }

    if (doc.activeProvider === provider.name && !provider.enabled) {
      doc.activeProvider = doc.providers.find((item) => item.enabled && item.name !== provider.name)?.name ?? null;
    }

    await this.writeProvidersDocument(doc);
    return { ...provider };
  }

  async deleteProvider(name: string): Promise<void> {
    const doc = await this.readProvidersDocument();
    const credentialsDoc = await this.readCredentialsDocument();
    const index = doc.providers.findIndex((provider) => provider.name === name);

    if (index === -1) {
      throw new NotFoundError(`Provider not found: ${name}`);
    }

    const [removed] = doc.providers.splice(index, 1);

    if (doc.activeProvider === name) {
      doc.activeProvider = doc.providers.find((provider) => provider.enabled)?.name ?? null;
    }

    doc.agentTypeMappings = doc.agentTypeMappings.filter((mapping) => mapping.provider !== name);

    const stillReferenced = doc.providers.some((provider) => provider.credentialsRef === removed.credentialsRef);
    if (!stillReferenced) {
      delete credentialsDoc.credentials[removed.credentialsRef];
    }

    await this.writeCredentialsDocument(credentialsDoc);
    await this.writeProvidersDocument(doc);
  }

  async setActiveProvider(name: string): Promise<Provider> {
    const doc = await this.readProvidersDocument();
    const provider = doc.providers.find((item) => item.name === name);

    if (!provider) {
      throw new NotFoundError(`Provider not found: ${name}`);
    }

    if (!provider.enabled) {
      throw new ValidationError(`Provider is disabled: ${name}`);
    }

    doc.activeProvider = name;
    await this.writeProvidersDocument(doc);

    return { ...provider };
  }

  async getActiveProvider(): Promise<Provider | null> {
    const doc = await this.readProvidersDocument();
    if (!doc.activeProvider) {
      return null;
    }

    return doc.providers.find((item) => item.name === doc.activeProvider) ?? null;
  }

  async saveCredentials(ref: string, credentials: ProviderCredentials): Promise<void> {
    const doc = await this.readCredentialsDocument();
    doc.credentials[ref] = normalizeCredentials(providerCredentialsSchema.parse(credentials));
    await this.writeCredentialsDocument(doc);
  }

  async getCredentials(ref: string): Promise<ProviderCredentials | null> {
    const doc = await this.readCredentialsDocument();
    return doc.credentials[ref] ?? null;
  }

  async deleteCredentials(ref: string): Promise<void> {
    const providers = await this.readProvidersDocument();
    const isReferenced = providers.providers.some((provider) => provider.credentialsRef === ref);

    if (isReferenced) {
      throw new ValidationError(`Cannot delete credentials '${ref}' because it is referenced by a provider`);
    }

    const credentials = await this.readCredentialsDocument();
    delete credentials.credentials[ref];
    await this.writeCredentialsDocument(credentials);
  }

  async setAgentProviderMapping(agentType: string, providerName: string, teammateSuffix?: string): Promise<void> {
    const providers = await this.readProvidersDocument();
    const provider = providers.providers.find((item) => item.name === providerName);

    if (!provider) {
      throw new ValidationError(`Cannot map agent '${agentType}' to missing provider '${providerName}'`);
    }

    const existing = providers.agentTypeMappings.find((mapping) => mapping.agentType === agentType);

    if (existing) {
      existing.provider = providerName;
      existing.teammateSuffix = teammateSuffix;
    } else {
      providers.agentTypeMappings.push({
        agentType,
        provider: providerName,
        teammateSuffix,
      });
    }

    await this.writeProvidersDocument(providers);
  }

  async deleteAgentProviderMapping(agentType: string): Promise<void> {
    const providers = await this.readProvidersDocument();
    providers.agentTypeMappings = providers.agentTypeMappings.filter((mapping) => mapping.agentType !== agentType);
    await this.writeProvidersDocument(providers);
  }

  async listAgentProviderMappings(): Promise<AgentProviderMapping[]> {
    const providers = await this.readProvidersDocument();
    return [...providers.agentTypeMappings];
  }

  async validateMappings(): Promise<MappingWarning[]> {
    const providersDoc = await this.readProvidersDocument();
    const warnings: MappingWarning[] = [];

    for (const mapping of providersDoc.agentTypeMappings) {
      const provider = providersDoc.providers.find((item) => item.name === mapping.provider);
      if (!provider) {
        warnings.push({
          agentType: mapping.agentType,
          provider: mapping.provider,
          reason: 'missing_provider',
        });
        continue;
      }

      if (!provider.enabled) {
        warnings.push({
          agentType: mapping.agentType,
          provider: mapping.provider,
          reason: 'disabled_provider',
        });
      }
    }

    return warnings;
  }

  async hasMigration(key: string): Promise<boolean> {
    const doc = await this.readProvidersDocument();
    return doc.migrationLedger[key] !== undefined;
  }

  async markMigrationComplete(key: string): Promise<void> {
    const doc = await this.readProvidersDocument();
    doc.migrationLedger[key] = Date.now();
    await this.writeProvidersDocument(doc);
  }

  async ensureCodexProvider(credentialsRef = defaultCredentialRef('codex')): Promise<Provider> {
    const providersDoc = await this.readProvidersDocument();
    const existing = providersDoc.providers.find((provider) => provider.kind === 'codex');

    if (existing) {
      const normalized: Provider = {
        ...existing,
        name: 'codex',
        kind: 'codex',
        enabled: true,
        credentialsRef,
      };

      Object.assign(existing, normalized);
      await this.writeProvidersDocument(providersDoc);
      return normalized;
    }

    const provider: Provider = {
      name: 'codex',
      kind: 'codex',
      enabled: true,
      credentialsRef,
    };

    providersDoc.providers.push(provider);
    if (!providersDoc.activeProvider) {
      providersDoc.activeProvider = provider.name;
    }

    await this.writeProvidersDocument(providersDoc);
    return provider;
  }

  private assertProviderNameAvailable(name: string, doc: ProvidersDocument): void {
    const exact = doc.providers.find((provider) => provider.name === name);
    if (exact) {
      throw new ValidationError(`Provider already exists: ${name}`);
    }

    const canonical = canonicalProviderName(name);
    const collision = doc.providers.find((provider) => canonicalProviderName(provider.name) === canonical);
    if (collision) {
      throw new ValidationError(`Provider near-duplicate collision with existing name '${collision.name}'`);
    }
  }

  private assertCodexUniqueness(kind: Provider['kind'], doc: ProvidersDocument, excludeName?: string): void {
    if (kind !== 'codex') {
      return;
    }

    const codexProvider = doc.providers.find((provider) => provider.kind === 'codex' && provider.name !== excludeName);
    if (codexProvider) {
      throw new ValidationError(`Only one codex provider is allowed (existing: ${codexProvider.name})`);
    }
  }

  private async readProvidersDocument(): Promise<ProvidersDocument> {
    await this.ensureStorageFiles();

    const raw = await this.readJsonFile(this.paths.providersFile);
    const parsed = providersDocumentSchema.safeParse(raw);

    if (parsed.success) {
      return parsed.data;
    }

    const legacy = legacyProvidersDocumentSchema.safeParse(raw);
    if (!legacy.success) {
      throw new ParseError(`Invalid providers config: ${parsed.error.issues[0]?.message ?? 'unknown error'}`);
    }

    const migrated = await this.migrateLegacyProvidersDocument(legacy.data);
    return migrated;
  }

  private async readCredentialsDocument(): Promise<CredentialsDocument> {
    await this.ensureStorageFiles();

    const raw = await this.readJsonFile(this.paths.credentialsFile);
    const parsed = credentialsDocumentSchema.safeParse(raw);

    if (!parsed.success) {
      throw new ParseError(`Invalid credentials config: ${parsed.error.issues[0]?.message ?? 'unknown error'}`);
    }

    return parsed.data;
  }

  private async migrateLegacyProvidersDocument(legacy: {
    providers: Array<{ name: string; type: 'direct' | 'codex' | 'generic'; baseUrl?: string; enabled?: boolean }>;
    active: string;
    agentCategories: Array<{ name: string; provider: string }>;
  }): Promise<ProvidersDocument> {
    const credentialsDoc = await this.readCredentialsDocument();

    const providers: Provider[] = legacy.providers.map((provider) => {
      const kind: Provider['kind'] = provider.type === 'direct' ? 'anthropic' : provider.type;
      const credentialsRef = defaultCredentialRef(provider.name);

      if (!credentialsDoc.credentials[credentialsRef]) {
        credentialsDoc.credentials[credentialsRef] = this.legacyProviderToCredentials(provider, kind);
      }

      return {
        name: provider.name,
        kind,
        enabled: provider.enabled ?? true,
        credentialsRef,
      };
    });

    const activeProvider = providers.some((provider) => provider.name === legacy.active)
      ? legacy.active
      : providers.find((provider) => provider.enabled)?.name ?? null;

    const doc: ProvidersDocument = {
      version: PROVIDERS_VERSION,
      activeProvider,
      providers,
      agentTypeMappings: legacy.agentCategories.map((category) => ({
        agentType: category.name,
        provider: category.provider,
      })),
      migrationLedger: {},
    };

    await this.writeCredentialsDocument(credentialsDoc);
    await this.writeProvidersDocument(doc);

    return doc;
  }

  private legacyProviderToCredentials(
    provider: { type: 'direct' | 'codex' | 'generic'; baseUrl?: string },
    kind: Provider['kind'],
  ): ProviderCredentials {
    if (kind === 'codex') {
      return {
        kind: 'codex',
        value: {
          anthropic_base_url: CODEX_PROXY_BASE_URL,
          anthropic_key: CODEX_DUMMY_KEY,
          extras: {
            refresh_token: '',
          },
        },
      };
    }

    if (provider.type === 'direct') {
      return {
        kind: 'anthropic',
        value: {
          anthropic_base_url: '',
          extras: {},
        },
      };
    }

    return {
      kind,
      value: {
        anthropic_base_url: provider.baseUrl ?? '',
        extras: {},
      },
    };
  }

  private async ensureStorageFiles(): Promise<void> {
    await mkdir(this.paths.rootDir, { recursive: true });

    if (!existsSync(this.paths.providersFile)) {
      await this.writeJsonAtomically(this.paths.providersFile, DEFAULT_PROVIDERS_DOC);
    }

    if (!existsSync(this.paths.credentialsFile)) {
      await this.writeJsonAtomically(this.paths.credentialsFile, DEFAULT_CREDENTIALS_DOC);
    }
  }

  private async readJsonFile(path: string): Promise<unknown> {
    try {
      const data = await readFile(path, 'utf-8');
      return JSON.parse(data) as unknown;
    } catch (error) {
      const typedError = error as NodeJS.ErrnoException;
      if (typedError.code === 'ENOENT') {
        return {};
      }
      if (typedError.name === 'SyntaxError') {
        throw new ParseError(`Failed parsing JSON at ${path}`);
      }
      throw error;
    }
  }

  private async writeProvidersDocument(doc: ProvidersDocument): Promise<void> {
    const parsed = providersDocumentSchema.parse(doc);
    await this.writeJsonAtomically(this.paths.providersFile, parsed);
  }

  private async writeCredentialsDocument(doc: CredentialsDocument): Promise<void> {
    const parsed = credentialsDocumentSchema.parse(doc);
    await this.writeJsonAtomically(this.paths.credentialsFile, parsed);
  }

  private async writeJsonAtomically(path: string, value: unknown): Promise<void> {
    const content = JSON.stringify(value, null, 2);
    const tmpPath = join(this.paths.rootDir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      await writeFile(tmpPath, content, 'utf-8');
      await rename(tmpPath, path);
    } catch (error) {
      const typedError = error as NodeJS.ErrnoException;
      if (typedError.code === 'EACCES' || typedError.code === 'EPERM') {
        throw new ValidationError(
          `Provider store path is not writable (${this.paths.rootDir}). Set CT_DATA_DIR to a writable location.`,
        );
      }
      throw error;
    }
  }
}
