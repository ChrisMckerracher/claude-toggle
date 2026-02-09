/**
 * Backward-compatible CLAUDE.md integration wrappers.
 */

import { renderTeammateSection, type AgentProviderMapping, type Provider } from '@codex-proxy/provider-core';
import { initClaudeMdManagedSection } from './services/claude.js';
import { getMappingsAndProviders } from './services/provider-service.js';

export async function initClaudeMd(projectPath = process.cwd()): Promise<void> {
  await initClaudeMdManagedSection(projectPath);
  console.log('\x1b[32m✓ Updated managed teammate section in CLAUDE.md\x1b[0m');
}

export function generateProviderSection(config: {
  providers: Provider[];
  agentTypeMappings?: AgentProviderMapping[];
  agentCategories?: Array<{ name: string; provider: string }>;
}): string {
  const mappings = config.agentTypeMappings ?? config.agentCategories?.map((category) => ({
    agentType: category.name,
    provider: category.provider,
  })) ?? [];

  return renderTeammateSection({
    mappings,
    providers: config.providers,
    warnings: [],
  });
}

export async function getProviderSectionFromStore(): Promise<string> {
  const { mappings, providers, warnings } = await getMappingsAndProviders();
  return renderTeammateSection({ mappings, providers, warnings });
}
