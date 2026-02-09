export type ProviderKind = 'anthropic' | 'generic' | 'codex';

export interface ProviderCredentialsBase<TExtras extends object = Record<string, unknown>> {
  anthropic_base_url: string;
  anthropic_key?: string;
  extras: TExtras;
}

export interface CodexExtras {
  refresh_token: string;
  access_token?: string;
  expires_at?: number;
  expires_in?: number;
  account_id?: string;
  model?: string;
}

export type ProviderCredentials =
  | {
      kind: 'codex';
      value: ProviderCredentialsBase<CodexExtras>;
    }
  | {
      kind: 'anthropic' | 'generic';
      value: ProviderCredentialsBase<Record<string, unknown>>;
    };

export interface Provider {
  name: string;
  kind: ProviderKind;
  enabled: boolean;
  credentialsRef: string;
}

export interface AgentProviderMapping {
  agentType: string;
  provider: string;
  teammateSuffix?: string;
}

export interface MappingWarning {
  agentType: string;
  provider: string;
  reason: 'missing_provider' | 'disabled_provider';
}

export interface ProvidersDocument {
  version: number;
  activeProvider: string | null;
  providers: Provider[];
  agentTypeMappings: AgentProviderMapping[];
  migrationLedger: Record<string, number>;
}

export interface CredentialsDocument {
  version: number;
  credentials: Record<string, ProviderCredentials>;
}

export interface CreateProviderInput {
  name: string;
  kind: ProviderKind;
  enabled?: boolean;
  credentialsRef: string;
  credentials: ProviderCredentials;
}

export interface UpdateProviderInput {
  kind?: ProviderKind;
  enabled?: boolean;
  credentialsRef?: string;
}

export interface ProviderRepositoryOptions {
  rootDir?: string;
}

export interface MigrationResult {
  performed: boolean;
  reason?: string;
  sourcePath?: string;
}
