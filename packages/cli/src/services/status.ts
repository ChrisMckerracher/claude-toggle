import type { MappingWarning, Provider } from '@codex-proxy/provider-core';

export function formatProviderStatus(snapshot: {
  activeProviderName: string | null;
  providers: Provider[];
  mappingWarnings: MappingWarning[];
}): string[] {
  const lines: string[] = [];
  const active = snapshot.providers.find((provider) => provider.name === snapshot.activeProviderName) ?? null;

  if (!active) {
    lines.push('\x1b[33m✦ no active provider\x1b[0m');
  } else {
    lines.push(`\x1b[36m✦ active provider\x1b[0m (${active.name}:${active.kind})`);
  }

  lines.push('', '\x1b[90mProviders:\x1b[0m');
  for (const provider of snapshot.providers) {
    const marker = provider.name === snapshot.activeProviderName ? '\x1b[32m→\x1b[0m' : ' ';
    const status = provider.enabled ? '' : ' \x1b[90m(disabled)\x1b[0m';
    lines.push(`  ${marker} ${provider.name} [${provider.kind}]${status}`);
  }

  if (snapshot.mappingWarnings.length > 0) {
    lines.push('', '\x1b[33mMapping warnings:\x1b[0m');
    for (const warning of snapshot.mappingWarnings) {
      const reason = warning.reason === 'missing_provider' ? 'missing provider' : 'disabled provider';
      lines.push(`  - ${warning.agentType} -> ${warning.provider} (${reason})`);
    }
  }

  return lines;
}
