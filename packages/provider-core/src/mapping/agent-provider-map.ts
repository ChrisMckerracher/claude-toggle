import type { AgentProviderMapping, MappingWarning, Provider } from '../types.js';

export function mapByAgentType(mappings: AgentProviderMapping[]): Map<string, AgentProviderMapping> {
  return new Map(mappings.map((mapping) => [mapping.agentType, mapping]));
}

export function validateAgentMappings(
  mappings: AgentProviderMapping[],
  providers: Provider[],
): MappingWarning[] {
  const warnings: MappingWarning[] = [];

  for (const mapping of mappings) {
    const provider = providers.find((item) => item.name === mapping.provider);
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
