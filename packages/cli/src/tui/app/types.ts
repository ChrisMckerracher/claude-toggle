import type { ProviderKind } from '@codex-proxy/provider-core';

export type Route =
  | 'home'
  | 'provider_setup'
  | 'provider_add_kind'
  | 'provider_add_name'
  | 'provider_add_generic_base'
  | 'provider_add_generic_key'
  | 'provider_switch'
  | 'provider_toggle'
  | 'provider_delete'
  | 'provider_delete_confirm'
  | 'agent_setup'
  | 'mapping_set_agent'
  | 'mapping_set_provider'
  | 'mapping_set_suffix'
  | 'mapping_delete'
  | 'project_integration'
  | 'readiness'
  | 'codex_setup'
  | 'codex_model';

export interface ProviderDraft {
  kind: ProviderKind | null;
  name: string;
  baseUrl: string;
  apiKey: string;
}

export interface MappingDraft {
  agentType: string;
  providerName: string;
  teammateSuffix: string;
}
